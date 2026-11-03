import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account, AuthMeResponse, Member, OnboardingProfile } from '@vibe-teacher/shared';
import { createApp } from '../src/app';
import { AuthService } from '../src/auth/service';
import { SupabaseAuth } from '../src/auth/supabase';
import { CloudClient, cloudConfig, normalizeAppUrl, type CloudConfig } from '../src/cloud/client';
import { CloudStorage } from '../src/cloud/storage';
import { ConfigStore, resolvePaths } from '../src/config/store';
import { AnalysisService } from '../src/analyzers/index';
import type { SessionIndex } from '../src/index/session-index';
import { EnrichService } from '../src/llm/service';
import { WikiStorage } from '../src/storage/store';
import { createWikiServices } from '../src/wiki/service';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const config: CloudConfig = { url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'shared', secure: true };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });
async function temp() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-cloud-')); dirs.push(dir); return dir; }

/** Supabase HTTP 경계를 흉내 낸 합성 저장소. 요청마다 토큰으로 RLS 주체를 정한다. */
function fakeCloud() {
  const members = new Map<string, Member>([
    [ALICE, { user_id: ALICE, email: 'alice@example.test', approved: false, is_admin: false, account_ids: ['alice-account'] }],
    [BOB, { user_id: BOB, email: 'bob@example.test', approved: true, is_admin: true, account_ids: ['bob-account'] }],
  ]);
  const documents = new Map<string, unknown>();
  const events: { seq: number; user_id: string; key: string; value: unknown }[] = [];
  const locks = new Map<string, string>();
  const calls: { url: URL; headers: Headers; body: Record<string, unknown> }[] = [];
  let failWrites = false;
  const request = (async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers, body });
    const reply = (value: unknown, status = 200) => Response.json(value, { status });
    const token = headers.get('authorization')?.replace('Bearer ', '');
    const owner = token === 'alice-token' ? ALICE : token === 'bob-token' ? BOB : undefined;
    if (url.pathname === '/auth/v1/signup') return reply({ user: { id: ALICE } });
    if (url.pathname === '/auth/v1/token') {
      if (body.password === 'bad') return reply({}, 400);
      return reply({ access_token: 'alice-token', refresh_token: 'refresh-a', expires_in: 3600 });
    }
    if (!owner) return reply({}, 401);
    if (url.pathname === '/auth/v1/user') return reply({ id: owner, email: members.get(owner)!.email, user_metadata: { is_admin: true, approved: true, username: 'service' } });
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/vt_members') return reply([members.get(owner)]);
    if (url.pathname === '/rest/v1/rpc/vt_lock') {
      const key = `${owner}:${body.lock_key}`;
      if (locks.has(key)) return reply(false);
      locks.set(key, String(body.lock_token)); return reply(true);
    }
    if (url.pathname === '/rest/v1/rpc/vt_unlock') {
      const key = `${owner}:${body.lock_key}`;
      if (locks.get(key) === body.lock_token) locks.delete(key);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/rpc/vt_list_members') return owner === BOB ? reply([...members.values()]) : reply({}, 403);
    if (url.pathname === '/rest/v1/rpc/vt_update_member') {
      if (owner !== BOB) return reply({}, 403);
      const member = members.get(String(body.target_user))!;
      members.set(member.user_id, { ...member, approved: !!body.allow_ai, account_ids: body.accounts as string[] });
      return new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') {
      if (failWrites) return reply({}, 500);
      if (body.user_id !== owner) return reply({}, 403);
      if (url.pathname.endsWith('/vt_events')) events.push({ seq: events.length + 1, user_id: owner, key: String(body.key), value: body.value });
      else documents.set(`${owner}:${body.key}`, body.value);
      return new Response(null, { status: 201 });
    }
    if (url.searchParams.get('user_id') !== `eq.${owner}`) return reply([]);
    const key = url.searchParams.get('key')?.slice(3);
    if (url.pathname.endsWith('/vt_events')) return reply(events.filter((e) => e.user_id === owner && e.key === key && e.seq > Number(url.searchParams.get('seq')?.slice(3) ?? 0)).slice(0, 500));
    const value = documents.get(`${owner}:${key}`);
    return reply(value === undefined ? [] : [{ value }]);
  }) as typeof fetch;
  return { request, calls, members, documents, events, set failWrites(value: boolean) { failWrites = value; } };
}

