import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Member, SignupResponse } from '@vibe-teacher/shared';
import { CloudClient, CloudError, normalizeAppUrl, type CloudConfig } from '../cloud/client';
import { ensureDir } from '../lib/fsx';
import type { AuthUser } from './service';

const ACCESS = 'vt_cloud_access';
const REFRESH = 'vt_cloud_refresh';
interface Session { access_token: string; refresh_token: string; expires_in: number }
interface SupabaseUser { id: string; email?: string }

export class SupabaseAuth {
  private refreshes = new Map<string, Promise<Session>>();
  constructor(readonly config: CloudConfig, private readonly home: string, private readonly request: typeof fetch = fetch) {}

  client(token = ''): CloudClient { return new CloudClient(this.config, token, this.request); }

  private save(c: Context, session: Session): void {
    const opts = { httpOnly: true, sameSite: 'Lax' as const, path: '/', secure: this.config.secure };
    setCookie(c, ACCESS, session.access_token, { ...opts, maxAge: session.expires_in });
    setCookie(c, REFRESH, session.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 7 });
  }

  async login(c: Context, email: string, password: string): Promise<void> {
    const session = await this.client().call<Session>('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.save(c, session);
  }

  async signup(c: Context, email: string, password: string): Promise<SignupResponse> {
    let redirectTo: string;
    try {
      // Vite가 API를 프록시해도 사용자가 연 웹 화면의 포트로 돌아간다.
      redirectTo = normalizeAppUrl(this.config.publicUrl ?? c.req.header('origin') ?? new URL(c.req.url).origin, this.config.deployment);
    } catch {
      throw new CloudError(422, 'invalid_app_url', '브라우저에서 여는 앱 주소를 VIBE_TEACHER_PUBLIC_URL에 설정하세요. Supabase의 Redirect URLs에도 같은 주소를 등록하세요');
    }
    const query = new URLSearchParams({ redirect_to: redirectTo });
    const result = await this.client().call<Partial<Session>>(`/auth/v1/signup?${query}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.access_token && result.refresh_token && result.expires_in) {
      this.save(c, result as Session);
      return { confirmationRequired: false };
    }
    return { confirmationRequired: true };
  }

  /** 최초의 검증된 사용자에게 로컬 설치를 묶는다. 공용 서버에서는 절대 자동 연결하지 않는다. */
  private async localOwner(userId: string): Promise<boolean> {
    if (this.config.deployment !== 'local') return false;
    const file = path.join(this.home, 'local-owner');
    await ensureDir(this.home);
    try { await fs.writeFile(file, userId, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return (await fs.readFile(file, 'utf8')).trim() === userId;
  }

  async authenticate(c: Context): Promise<AuthUser | null> {
    const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    let token = bearer ?? getCookie(c, ACCESS);
    let user: SupabaseUser | undefined;
    if (token) {
      try { user = await this.client(token).call<SupabaseUser>('/auth/v1/user'); }
      catch (e) { if (!(e instanceof CloudError) || (e.status !== 401 && e.status !== 403)) throw e; }
    }
    if (!user && !bearer) {
      const refresh = getCookie(c, REFRESH);
      if (!refresh) return null;
      try {
        let pending = this.refreshes.get(refresh);
        if (!pending) {
          pending = this.client().call<Session>('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
          this.refreshes.set(refresh, pending);
          const timer = setTimeout(() => this.refreshes.delete(refresh), 5_000);
          timer.unref();
        }
        const session = await pending;
        token = session.access_token;
        user = await this.client(token).call<SupabaseUser>('/auth/v1/user');
        this.save(c, session);
      } catch (e) {
        if (!(e instanceof CloudError) || e.status >= 500 || e.status === 429) throw e;
        this.clear(c);
        return null;
      }
    }
    if (!user || !token) return null;
    const members = await this.client(token).call<Member[]>('/rest/v1/vt_members?select=*&user_id=eq.' + encodeURIComponent(user.id));
    const member = members[0];
    if (!member || member.user_id !== user.id) throw new CloudError(503, 'member_missing', '가입 정보를 찾을 수 없습니다. 관리자에게 Supabase 마이그레이션 확인을 요청하세요');
    return {
      username: `sb_${user.id}`, isAdmin: member.is_admin, via: 'cookie',
      cloud: { userId: user.id, email: user.email ?? member.email, accessToken: token, approved: member.approved || member.is_admin, accountIds: member.account_ids, localOwner: await this.localOwner(user.id) },
    };
  }

  private clear(c: Context): void {
    for (const name of [ACCESS, REFRESH]) deleteCookie(c, name, { path: '/', secure: this.config.secure });
  }

  async logout(c: Context): Promise<void> {
    const token = getCookie(c, ACCESS);
    try { if (token) await this.client(token).call('/auth/v1/logout?scope=local', { method: 'POST' }); }
    finally { this.clear(c); }
  }
}
