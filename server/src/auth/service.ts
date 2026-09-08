import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Account, AuthMode } from '@vibe-teacher/shared';
import type { ConfigStore, Paths } from '../config/store';
import type { SessionIndex } from '../index/session-index';
import { readPasswdHomes } from '../index/accounts';
import { COOKIE_NAME, CookieSigner, loadOrCreateSecret } from './cookie';
import { readLoginToken, tokenHash } from './token-file';

export interface AuthUser {
  username: string;
  isAdmin: boolean;
  via: 'cookie' | 'bearer' | 'open';
}

export type LoginResult = { ok: true; user: AuthUser } | { ok: false; status: 401 | 403 | 429; reason: string };

export interface AuthServiceOptions {
  store: ConfigStore;
  paths: Paths;
  index: SessionIndex;
  /** 앱을 실행 중인 OS 계정 (항상 관리자) */
  serviceUser: string;
  /** VIBE_TEACHER_TOKEN — 있으면 관리자용 Bearer 토큰 */
  bearerToken: string | null;
  /** 비-loopback 바인딩 여부 (없음 모드에서 토큰 필요 여부 계산용) */
  isLoopback: boolean;
  cookieSecure?: boolean;
}

const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const TOKEN_CHECK_TTL = 30_000;

export class AuthService {
  private signer: CookieSigner | null = null;
  private fails = new Map<string, { count: number; until: number }>();
  private tokenCache = new Map<string, { at: number; hash: string | null }>();
  private uidCache: { at: number; map: Map<string, { username: string; uid: number }> } | null = null;

  constructor(private readonly opts: AuthServiceOptions) {}

  async init(): Promise<void> {
    if (!this.signer) this.signer = new CookieSigner(await loadOrCreateSecret(path.join(this.opts.paths.home, 'auth-secret')));
  }

  mode(): AuthMode {
    return this.opts.store.get().auth.mode;
  }

  get serviceUser(): string {
    return this.opts.serviceUser;
  }

  /** 로그인 없음 모드 + 비-loopback 이면 Bearer 토큰이 필요 */
  tokenRequired(): boolean {
    return this.mode() === 'none' && !this.opts.isLoopback && !!this.opts.bearerToken;
  }

  isAdmin(username: string): boolean {
    return username === this.opts.serviceUser || this.opts.store.get().auth.admins.includes(username);
  }

  canEnrich(user: AuthUser): { ok: boolean; reason?: string } {
    if (user.isAdmin || this.opts.store.get().auth.enrichFor === 'everyone') return { ok: true };
    return { ok: false, reason: 'AI 분석은 관리자만 실행할 수 있습니다' };
  }

  /** 사용자가 볼 수 있는 계정 id 집합 ('all' 은 전체) */
  allowedAccountIds(user: AuthUser): Set<string> | 'all' {
    if (user.isAdmin) return 'all';
    return new Set(this.opts.index.getAccounts().filter((a) => a.username === user.username).map((a) => a.id));
  }

  canAccessAccount(user: AuthUser, accountId: string): boolean {
    const allowed = this.allowedAccountIds(user);
    return allowed === 'all' || allowed.has(accountId);
  }

  filterAccounts(user: AuthUser, accounts: Account[]): Account[] {
    const allowed = this.allowedAccountIds(user);
    return allowed === 'all' ? accounts : accounts.filter((a) => allowed.has(a.id));
  }

  private accountsFor(username: string): Account[] {
    return this.opts.index.getAccounts().filter((a) => a.username === username);
  }

  private async uidFor(username: string): Promise<number | undefined> {
    if (!this.uidCache || Date.now() - this.uidCache.at > 300_000) this.uidCache = { at: Date.now(), map: await readPasswdHomes() };
    for (const v of this.uidCache.map.values()) if (v.username === username) return v.uid;
    return undefined;
  }