async function fixture(remote = fakeCloud(), deployment: 'local' | 'shared' = 'shared') {
  const home = await temp();
  const paths = resolvePaths(home);
  const store = new ConfigStore(paths); await store.load();
  await store.update((cfg) => { cfg.llm.provider = 'none'; cfg.auth.enrichFor = 'everyone'; });
  const accounts = [
    { id: 'alice-account', username: 'service', homePath: '/synthetic/alice', readable: 'ok', sessionCount: 0 },
    { id: 'bob-account', username: 'bob', homePath: '/synthetic/bob', readable: 'ok', sessionCount: 0 },
  ] as Account[];
  const index = {
    ensureFresh: async () => {}, getAccounts: () => accounts, getProjects: () => [], getProjectIds: (id: string) => [id],
    getProject: (id: string) => id === 'alice-project' ? { id, accountId: 'alice-account' } : undefined,
    getSummary: () => undefined,
  } as unknown as SessionIndex;
  const cloud = new SupabaseAuth({ ...config, deployment, secure: deployment === 'shared' }, home, remote.request);
  const auth = new AuthService({ store, paths, index, serviceUser: 'service', bearerToken: 'legacy-admin-token', isLoopback: true, cloud });
  const enrich = new EnrichService({ store, paths, providerOverride: null });
  const services = createWikiServices(home, store, () => enrich.resolveProvider());
  const app = createApp({ quiet: true, deps: { store, paths, index, auth, enrich, analysis: new AnalysisService(), ...services, version: 'test' } });
  const req = (route: string, token = 'alice-token', body?: unknown, method = body ? 'PUT' : 'GET') => app.request(route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, req, auth, cloud, home, remote };
}

