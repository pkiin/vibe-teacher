import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadDotEnv } from '../../src/config/dotenv';
import { defaultConfig } from '../../src/config/schema';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { userLlmEnvironment, userOpenRouterKeys } from '../../src/llm/credentials';
import { EnrichService } from '../../src/llm/service';
import { resolveLlm } from '../../src/llm/select';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const source: NodeJS.ProcessEnv = {
  PATH: '', HOME: '/synthetic', OPENROUTER_API_KEY: 'synthetic-install-key',
  VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY: 'synthetic-admin-key',
  VIBE_TEACHER_USER_OPENROUTER_KEYS: JSON.stringify({ [ALICE]: 'synthetic-alice-key', [BOB]: 'synthetic-bob-key' }),
};

describe('설치 방식과 인증 사용자별 AI 키', () => {
  it('로컬 사용자는 .env의 본인 키를 사용하고 관리자 키 목록을 전달받지 않는다', () => {
    const env = userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'local', 'auto', source);
    expect(env.OPENROUTER_API_KEY).toBe('synthetic-install-key');
    expect(env.VIBE_TEACHER_USER_OPENROUTER_KEYS).toBeUndefined();
    expect(env.VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY).toBeUndefined();
    expect(env.VIBE_TEACHER_LLM_PROVIDER).toBeUndefined();
    expect(source.OPENROUTER_API_KEY).toBe('synthetic-install-key');
    expect(userLlmEnvironment({ isAdmin: false }, 'local', 'openrouter', { OPENROUTER_API_KEY: 'synthetic-standalone-key' }).OPENROUTER_API_KEY).toBe('synthetic-standalone-key');
  });

  it('로컬 개인 키가 빈 값이어도 관리자 계정은 구분된 개발용 키를 사용할 수 있다', () => {
    const emptyPersonal = { ...source, OPENROUTER_API_KEY: '' };
    expect(userLlmEnvironment({ isAdmin: true }, 'local', 'auto', emptyPersonal).OPENROUTER_API_KEY).toBe('synthetic-admin-key');
    expect(userLlmEnvironment({ isAdmin: false }, 'local', 'auto', emptyPersonal).OPENROUTER_API_KEY).toBe('');
  });

  it('공용 서버는 본인 UUID에 등록된 키만 고르고 CLI·공용 개인 키 설정을 사용하지 않는다', () => {
    const alice = userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'shared', 'auto', source);
    const bob = userLlmEnvironment({ userId: BOB, isAdmin: false }, 'shared', 'claude-cli', source);
    expect(alice.OPENROUTER_API_KEY).toBe('synthetic-alice-key');
    expect(bob.OPENROUTER_API_KEY).toBe('synthetic-bob-key');
    expect(alice.VIBE_TEACHER_LLM_PROVIDER).toBe('openrouter');
    expect(bob.VIBE_TEACHER_LLM_PROVIDER).toBe('openrouter');
    expect(alice.VIBE_TEACHER_USER_OPENROUTER_KEYS).toBeUndefined();
  });

  it('등록되지 않은 공용 회원은 관리자 키나 다른 회원 키를 사용하지 않는다', async () => {
    const env = userLlmEnvironment({ userId: '33333333-3333-4333-8333-333333333333', isAdmin: false }, 'shared', 'auto', source);
    expect(env.OPENROUTER_API_KEY).toBe('');
    const service = new EnrichService({ store: new ConfigStore(resolvePaths('/synthetic')), paths: resolvePaths('/synthetic'), env, requireUserKey: true });
    expect(await service.status()).toMatchObject({ available: false, reason: expect.stringContaining('관리자에게 키 등록') });
  });

  it('SSH 터널 서버도 공용 서버처럼 본인 UUID의 키만 쓰고 서버 계정의 .env 키·CLI를 쓰지 않는다', () => {
    const alice = userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'ssh', 'claude-cli', source);
    expect(alice.OPENROUTER_API_KEY).toBe('synthetic-alice-key');
    expect(alice.VIBE_TEACHER_LLM_PROVIDER).toBe('openrouter');
    expect(userLlmEnvironment({ userId: '33333333-3333-4333-8333-333333333333', isAdmin: false }, 'ssh', 'auto', source).OPENROUTER_API_KEY).toBe('');
  });

  it('공용 서버 관리자도 UUID에 등록된 키가 우선하며 미등록이면 관리자 개발용 키를 사용한다', () => {
    expect(userLlmEnvironment({ userId: ALICE, isAdmin: true }, 'shared', 'auto', source).OPENROUTER_API_KEY).toBe('synthetic-alice-key');
    expect(userLlmEnvironment({ isAdmin: true }, 'shared', 'auto', source).OPENROUTER_API_KEY).toBe('synthetic-admin-key');
  });

  it('AI를 끄는 설정은 유지한다', async () => {
    for (const env of [userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'shared', 'none', source), userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'shared', 'auto', { ...source, VIBE_TEACHER_LLM_PROVIDER: 'none' })]) {
      expect(env.VIBE_TEACHER_LLM_PROVIDER).toBe('none');
      expect((await resolveLlm(defaultConfig().llm, '/synthetic', { env })).status.available).toBe(false);
    }
  });

  it('실제 OpenRouter 요청의 인증 헤더를 사용자별로 분리한다', async () => {
    const headers: string[] = [];
    const request = (async (_url, init) => {
      headers.push(new Headers(init?.headers).get('authorization') ?? '');
      return Response.json({ model: 'synthetic/model', choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }] });
    }) as typeof fetch;
    for (const userId of [ALICE, BOB]) {
      const env = userLlmEnvironment({ userId, isAdmin: false }, 'shared', 'auto', source);
      const { provider } = await resolveLlm(defaultConfig().llm, '/synthetic', { env, fetch: request });
      expect(provider?.id).toBe('openrouter');
      await provider!.complete({ system: '합성 시스템', user: '합성 질문', schema: z.object({ answer: z.string() }), schemaName: 'synthetic', maxTokens: 100, timeoutMs: 5000 });
    }
    expect(headers).toEqual(['Bearer synthetic-alice-key', 'Bearer synthetic-bob-key']);
  });

  it('잘못된 사용자 키 JSON은 실패하며 키 원문을 오류에 싣지 않는다', () => {
    const broken = [
      '{"broken":"synthetic-secret"', JSON.stringify({ [ALICE]: '' }), JSON.stringify({ [ALICE]: 7 }), '[]', 'null', '"synthetic-secret"',
      // 잘못 친 UUID(36자)·공백·경로 문자는 OS 계정 이름으로도 읽지 않는다.
      JSON.stringify({ '11111111-1111-4111-8111-11111111111g': 'synthetic-secret' }), JSON.stringify({ 'user 99': 'synthetic-secret' }), JSON.stringify({ '../user99': 'synthetic-secret' }),
      // 대소문자만 다른 같은 UUID
      JSON.stringify({ 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 'synthetic-secret', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA': 'synthetic-secret' }),
    ];
    for (const raw of broken) {
      try { userOpenRouterKeys({ VIBE_TEACHER_USER_OPENROUTER_KEYS: raw }, 'ssh'); throw new Error('검증이 누락됨'); }
      catch (error) { expect((error as Error).message).toContain('Supabase 사용자 UUID'); expect((error as Error).message).not.toContain('synthetic-secret'); }
    }
    expect(userOpenRouterKeys({})).toEqual({ users: new Map(), osAccounts: new Map() });
  });

  it('공용 서버(shared)는 OS 계정 이름 항목을 받지 않고 이름·키를 오류에 싣지 않는다', () => {
    const raw = JSON.stringify({ [ALICE]: 'synthetic-alice-key', user99: 'synthetic-user99-key' });
    for (const run of [() => userOpenRouterKeys({ VIBE_TEACHER_USER_OPENROUTER_KEYS: raw }, 'shared'), () => userLlmEnvironment({ userId: ALICE, isAdmin: false }, 'shared', 'auto', { VIBE_TEACHER_USER_OPENROUTER_KEYS: raw })]) {
      try { run(); throw new Error('검증이 누락됨'); }
      catch (error) {
        expect((error as Error).message).toContain('VIBE_TEACHER_DEPLOYMENT=ssh');
        expect((error as Error).message).not.toMatch(/user99|synthetic-/);
      }
    }
  });
});

