import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account, AuthMeResponse, Project, SessionSummary } from '@vibe-teacher/shared';
import { allAdapters } from '../src/adapters/registry';
import { AnalysisService } from '../src/analyzers/index';
import { createApp } from '../src/app';
import { CookieSigner, loadOrCreateSecret } from '../src/auth/cookie';
import { createWikiServices } from '../src/wiki/service';
import { AuthService } from '../src/auth/service';
import { readLoginToken, tokenHash, tokenSetupCommand } from '../src/auth/token-file';
import { ConfigStore, resolvePaths } from '../src/config/store';
import { SessionIndex } from '../src/index/session-index';
import { EnrichService } from '../src/llm/service';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, 'fixtures');

async function copyDir(src: string, dst: string) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function writeToken(home: string, token: string, mode = 0o600) {
  await fs.mkdir(path.join(home, '.vibe-teacher'), { recursive: true });
  const f = path.join(home, '.vibe-teacher', 'login-token');
  await fs.writeFile(f, `${token}\n`, { encoding: 'utf8', mode });
  await fs.chmod(f, mode);
}

describe('cookie signer', () => {
  it('signs, verifies, rejects tampering and expiry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-auth-'));
    const secret = await loadOrCreateSecret(path.join(dir, 'auth-secret'));
    expect((await loadOrCreateSecret(path.join(dir, 'auth-secret'))).equals(secret)).toBe(true);
    const signer = new CookieSigner(secret);
    const value = signer.sign({ u: 'alice', h: 'abc', exp: Date.now() + 10_000 });
    expect(signer.verify(value)?.u).toBe('alice');
    expect(signer.verify(value.slice(0, -2) + 'zz')).toBeNull();
    const forgedBody = Buffer.from(JSON.stringify({ u: 'bob', h: 'abc', exp: Date.now() + 10_000 })).toString('base64url');
    expect(signer.verify(`${forgedBody}.${value.split('.')[1]}`)).toBeNull();
    expect(signer.verify(signer.sign({ u: 'alice', h: 'abc', exp: Date.now() - 1 }))).toBeNull();
    expect(new CookieSigner(Buffer.from('other-secret-other-secret-other!')).verify(value)).toBeNull();
  });
});

describe('token file', () => {
  it('validates file, owner, world-readability and length', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-home-'));
    expect((await readLoginToken(home)).ok).toBe(false);
    await writeToken(home, 'short');
    expect(await readLoginToken(home)).toMatchObject({ ok: false, code: 'invalid' });
    await writeToken(home, 'a-long-enough-token-value-123', 0o644);
    expect((await readLoginToken(home)) as { reason: string }).toMatchObject({ ok: false, reason: expect.stringContaining('chmod 600') });
    await writeToken(home, 'a-long-enough-token-value-123', 0o640);
    const ok = await readLoginToken(home, process.getuid?.());
    expect(ok).toMatchObject({ ok: true, token: 'a-long-enough-token-value-123', hash: tokenHash('a-long-enough-token-value-123') });
    expect((await readLoginToken(home, 0)).ok).toBe(process.getuid?.() === 0);
    expect(tokenSetupCommand('svc')).toContain('setfacl -m u:svc:r ~/.vibe-teacher/login-token');
  });
});