describe('Supabase 로그인과 사용자 저장소', () => {
  it('검증한 사용자 ID로 격리하고 메타데이터·OS 계정·기존 관리자 토큰을 권한으로 쓰지 않는다', async () => {
    const f = await fixture();
    const me = await (await f.req('/api/auth/me')).json() as AuthMeResponse;
    expect(me).toMatchObject({ mode: 'supabase', authenticated: true, isAdmin: false, canEnrich: false, approved: false });
    expect(me.username).toBe(`sb_${ALICE}`);
    expect((await f.req('/api/auth/me', 'legacy-admin-token')).status).toBe(200);
    expect((await (await f.req('/api/auth/me', 'legacy-admin-token')).json() as AuthMeResponse).authenticated).toBe(false);
    expect((await f.req('/api/me/prefs', 'legacy-admin-token')).status).toBe(401);
    expect((await f.req('/api/members')).status).toBe(403);
    expect((await f.req('/api/projects/alice-project', 'bob-token')).status).toBe(404);
    // Supabase 관리자도 자신의 OS 계정 범위만 볼 수 있다.
    expect((await (await f.req('/api/accounts', 'bob-token')).json() as Account[]).map((a) => a.id)).toEqual(['bob-account']);
    expect((await f.req('/api/members/accounts', 'bob-token')).status).toBe(200);
  });

  it('공용 서버·별도 로컬 설치가 같은 계정의 설정·시작점을 읽고 다른 회원에게는 노출하지 않는다', async () => {
    const remote = fakeCloud();
    const shared = await fixture(remote);
    const local = await fixture(remote, 'local');
    const profile = { stage: 'features', goal: '합성 프로젝트', features: '검색', repository: '' };
    expect((await shared.req('/api/me/onboarding', 'alice-token', profile)).status).toBe(200);
    const read = await (await local.req('/api/me/onboarding')).json() as { profile: OnboardingProfile };
    expect(read.profile).toMatchObject(profile);
    expect(await (await local.req('/api/me/onboarding', 'bob-token')).json()).toEqual({ profile: null });
    expect((await shared.req('/api/me/prefs', 'alice-token', { readerLevel: 'junior' })).status).toBe(200);
    expect(await (await local.req('/api/me/prefs')).json()).toMatchObject({ readerLevel: 'junior', chosen: true });
    expect(await (await local.req('/api/me/prefs', 'bob-token')).json()).toMatchObject({ chosen: false });
    expect((await (await local.req('/api/accounts', 'bob-token')).json())).toEqual([]);
    expect((await fs.readdir(path.join(local.home, 'wiki')).catch(() => []))).toEqual([]);
  });

  it('회원 승인이 다음 인증에 반영되고 일반 회원은 직접 승인할 수 없다', async () => {
    const f = await fixture();
    expect((await f.req('/api/members', 'alice-token', { userId: ALICE, approved: true, accountIds: ['alice-account'] })).status).toBe(403);
    expect((await f.req('/api/members', 'bob-token', { userId: ALICE, approved: true, accountIds: ['alice-account'] })).status).toBe(204);
    expect(await (await f.req('/api/auth/me')).json()).toMatchObject({ canEnrich: true, approved: true });
  });

  it('로컬 소유자는 기기 설정을 관리해도 회원 승인 권한을 얻지 않는다', async () => {
    const f = await fixture(fakeCloud(), 'local');
    expect(await (await f.req('/api/auth/me')).json()).toMatchObject({ localOwner: true, isAdmin: false, canManageInstallation: true, canEnrich: false });
    expect((await f.req('/api/settings')).status).toBe(200);
    expect((await f.req('/api/settings', 'alice-token', { auth: { enrichFor: 'everyone' } })).status).toBe(200);
    expect(await (await f.req('/api/auth/me')).json()).toMatchObject({ canEnrich: false });
    expect((await f.req('/api/members')).status).toBe(403);
  });

  it('이메일 인증이 필요한 회원가입과 HttpOnly 로그인·갱신·로그아웃을 처리한다', async () => {
    const f = await fixture();
    const signup = await f.app.request('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.example.test' }, body: JSON.stringify({ email: 'alice@example.test', password: 'long-password' }) });
    expect(signup.status).toBe(201); expect(await signup.json()).toEqual({ confirmationRequired: true });
    expect(signup.headers.get('set-cookie')).toBeNull();
    const login = await f.app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.test', password: 'long-password' }) });
    expect(login.status).toBe(204);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly'); expect(login.headers.get('set-cookie')).toContain('Secure');
    const refresh = await f.app.request('/api/auth/me', { headers: { cookie: 'vt_cloud_access=expired; vt_cloud_refresh=refresh-a' } });
    expect(await refresh.json()).toMatchObject({ authenticated: true });
    expect(refresh.headers.get('set-cookie')).toContain('vt_cloud_refresh');
    const logout = await f.app.request('/api/auth/logout', { method: 'POST', headers: { cookie: 'vt_cloud_access=alice-token', 'sec-fetch-site': 'same-origin' } });
    expect(logout.status).toBe(204); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await f.app.request('/api/auth/login', { method: 'POST', body: 'email=x&password=y' })).status).toBe(415);
  });

  it('개발 프록시 뒤에서도 가입한 웹 화면의 포트로 돌아오게 지정한다', async () => {
    const f = await fixture(fakeCloud(), 'local');
    const response = await f.app.request('http://127.0.0.1:8787/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3050' }, body: JSON.stringify({ email: 'alice@example.test', password: 'long-password' }) });
    expect(response.status).toBe(201);
    const call = f.remote.calls.find((item) => item.url.pathname === '/auth/v1/signup');
    expect(call?.url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:3050/');
  });

  it('공용 서버는 설정한 외부 앱 주소를 사용하고 로컬 설치는 외부 리다이렉트를 차단한다', async () => {
    const f = await fixture();
    f.cloud.config.publicUrl = 'https://app.example.test/';
    const body = JSON.stringify({ email: 'alice@example.test', password: 'long-password' });
    const response = await f.app.request('http://internal:8787/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example.test' }, body });
    expect(response.status).toBe(201);
    expect(f.remote.calls.find((item) => item.url.pathname === '/auth/v1/signup')?.url.searchParams.get('redirect_to')).toBe('https://app.example.test/');
    const local = await fixture(fakeCloud(), 'local');
    expect((await local.app.request('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example.test' }, body })).status).toBe(422);
    expect(local.remote.calls).toHaveLength(0);
  });

  it('클라우드 장애를 로컬 저장 성공으로 숨기지 않는다', async () => {
    const f = await fixture(); f.remote.failWrites = true;
    const result = await f.req('/api/me/onboarding', 'alice-token', { stage: 'idea' });
    expect(result.status).toBe(503); expect((await result.text())).not.toContain('alice-token');
    expect(await fs.readdir(path.join(f.home, 'wiki')).catch(() => [])).toEqual([]);
  });

  it('원장은 페이지 제한을 넘어 읽고 서버 간 잠금과 사용자 경로 경계를 지킨다', async () => {
    const remote = fakeCloud(); const root = path.join(await temp(), 'wiki');
    const client = new CloudClient(config, 'alice-token', remote.request);
    const a = new WikiStorage(path.dirname(root), undefined, new CloudStorage(client, ALICE, root));
    const b = new WikiStorage(path.dirname(root), undefined, new CloudStorage(client, ALICE, root));
    const file = path.join(a.learnerDir('l_test'), 'events.jsonl');
    for (let i = 0; i < 1002; i++) remote.events.push({ seq: i + 1, user_id: ALICE, key: 'learners/l_test/events.jsonl', value: { id: i } });
    expect((await a.readJsonl(file)).items).toHaveLength(1002);
    await a.lock('learner:test', async () => { await expect(b.lock('learner:test', async () => {})).rejects.toMatchObject({ status: 409 }); });
    await expect(b.lock('learner:test', async () => 'released')).resolves.toBe('released');
    await expect(a.readJson(path.join(root, '..', 'secret'))).rejects.toThrow('범위');
    await a.appendJsonl(file, { id: 'new' });
    expect((await b.readJsonl(file)).items).toHaveLength(1003);
    expect(remote.calls.every((call) => call.headers.get('apikey') === config.key)).toBe(true);
  });
});