  private bearerUser(c: Context): AuthUser | null {
    const token = this.opts.bearerToken;
    if (!token) return null;
    const header = c.req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!provided) return null;
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { username: this.opts.serviceUser, isAdmin: true, via: 'bearer' };
  }

  /** 요청에서 사용자를 알아낸다. 없으면 null. */
  async authenticate(c: Context): Promise<AuthUser | null> {
    const bearer = this.bearerUser(c);
    if (bearer) return bearer;
    if (this.mode() === 'none') {
      if (this.tokenRequired()) return null;
      return { username: this.opts.serviceUser, isAdmin: true, via: 'open' };
    }
    await this.init();
    const payload = this.signer!.verify(getCookie(c, COOKIE_NAME));
    if (!payload) return null;
    const currentHash = await this.currentTokenHash(payload.u);
    if (!currentHash || currentHash !== payload.h) return null;
    return { username: payload.u, isAdmin: this.isAdmin(payload.u), via: 'cookie' };
  }

  /** 토큰 파일이 여전히 같은지 (30초 캐시) */
  private async currentTokenHash(username: string): Promise<string | null> {
    const cached = this.tokenCache.get(username);
    if (cached && Date.now() - cached.at < TOKEN_CHECK_TTL) return cached.hash;
    let hash: string | null = null;
    const uid = await this.uidFor(username);
    for (const a of this.accountsFor(username)) {
      if (a.readable !== 'ok') continue;
      const r = await readLoginToken(a.homePath, uid);
      if (r.ok) {
        hash = r.hash;
        break;
      }
    }
    this.tokenCache.set(username, { at: Date.now(), hash });
    return hash;
  }

  async login(c: Context, usernameRaw: string, tokenRaw: string): Promise<LoginResult> {
    await this.init();
    const username = usernameRaw.trim();
    const token = tokenRaw.trim();
    if (!username || !token) return { ok: false, status: 401, reason: '사용자 이름과 토큰을 입력하세요' };
    const lock = this.fails.get(username);
    if (lock && lock.count >= MAX_FAILS && Date.now() < lock.until) {
      return { ok: false, status: 429, reason: `실패가 잦아 잠시 잠겼습니다. ${Math.ceil((lock.until - Date.now()) / 1000)}초 뒤에 다시 시도하세요` };
    }
    const fail = (status: 401 | 403, reason: string): LoginResult => {
      const cur = this.fails.get(username) ?? { count: 0, until: 0 };
      cur.count += 1;
      cur.until = Date.now() + LOCK_MS;
      this.fails.set(username, cur);
      return { ok: false, status, reason };
    };
    await this.opts.index.ensureFresh();
    const accounts = this.accountsFor(username);
    if (!accounts.length) return fail(401, '그 이름의 계정을 찾을 수 없습니다 (스캔 범위 확인)');
    const readable = accounts.filter((a) => a.readable === 'ok');
    if (!readable.length) return fail(403, '이 계정의 홈을 읽을 권한이 없습니다. 관리자에게 ACL 부여를 요청하세요');
    const uid = await this.uidFor(username);
    let lastReason = '토큰이 일치하지 않습니다';
    for (const a of readable) {
      const r = await readLoginToken(a.homePath, uid);
      if (!r.ok) {
        lastReason = r.reason;
        continue;
      }
      const x = Buffer.from(tokenHash(token));
      const y = Buffer.from(r.hash);
      if (x.length === y.length && timingSafeEqual(x, y)) {
        this.fails.delete(username);
        this.tokenCache.set(username, { at: Date.now(), hash: r.hash });
        const ttlMs = this.opts.store.get().auth.sessionTtlHours * 3600_000;
        const value = this.signer!.sign({ u: username, h: r.hash, exp: Date.now() + ttlMs });
        setCookie(c, COOKIE_NAME, value, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: Math.floor(ttlMs / 1000), secure: this.opts.cookieSecure ?? false });
        return { ok: true, user: { username, isAdmin: this.isAdmin(username), via: 'cookie' } };
      }
      lastReason = '토큰이 일치하지 않습니다';
    }
    return fail(401, lastReason);
  }

  logout(c: Context): void {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
  }

  /** 설정이 바뀌면 캐시를 비운다 */
  invalidate(): void {
    this.tokenCache.clear();
    this.uidCache = null;
  }
}
