import { z } from 'zod';
import type { Deployment, LlmProviderSetting } from '@vibe-teacher/shared';

const KeySchema = z.string().trim().min(1).max(4096);
const UuidSchema = z.uuid();
/** 리눅스 계정 이름 (32자 이하). UUID(36자)와 길이로도 겹치지 않아 잘못 친 UUID 가 계정 이름으로 읽히지 않는다. */
const OS_ACCOUNT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$/;

/** 키나 JSON 원문을 오류에 포함하지 않는다. */
export class AiKeysConfigError extends Error {
  constructor(message = 'VIBE_TEACHER_USER_OPENROUTER_KEYS는 Supabase 사용자 UUID(ssh에서는 접속하는 OS 계정 이름도 가능)를 키로, OpenRouter API 키를 값으로 갖는 JSON 객체여야 합니다') { super(message); }
}

export interface UserOpenRouterKeys {
  /** Supabase 사용자 UUID(소문자) → 키 */
  users: Map<string, string>;
  /** SSH 터널 서버에서 연결을 연 OS 계정 이름 → 키. 가입 전에 미리 등록해 둘 수 있다 */
  osAccounts: Map<string, string>;
}

/** 이름이 UUID 면 회원 키, 아니면 OS 계정 키로 읽는다. OS 계정 키는 연결한 계정을 커널 기록으로 확인하는 ssh 에서만 받는다. */
export function userOpenRouterKeys(env: NodeJS.ProcessEnv, deployment: Deployment = 'shared'): UserOpenRouterKeys {
  const keys: UserOpenRouterKeys = { users: new Map(), osAccounts: new Map() };
  const raw = env.VIBE_TEACHER_USER_OPENROUTER_KEYS?.trim();
  if (!raw) return keys;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AiKeysConfigError(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiKeysConfigError();
  for (const [name, rawKey] of Object.entries(value)) {
    const key = KeySchema.safeParse(rawKey);
    if (!key.success) throw new AiKeysConfigError();
    if (UuidSchema.safeParse(name).success) {
      const id = name.toLowerCase();
      if (keys.users.has(id)) throw new AiKeysConfigError();
      keys.users.set(id, key.data);
    } else if (OS_ACCOUNT.test(name)) {
      keys.osAccounts.set(name, key.data);
    } else throw new AiKeysConfigError();
  }
  if (keys.osAccounts.size && deployment !== 'ssh') {
    throw new AiKeysConfigError('VIBE_TEACHER_USER_OPENROUTER_KEYS의 OS 계정 이름 항목은 VIBE_TEACHER_DEPLOYMENT=ssh 에서만 쓸 수 있습니다. 공용 서버(shared)에서는 Supabase 사용자 UUID로 등록하세요');
  }
  return keys;
}

/**
 * 인증된 UUID·관리자 여부와, SSH 터널 서버에서는 커널 기록으로 확인한 접속 OS 계정만 받는다.
 * 공용 서버·SSH 터널 서버의 일반 회원은 등록된 본인 키만 사용한다 (UUID 등록 → 접속 OS 계정 등록 순서).
 */
export function userLlmEnvironment(
  identity: { userId?: string; isAdmin: boolean; osAccount?: string | null },
  deployment: Deployment,
  configuredProvider: LlmProviderSetting,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  const personalKey = source.OPENROUTER_API_KEY?.trim();
  const adminKey = source.VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY?.trim();
  // 하위 제공자와 CLI에 전체 회원 키 목록·관리자 전용 키를 넘기지 않는다.
  delete env.VIBE_TEACHER_USER_OPENROUTER_KEYS;
  delete env.VIBE_TEACHER_ADMIN_OPENROUTER_API_KEY;
  if (deployment !== 'local') {
    const keys = userOpenRouterKeys(source, deployment);
    const memberKey = (identity.userId ? keys.users.get(identity.userId.toLowerCase()) : undefined)
      || (deployment === 'ssh' && identity.osAccount ? keys.osAccounts.get(identity.osAccount) : undefined);
    env.OPENROUTER_API_KEY = memberKey || (identity.isAdmin ? adminKey || personalKey : undefined) || '';
    // CLI로 우회해 관리자 비용으로 실행하면 사용자별 키 추적이 깨진다.
    const provider = source.VIBE_TEACHER_LLM_PROVIDER?.trim() || configuredProvider;
    env.VIBE_TEACHER_LLM_PROVIDER = provider === 'none' ? 'none' : 'openrouter';
  } else {
    env.OPENROUTER_API_KEY = personalKey || (identity.isAdmin ? adminKey : undefined) || '';
  }
  return env;
}
