import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SupabaseAuth } from '../src/auth/supabase';
import type { AuthUser } from '../src/auth/service';
import { CloudRuntime } from '../src/cloud/runtime';
import { ConfigStore, resolvePaths } from '../src/config/store';
import type { AppDeps } from '../src/routes/deps';

// 이 검사는 인증 사용자 → 제공자·키·요청 경계를 검사한다. 기억 DB는 연결하지 않는다.
vi.mock('../src/wiki/service', () => ({ createWikiServices: () => ({ wiki: {}, learner: {}, assessments: {}, wikiAi: {}, help: {}, prefs: {}, memory: {} }) }));

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function fixture() {
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-install-key');
  vi.stubEnv('VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY', 'synthetic-admin-key');
  vi.stubEnv('VIBE_TEACHER_USER_OPENROUTER_KEYS', JSON.stringify({ [ALICE]: 'synthetic-alice-key', [BOB]: 'synthetic-bob-key' }));
  vi.stubEnv('VIBE_TEACHER_LLM_PROVIDER', 'auto');
  const requests: string[] = [];
  vi.stubGlobal('fetch', (async (input, init) => {
    if (String(input).endsWith('/models')) return Response.json({ data: [] });
    requests.push(new Headers(init?.headers).get('authorization') ?? '');
    return Response.json({ model: 'synthetic/model', choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }] });
  }) as typeof fetch);
  const paths = resolvePaths('/synthetic/vibe-teacher');
  const store = new ConfigStore(paths);
  const auth = { cloud: new SupabaseAuth({ url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'shared', secure: true }, paths.home) };
  const base = { paths, store, auth, index: { getProjectIds: (id: string) => [id] } } as unknown as AppDeps;
  const runtime = new CloudRuntime(base);
  const user = (id: string, isAdmin = false): AuthUser => ({ username: `sb_${id}`, isAdmin, via: 'cookie', cloud: { userId: id, email: 'synthetic@example.test', accessToken: 'synthetic-jwt', approved: true, accountIds: [], localOwner: false } });
  return { runtime, user, requests };
}

describe('공용 서버의 사용자별 AI 실행', () => {
  it('승인된 두 회원의 동시 요청도 각자의 인증 키로 전송한다', async () => {
    const f = fixture();
    const alice = f.runtime.forUser(f.user(ALICE));
    const bob = f.runtime.forUser(f.user(BOB));
    expect(alice.enrich).not.toBe(bob.enrich);
    expect(alice.enrich.providerEnvOverride).toBe('openrouter');
    const providers = await Promise.all([alice.enrich.resolveProvider(), bob.enrich.resolveProvider()]);
    await Promise.all(providers.map(async ({ provider }) => {
      expect(provider?.id).toBe('openrouter');
      await provider!.complete({ system: '합성 시스템', user: '합성 질문', schema: z.object({ answer: z.string() }), schemaName: 'synthetic', maxTokens: 100, timeoutMs: 5000 });
    }));
    expect(f.requests.sort()).toEqual(['Bearer synthetic-alice-key', 'Bearer synthetic-bob-key']);
  });

  it('회원 키를 회수하면 기존 제공자 캐시를 무효화하고 관리자 키로 대체하지 않는다', async () => {
    const f = fixture();
    const user = f.user(ALICE);
    const before = f.runtime.forUser(user);
    expect((await before.enrich.status()).available).toBe(true);
    vi.stubEnv('VIBE_TEACHER_USER_OPENROUTER_KEYS', JSON.stringify({ [BOB]: 'synthetic-bob-key' }));
    const after = f.runtime.forUser(user);
    expect(after).toBe(before);
    expect(await after.enrich.status()).toMatchObject({ available: false, reason: expect.stringContaining('키 등록') });
    expect(f.requests).toEqual([]);
  });

  it('관리자 상태가 해제되면 캐시된 개발용 키도 사용할 수 없다', async () => {
    const f = fixture();
    const id = '33333333-3333-4333-8333-333333333333';
    expect((await f.runtime.forUser(f.user(id, true)).enrich.status()).available).toBe(true);
    const status = await f.runtime.forUser(f.user(id, false)).enrich.status();
    expect(status.available).toBe(false);
    expect(JSON.stringify(status)).not.toContain('synthetic-admin-key');
    expect(f.requests).toEqual([]);
  });
});
