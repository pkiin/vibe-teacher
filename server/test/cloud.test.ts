import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type { Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account, AuthMeResponse, Deployment, Member, OnboardingProfile } from '@vibe-teacher/shared';
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
import { accountIdFor } from '../src/index/accounts';
import { PEER_UID_HEADER, procNetAvailable } from '../src/lib/peer';

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
  let emailConfirmed = true;
  let failAuth = false;
  const request = (async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers, body });
    const reply = (value: unknown, status = 200) => Response.json(value, { status });
    const token = headers.get('authorization')?.replace('Bearer ', '');
    const owner = token === 'alice-token' ? ALICE : token === 'bob-token' ? BOB : undefined;
    if (url.pathname === '/auth/v1/signup') return reply({ user: { id: ALICE } });
    if (url.pathname === '/auth/v1/resend') return reply({});
    if (url.pathname === '/auth/v1/token') {
      if (body.password === 'bad') return reply({}, 400);
      return reply({ access_token: 'alice-token', refresh_token: 'refresh-a', expires_in: 3600 });
    }
    if (!owner) return reply({}, 401);
    if (url.pathname === '/auth/v1/user') {
      if (failAuth) return reply({ message: 'private-provider-detail' }, 503);
      return reply({ id: owner, email: members.get(owner)!.email, email_confirmed_at: emailConfirmed ? '2026-11-03T00:00:00Z' : null, user_metadata: { is_admin: true, approved: true, username: 'service', email_verified: true } });
    }
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
      for (const row of (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]) {
        if (row.user_id !== owner) return reply({}, 403);
        if (url.pathname.endsWith('/vt_events')) events.push({ seq: events.length + 1, user_id: owner, key: String(row.key), value: row.value });
        else documents.set(`${owner}:${row.key}`, row.value);
      }
      return new Response(null, { status: 201 });
    }
    if (url.searchParams.get('user_id') !== `eq.${owner}`) return reply([]);
    const filter = url.searchParams.get('key') ?? '';
    const keys: string[] = filter.startsWith('in.') ? JSON.parse(`[${filter.slice(4, -1)}]`) : [filter.slice(3)];
    const key = keys[0];
    if (url.pathname.endsWith('/vt_events')) return reply(events.filter((e) => e.user_id === owner && e.key === key && e.seq > Number(url.searchParams.get('seq')?.slice(3) ?? 0)).slice(0, 500));
    return reply(keys.flatMap((key) => documents.has(`${owner}:${key}`) ? [{ key, value: documents.get(`${owner}:${key}`) }] : []));
  }) as typeof fetch;
  return { request, calls, members, documents, events, set failWrites(value: boolean) { failWrites = value; }, set emailConfirmed(value: boolean) { emailConfirmed = value; }, set failAuth(value: boolean) { failAuth = value; } };
}

interface FixtureOptions {
  accounts?: Account[];
  socketUid?: (c: Context) => Promise<number | null>;
  passwd?: () => Promise<Map<string, { username: string; uid: number }>>;
  serviceUid?: number;
}

async function fixture(remote = fakeCloud(), deployment: Deployment = 'shared', opts: FixtureOptions = {}) {
  const home = await temp();
  const paths = resolvePaths(home);
  const store = new ConfigStore(paths); await store.load();
  await store.update((cfg) => { cfg.llm.provider = 'none'; cfg.auth.enrichFor = 'everyone'; });
  const accounts = opts.accounts ?? [
    { id: 'alice-account', username: 'service', homePath: '/synthetic/alice', readable: 'ok', sessionCount: 0 },
    { id: 'bob-account', username: 'bob', homePath: '/synthetic/bob', readable: 'ok', sessionCount: 0 },
  ] as Account[];
  const index = {
    ensureFresh: async () => {}, getAccounts: () => accounts, getProjects: () => [], getProjectIds: (id: string) => [id],
    getProject: (id: string) => id === 'alice-project' ? { id, accountId: 'alice-account' } : undefined,
    getSummary: () => undefined, rescan: async () => ({ accounts: accounts.length, sources: 0, projects: 0, sessions: 0, durationMs: 0 }),
  } as unknown as SessionIndex;
  const cloud = new SupabaseAuth({ ...config, deployment, secure: deployment === 'shared' }, home, remote.request);
  const auth = new AuthService({
    store, paths, index, serviceUser: 'service', bearerToken: 'legacy-admin-token', isLoopback: true, cloud,
    ...(opts.socketUid ? { socketUid: opts.socketUid } : {}), ...(opts.passwd ? { passwd: opts.passwd } : {}), ...(opts.serviceUid !== undefined ? { serviceUid: opts.serviceUid } : {}),
  });
  const enrich = new EnrichService({ store, paths, providerOverride: null });
  const services = createWikiServices(home, store, () => enrich.resolveProvider());
  const app = createApp({ quiet: true, deps: { store, paths, index, auth, enrich, analysis: new AnalysisService(), ...services, version: 'test' } });
  const req = (route: string, token = 'alice-token', body?: unknown, method = body ? 'PUT' : 'GET') => app.request(route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, req, auth, cloud, home, remote };
}