describe('SSH 터널 서버의 OS 계정별 미리 등록한 키', () => {
  const CAROL = '33333333-3333-4333-8333-333333333333';
  const keys = (value: Record<string, string>): NodeJS.ProcessEnv => ({ ...source, VIBE_TEACHER_USER_OPENROUTER_KEYS: JSON.stringify(value) });
  const registered = keys({ user01: 'synthetic-user01-key', user99: 'synthetic-user99-key', [ALICE]: 'synthetic-alice-key' });

  it('가입 전에 OS 계정 이름으로 등록해 둔 키를 그 계정으로 터널을 연 회원이 쓴다', () => {
    const parsed = userOpenRouterKeys(registered, 'ssh');
    expect([...parsed.osAccounts.keys()]).toEqual(['user01', 'user99']);
    expect([...parsed.users.keys()]).toEqual([ALICE]);
    const carol = userLlmEnvironment({ userId: CAROL, isAdmin: false, osAccount: 'user99' }, 'ssh', 'claude-cli', registered);
    expect(carol.OPENROUTER_API_KEY).toBe('synthetic-user99-key');
    expect(carol.VIBE_TEACHER_LLM_PROVIDER).toBe('openrouter');
    expect(carol.VIBE_TEACHER_USER_OPENROUTER_KEYS).toBeUndefined();
    expect(userLlmEnvironment({ userId: CAROL, isAdmin: false, osAccount: 'user01' }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('synthetic-user01-key');
  });

  it('UUID 등록이 OS 계정 등록보다 우선한다', () => {
    expect(userLlmEnvironment({ userId: ALICE, isAdmin: false, osAccount: 'user99' }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('synthetic-alice-key');
  });

  it('접속 계정을 확인하지 못했거나 등록되지 않은 계정이면 다른 계정 키·관리자 키를 쓰지 않는다', () => {
    for (const osAccount of [null, undefined, 'user02', 'USER99', 'user9']) {
      expect(userLlmEnvironment({ userId: CAROL, isAdmin: false, osAccount }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('');
    }
    // Object.prototype 의 이름과 같은 계정도 등록된 키만 찾는다.
    for (const osAccount of ['constructor', 'toString', '__proto__']) {
      expect(userLlmEnvironment({ userId: CAROL, isAdmin: false, osAccount }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('');
    }
    // 관리자는 지금처럼 UUID → 접속 OS 계정 → 관리자 개발용 키 순서다.
    expect(userLlmEnvironment({ userId: CAROL, isAdmin: true, osAccount: 'user99' }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('synthetic-user99-key');
    expect(userLlmEnvironment({ userId: CAROL, isAdmin: true, osAccount: 'ubuntu' }, 'ssh', 'auto', registered).OPENROUTER_API_KEY).toBe('synthetic-admin-key');
  });

  it('공용 서버에는 접속 OS 계정을 넘겨도 쓰지 않는다', () => {
    const uuidOnly = keys({ [ALICE]: 'synthetic-alice-key' });
    expect(userLlmEnvironment({ userId: CAROL, isAdmin: false, osAccount: 'user99' }, 'shared', 'auto', uuidOnly).OPENROUTER_API_KEY).toBe('');
  });
});

describe('일반 사용자와 관리자 환경파일', () => {
  const directories: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  it('일반 예제의 빈 개인 키가 관리자 전용 변수의 키를 가리지 않는다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-ai-env-')); directories.push(dir);
    fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=\n');
    fs.writeFileSync(path.join(dir, '.env.admin'), 'VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY=synthetic-admin-key\n');
    vi.stubEnv('OPENROUTER_API_KEY', undefined);
    vi.stubEnv('VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY', undefined);
    loadDotEnv(path.join(dir, '.env')); loadDotEnv(path.join(dir, '.env.admin'));
    expect(userLlmEnvironment({ isAdmin: true }, 'local', 'auto').OPENROUTER_API_KEY).toBe('synthetic-admin-key');
  });
});