describe('Supabase 설치 설정', () => {
  it('앱 복귀 주소의 프로토콜·호스트·포트와 공개 주소 설정을 검사한다', () => {
    expect(normalizeAppUrl('http://localhost:5173', 'local')).toBe('http://localhost:5173/');
    expect(normalizeAppUrl('http://[::1]:8787/', 'local')).toBe('http://[::1]:8787/');
    expect(() => normalizeAppUrl('http://app.example.test/', 'shared')).toThrow();
    expect(() => normalizeAppUrl('https://app.example.test/#access_token=synthetic', 'shared')).toThrow();
    expect(() => normalizeAppUrl('https://user:pass@app.example.test/', 'shared')).toThrow();
    expect(cloudConfig({ VIBE_TEACHER_AUTH_MODE: 'supabase', SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.key, VIBE_TEACHER_PUBLIC_URL: 'http://localhost:5173' })).toMatchObject({ publicUrl: 'http://localhost:5173/' });
  });
  it('공개 키만 허용하고 누락·잘못된 실행 방식은 거절한다', () => {
    expect(cloudConfig({})).toBeNull();
    expect(() => cloudConfig({ VIBE_TEACHER_AUTH_MODE: 'supabase' })).toThrow();
    const env = { VIBE_TEACHER_AUTH_MODE: 'supabase', SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.key };
    expect(cloudConfig(env)).toMatchObject({ deployment: 'local', secure: false });
    expect(() => cloudConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' })).toThrow('공개 키');
    expect(() => cloudConfig({ ...env, VIBE_TEACHER_DEPLOYMENT: 'typo' })).toThrow();
  });
});