describe('Supabase 로그인과 사용자 저장소', () => {
  it('저장된 내 지식 목록은 회원·현재 계정 권한별로 분리하고 조회로 학습 이벤트를 만들지 않는다', async () => {
    const f = await fixture();
    expect((await f.req('/api/me/knowledge')).status).toBe(200);
    const saved = await (await f.req('/api/me/knowledge/saved')).json() as { view: unknown };
    expect(saved.view).not.toBeNull();
    expect(await (await f.req('/api/me/knowledge/saved', 'bob-token')).json()).toEqual({ view: null });
    const alice = f.remote.members.get(ALICE)!;
    f.remote.members.set(ALICE, { ...alice, account_ids: [] });
    expect(await (await f.req('/api/me/knowledge/saved')).json()).toEqual({ view: null });
    expect(f.remote.events).toEqual([]);
    expect([...f.remote.documents.keys()].some((key) => key.includes('/knowledge-views/'))).toBe(true);
  });
  it('동시 인증을 합치되 다음 요청에는 회원 권한을 다시 확인하고 활동 통계는 본인 것만 반환한다', async () => {
    const f = await fixture();
    await Promise.all([f.req('/api/me/prefs'), f.req('/api/me/onboarding')]);
    expect(f.remote.calls.filter((call) => call.url.pathname === '/auth/v1/user')).toHaveLength(1);
    expect(f.remote.calls.filter((call) => call.url.pathname === '/rest/v1/vt_members')).toHaveLength(1);
    const own = await (await f.req('/api/me/storage')).json() as { mode: string; tables: { reads: number }[] };
    expect(own.mode).toBe('supabase'); expect(own.tables.some((table) => table.reads > 0)).toBe(true);
    const other = await (await f.req('/api/me/storage', 'bob-token')).json() as { tables: unknown[] };
    expect(other.tables).toEqual([]);
    expect(f.remote.calls.filter((call) => call.url.pathname === '/rest/v1/vt_members')).toHaveLength(3);
    expect(JSON.stringify(own)).not.toContain(ALICE);
    expect((await f.req('/api/me/storage', 'invalid-token')).status).toBe(401);
  });

  it('회원의 학습 활동은 vt_events에 추가하고 중복 요청을 다시 쓰지 않는다', async () => {
    const f = await fixture();
    const body = { baseRevision: 0, requestId: 'synthetic-request-001', event: { kind: 'self_report', conceptId: 'auth', value: 'unsure' } };
    const route = '/api/projects/alice-project/understanding/feedback';
    expect((await f.req(route, 'alice-token', body, 'POST')).status).toBe(200);
    expect((await f.req(route, 'alice-token', body, 'POST')).status).toBe(200);
    expect(f.remote.events).toHaveLength(1);
    expect(f.remote.events[0]).toMatchObject({ user_id: ALICE, value: { kind: 'self_report', conceptId: 'auth' } });
    expect([...f.remote.documents.keys()].some((key) => key.endsWith('/profile.json'))).toBe(true);
    expect((await f.req(route, 'bob-token', body, 'POST')).status).toBe(404);
  });
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

  it('미로그인 상태에서 인증 메일 재발송을 요청하고 계정 존재·전달 여부는 공개하지 않는다', async () => {
    const f = await fixture(fakeCloud(), 'local');
    const results = [];
    for (const email of ['alice@example.test', 'unknown@example.test']) {
      const response = await f.app.request('/api/auth/resend-confirmation', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3317' }, body: JSON.stringify({ email, redirectTo: 'https://untrusted.example.test/' }) });
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      results.push(await response.json());
    }
    expect(results).toEqual([{ requested: true, retryAfterSeconds: 60 }, { requested: true, retryAfterSeconds: 60 }]);
    expect(f.remote.calls.map((call) => call.url.pathname)).toEqual(['/auth/v1/resend', '/auth/v1/resend']);
    expect(f.remote.calls[0]?.body).toEqual({ type: 'signup', email: 'alice@example.test' });
    expect(f.remote.calls[0]?.url.searchParams.get('redirect_to')).toBe('http://localhost:3317/');
    await expect(fs.access(path.join(f.home, 'local-owner'))).rejects.toThrow();
  });

  it('재발송 요청의 이메일·본문 형식을 메일 발송 전에 검사한다', async () => {
    const f = await fixture();
    for (const body of [{}, { email: 'invalid' }, { email: '' }, { email: 'x'.repeat(255) + '@example.test' }]) {
      const response = await f.app.request('/api/auth/resend-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.status).toBe(422);
    }
    expect((await f.app.request('/api/auth/resend-confirmation', { method: 'POST', body: 'email=user@example.test' })).status).toBe(415);
    expect(f.remote.calls).toHaveLength(0);
  });

  it('인증 메일의 토큰을 Supabase에서 검증하고 로그인·로컬 소유자 연결 없이 완료 여부만 반환한다', async () => {
    const f = await fixture(fakeCloud(), 'local');
    const response = await f.app.request('/api/auth/email-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: 'alice-token' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmed: true });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(f.remote.calls.map((call) => call.url.pathname)).toEqual(['/auth/v1/user']);
    expect(f.remote.calls[0]?.headers.get('authorization')).toBe('Bearer alice-token');
    await expect(fs.access(path.join(f.home, 'local-owner'))).rejects.toThrow();
    expect(await (await f.app.request('/api/auth/me')).json()).toMatchObject({ authenticated: false });
  });

  it('만료·변조 토큰과 사용자 metadata의 인증 주장을 완료로 표시하지 않는다', async () => {
    const f = await fixture();
    const confirm = (accessToken: string) => f.app.request('/api/auth/email-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken }) });
    const invalid = await confirm('expired-private-token');
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain('expired-private-token');
    f.remote.emailConfirmed = false;
    const unconfirmed = await confirm('alice-token');
    expect(unconfirmed.status).toBe(422);
    expect(await unconfirmed.json()).toMatchObject({ error: { code: 'email_not_confirmed' } });
    expect(unconfirmed.headers.get('set-cookie')).toBeNull();
  });

  it('인증 확인 요청의 입력과 Supabase 장애를 구분하며 외부 오류 상세를 노출하지 않는다', async () => {
    const f = await fixture();
    const confirm = (body: unknown) => f.app.request('/api/auth/email-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const body of [{}, { accessToken: '' }, { accessToken: 'x'.repeat(16_385) }]) expect((await confirm(body)).status).toBe(422);
    expect((await f.app.request('/api/auth/email-confirmation', { method: 'POST', body: 'accessToken=test' })).status).toBe(415);
    expect(f.remote.calls).toHaveLength(0);
    f.remote.failAuth = true;
    const unavailable = await confirm({ accessToken: 'alice-token' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('private-provider-detail');
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

const SSH_HOMES = new Map([
  ['/synthetic/ubuntu', { username: 'ubuntu', uid: 1000 }],
  ['/synthetic/user99', { username: 'user99', uid: 1099 }],
]);
const sshAccounts = [...SSH_HOMES].map(([homePath, v]) => ({ id: accountIdFor(homePath), username: v.username, homePath, readable: 'ok', sessionCount: 0 })) as Account[];
const sshFixture = (socketUid: number | null) => fixture(fakeCloud(), 'ssh', { accounts: sshAccounts, socketUid: async () => socketUid, passwd: async () => SSH_HOMES, serviceUid: 1000 });

describe('SSH 터널 서버', () => {
  it('연결을 연 OS 계정의 기록만 보여 주고 회원 관리의 연결 목록·관리자 여부로 범위를 넓히지 않는다', async () => {
    const f = await sshFixture(1099);
    const me = await (await f.req('/api/auth/me')).json() as AuthMeResponse;
    expect(me).toMatchObject({ deployment: 'ssh', osUser: 'user99', localOwner: false, canManageInstallation: false });
    expect((await (await f.req('/api/accounts')).json() as Account[]).map((a) => a.username)).toEqual(['user99']);
    // Supabase 관리자도 터널을 연 계정만 본다.
    expect((await (await f.req('/api/accounts', 'bob-token')).json() as Account[]).map((a) => a.username)).toEqual(['user99']);
    // 서버 실행 계정으로 접속하면 그 계정의 기록이 보인다.
    const service = await sshFixture(1000);
    expect((await (await service.req('/api/accounts')).json() as Account[]).map((a) => a.username)).toEqual(['ubuntu']);
    expect(await (await service.req('/api/auth/me')).json()).toMatchObject({ osUser: 'ubuntu' });
  });

  it('설치 설정은 서버 실행 계정으로 접속한 설치 관리자만 다루고 다른 계정의 관리자는 회원 관리만 한다', async () => {
    const other = await sshFixture(1099);
    expect(await (await other.req('/api/auth/me', 'bob-token')).json()).toMatchObject({ isAdmin: true, canManageInstallation: false });
    const denied = await other.req('/api/settings', 'bob-token');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'forbidden', message: expect.stringContaining('서버를 실행하는 계정(service)') } });
    expect((await other.req('/api/settings', 'bob-token', { scan: { mode: 'all' } })).status).toBe(403);
    expect((await other.req('/api/settings', 'bob-token', { llm: { autoText: false } })).status).toBe(403);
    expect((await other.req('/api/rescan', 'bob-token', {}, 'POST')).status).toBe(403);
    expect((await other.req('/api/members', 'bob-token')).status).toBe(200);
    const service = await sshFixture(1000);
    expect(await (await service.req('/api/auth/me', 'bob-token')).json()).toMatchObject({ canManageInstallation: true });
    expect((await service.req('/api/settings', 'bob-token', { scan: { mode: 'all' } })).status).toBe(200);
    // 서버 실행 계정으로 접속해도 일반 회원은 설치 설정을 다루지 못한다.
    expect(await (await service.req('/api/auth/me')).json()).toMatchObject({ canManageInstallation: false });
    expect((await service.req('/api/settings', 'alice-token', { scan: { mode: 'all' } })).status).toBe(403);
    // 공용 서버(shared)의 관리자는 지금처럼 다룰 수 있다.
    expect(await (await (await fixture()).req('/api/auth/me', 'bob-token')).json()).toMatchObject({ canManageInstallation: true });
  });

  it('접속한 계정을 확인하지 못하면 서버 기록을 보여 주지 않는다', async () => {
    const f = await sshFixture(null);
    expect(await (await f.req('/api/auth/me')).json()).toMatchObject({ authenticated: true, osUser: null });
    expect(await (await f.req('/api/accounts')).json()).toEqual([]);
    // passwd 에 없는 uid 도 같은 처리
    const unknown = await sshFixture(4242);
    expect(await (await unknown.req('/api/accounts')).json()).toEqual([]);
  });

  it('개발 프록시의 접속자 헤더는 서버와 같은 계정이 연 연결에서만 믿는다', async () => {
    const headers = (value: string) => ({ authorization: 'Bearer alice-token', [PEER_UID_HEADER]: value });
    const viaProxy = await sshFixture(1000);
    expect(await (await viaProxy.app.request('/api/auth/me', { headers: headers('1099') })).json()).toMatchObject({ osUser: 'user99' });
    expect(await (await viaProxy.app.request('/api/auth/me', { headers: headers('') })).json()).toMatchObject({ osUser: null });
    const direct = await sshFixture(1099);
    expect(await (await direct.app.request('/api/auth/me', { headers: headers('1000') })).json()).toMatchObject({ osUser: 'user99' });
  });

  it.skipIf(!procNetAvailable())('실제 TCP 연결의 상대편 계정을 /proc/net/tcp 에서 찾는다', async () => {
    const self = process.getuid!();
    const homes = new Map([['/synthetic/self', { username: 'self-user', uid: self }], ['/synthetic/other', { username: 'other-user', uid: self + 1 }]]);
    const f = await fixture(fakeCloud(), 'ssh', { passwd: async () => homes });
    const server = serve({ fetch: f.app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/me`;
      expect(await (await fetch(url, { headers: { authorization: 'Bearer alice-token' } })).json()).toMatchObject({ osUser: 'self-user' });
      // 같은 계정의 프로세스가 연 연결이므로 개발 프록시 헤더로 취급한다.
      expect(await (await fetch(url, { headers: { authorization: 'Bearer alice-token', [PEER_UID_HEADER]: String(self + 1) } })).json()).toMatchObject({ osUser: 'other-user' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('Supabase 설치 설정', () => {
  it('앱 복귀 주소의 프로토콜·호스트·포트와 공개 주소 설정을 검사한다', () => {
    expect(normalizeAppUrl('http://localhost:5173', 'local')).toBe('http://localhost:5173/');
    expect(normalizeAppUrl('http://[::1]:8787/', 'local')).toBe('http://[::1]:8787/');
    expect(() => normalizeAppUrl('http://app.example.test/', 'shared')).toThrow();
    expect(normalizeAppUrl('http://127.0.0.1:3318', 'ssh')).toBe('http://127.0.0.1:3318/');
    expect(() => normalizeAppUrl('https://app.example.test/', 'ssh')).toThrow();
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
    expect(cloudConfig({ ...env, VIBE_TEACHER_DEPLOYMENT: 'ssh' })).toMatchObject({ deployment: 'ssh', secure: false });
    // 회원 로그인 없이 SSH 터널 서버를 띄우면 모든 접속자가 서버 실행 계정으로 보이므로 거절한다.
    expect(() => cloudConfig({ VIBE_TEACHER_DEPLOYMENT: 'ssh' })).toThrow('VIBE_TEACHER_AUTH_MODE=supabase');
  });
});