describe('home-token login and account scoping', () => {
  let tmp: string;
  let app: ReturnType<typeof createApp>;
  let store: ConfigStore;
  const ALICE_TOKEN = 'alice-token-0123456789abcdef';
  const BOB_TOKEN = 'bob-token-0123456789abcdef';
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-login-'));
    const homes = path.join(tmp, 'home');
    await copyDir(path.join(FIX, 'claude'), path.join(homes, 'alice', '.claude', 'projects', '-home-tester-myapp'));
    await copyDir(path.join(FIX, 'codex'), path.join(homes, 'bob', '.codex'));
    await fs.mkdir(path.join(homes, 'svc'), { recursive: true });
    await writeToken(path.join(homes, 'alice'), ALICE_TOKEN);
    await writeToken(path.join(homes, 'bob'), BOB_TOKEN);
    const paths = resolvePaths(path.join(tmp, 'state'));
    store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => {
      c.scan = { mode: 'all', homes: [], homeRoots: [homes] };
      c.auth = { mode: 'home-token', admins: ['bob'], sessionTtlHours: 1, enrichFor: 'admins' };
    });
    const index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: path.join(homes, 'svc'), env: {} });
    const enrich = new EnrichService({ store, paths, providerOverride: null });
    const auth = new AuthService({ store, paths, index, serviceUser: 'svc', bearerToken: 'master', isLoopback: true });
    await auth.init();
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService('/home/tester'), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
    await index.rescan();
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('exposes mode and rejects unauthenticated API calls', async () => {
    const me = (await (await app.request('/api/auth/me')).json()) as AuthMeResponse;
    expect(me).toMatchObject({ mode: 'home-token', authenticated: false, serviceUser: 'svc', tokenRequired: false });
    const res = await app.request('/api/accounts');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { authMode: string }).authMode).toBe('home-token');
    const cmd = (await (await app.request('/api/auth/setup-command')).json()) as { command: string };
    expect(cmd.command).toContain('u:svc:r');
  });

  it('logs alice in with her home token and scopes everything to her account', async () => {
    const bad = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', token: 'wrong-token-value-xxxxxxxx' }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(401);
    const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', token: ALICE_TOKEN }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie.startsWith('vt_session=')).toBe(true);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    const h = { cookie };
    const me = (await (await app.request('/api/auth/me', { headers: h })).json()) as AuthMeResponse;
    expect(me).toMatchObject({ authenticated: true, username: 'alice', isAdmin: false, canEnrich: false });
    const accounts = (await (await app.request('/api/accounts', { headers: h })).json()) as Account[];
    expect(accounts.map((a) => a.username)).toEqual(['alice']);
    const projects = (await (await app.request('/api/projects', { headers: h })).json()) as Project[];
    expect(projects.every((p) => p.accountId === accounts[0]!.id)).toBe(true);
    // bob 의 계정/세션은 보이지 않는다 (404)
    const all = (await (await app.request('/api/accounts', { headers: { authorization: 'Bearer master' } })).json()) as Account[];
    const bob = all.find((a) => a.username === 'bob')!;
    expect((await app.request(`/api/accounts/${bob.id}`, { headers: h })).status).toBe(404);
    const bobSessions = (await (await app.request(`/api/accounts/${bob.id}/projects`, { headers: { authorization: 'Bearer master' } })).json()) as Project[];
    const bobSess = (await (await app.request(`/api/projects/${bobSessions[0]!.id}/sessions`, { headers: { authorization: 'Bearer master' } })).json()) as SessionSummary[];
    expect((await app.request(`/api/sessions/${encodeURIComponent(bobSess[0]!.key)}/user-messages`, { headers: h })).status).toBe(404);
    expect((await app.request(`/api/projects?account=${bob.id}`, { headers: h })).status).toBe(200);
    expect((await (await app.request(`/api/projects?account=${bob.id}`, { headers: h })).json()) as Project[]).toEqual([]);
    // 관리자 전용
    expect((await app.request('/api/settings', { headers: h })).status).toBe(403);
    expect((await app.request('/api/rescan', { method: 'POST', headers: h })).status).toBe(403);
    // AI 분석은 관리자만 (설정 기본값)
    const own = (await (await app.request(`/api/accounts/${accounts[0]!.id}/projects`, { headers: h })).json()) as Project[];
    const ownSess = (await (await app.request(`/api/projects/${own[0]!.id}/sessions`, { headers: h })).json()) as SessionSummary[];
    expect((await app.request(`/api/sessions/${encodeURIComponent(ownSess[0]!.key)}/enrich`, { method: 'POST', headers: h })).status).toBe(403);
    // 로그아웃
    const out = await app.request('/api/auth/logout', { method: 'POST', headers: h });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('admins (config list, service user, bearer) see everything', async () => {
    const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'bob', token: BOB_TOKEN }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    const h = { cookie: cookieOf(res) };
    const me = (await (await app.request('/api/auth/me', { headers: h })).json()) as AuthMeResponse;
    expect(me).toMatchObject({ authenticated: true, username: 'bob', isAdmin: true, canEnrich: true });
    const accounts = (await (await app.request('/api/accounts', { headers: h })).json()) as Account[];
    expect(accounts.map((a) => a.username).sort()).toEqual(['alice', 'bob', 'svc']);
    expect((await app.request('/api/settings', { headers: h })).status).toBe(200);
    const viaBearer = (await (await app.request('/api/auth/me', { headers: { authorization: 'Bearer master' } })).json()) as AuthMeResponse;
    expect(viaBearer).toMatchObject({ authenticated: true, username: 'svc', isAdmin: true, via: 'bearer' });
  });

  it('invalidates sessions when the token file changes and locks after repeated failures', async () => {
    const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', token: ALICE_TOKEN }), headers: { 'content-type': 'application/json' } });
    const h = { cookie: cookieOf(res) };
    expect((await app.request('/api/accounts', { headers: h })).status).toBe(200);
    await writeToken(path.join(tmp, 'home', 'alice'), 'alice-token-rotated-0123456789');
    // 토큰 검사 캐시(30초)를 우회하기 위해 설정 변경으로 캐시를 비운다
    await store.update((c) => {
      c.auth = { ...c.auth, sessionTtlHours: 2 };
    });
    expect((await app.request('/api/auth/me')).status).toBe(200);
    const putRes = await app.request('/api/settings', { method: 'PUT', body: JSON.stringify({ auth: { sessionTtlHours: 2 } }), headers: { 'content-type': 'application/json', authorization: 'Bearer master' } });
    expect(putRes.status).toBe(200);
    expect((await app.request('/api/accounts', { headers: h })).status).toBe(401);
    for (let i = 0; i < 5; i += 1) {
      await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'carol', token: 'nope-nope-nope-nope-nope' }), headers: { 'content-type': 'application/json' } });
    }
    const locked = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'carol', token: 'nope-nope-nope-nope-nope' }), headers: { 'content-type': 'application/json' } });
    expect(locked.status).toBe(429);
  });

  it('mode none keeps the open behaviour', async () => {
    await store.update((c) => {
      c.auth = { ...c.auth, mode: 'none' };
    });
    const me = (await (await app.request('/api/auth/me')).json()) as AuthMeResponse;
    expect(me).toMatchObject({ mode: 'none', authenticated: true, isAdmin: true, via: 'open' });
    expect((await app.request('/api/accounts')).status).toBe(200);
  });
});
