import { z } from 'zod';
import type { Deployment, LlmProviderSetting } from '@vibe-teacher/shared';

const UserKeysSchema = z.record(z.uuid(), z.string().trim().min(1).max(4096));

/** 키나 JSON 원문을 오류에 포함하지 않는다. */
export class AiKeysConfigError extends Error {
  constructor() { super('VIBE_TEACHER_USER_OPENROUTER_KEYS는 Supabase 사용자 UUID를 키로, OpenRouter API 키를 값으로 갖는 JSON 객체여야 합니다'); }
}

export function userOpenRouterKeys(env: NodeJS.ProcessEnv): Record<string, string> {
  const raw = env.VIBE_TEACHER_USER_OPENROUTER_KEYS?.trim();
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AiKeysConfigError(); }
  const parsed = UserKeysSchema.safeParse(value);
  if (!parsed.success) throw new AiKeysConfigError();
  const entries = Object.entries(parsed.data).map(([id, key]) => [id.toLowerCase(), key] as const);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new AiKeysConfigError();
  return Object.fromEntries(entries);
}

/** 인증된 UUID·관리자 여부만 받는다. 공용 서버·SSH 터널 서버의 일반 회원은 등록된 본인 키만 사용한다. */
export function userLlmEnvironment(
  identity: { userId?: string; isAdmin: boolean },
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
    const keys = userOpenRouterKeys(source);
    const memberKey = identity.userId ? keys[identity.userId.toLowerCase()] : undefined;
    env.OPENROUTER_API_KEY = memberKey || (identity.isAdmin ? adminKey || personalKey : undefined) || '';
    // CLI로 우회해 관리자 비용으로 실행하면 사용자별 키 추적이 깨진다.
    const provider = source.VIBE_TEACHER_LLM_PROVIDER?.trim() || configuredProvider;
    env.VIBE_TEACHER_LLM_PROVIDER = provider === 'none' ? 'none' : 'openrouter';
  } else {
    env.OPENROUTER_API_KEY = personalKey || (identity.isAdmin ? adminKey : undefined) || '';
  }
  return env;
}
