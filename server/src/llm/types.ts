import type { z } from 'zod';
import type { LlmProviderId } from '@vibe-teacher/shared';

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LlmResult<T> {
  data: T;
  provider: LlmProviderId;
  model?: string;
  costUsd?: number;
  usage?: { input: number; output: number };
  durationMs: number;
}

export interface LlmAvailability {
  ok: boolean;
  reason?: string;
  detail?: string;
  version?: string;
}

export interface LlmProvider {
  id: LlmProviderId;
  availability(): Promise<LlmAvailability>;
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export type LlmErrorKind = 'auth' | 'budget' | 'timeout' | 'parse' | 'spawn' | 'network' | 'rate_limit' | 'cancelled' | 'unknown';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** stdout 처럼 잡음이 섞인 텍스트에서 마지막 완전한 JSON 객체를 찾는다 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = (lines[i] ?? '').trim();
    if (!l.startsWith('{')) continue;
    try {
      return JSON.parse(l);
    } catch {
      // continue
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // ignore
    }
  }
  throw new LlmError('parse', 'LLM 응답에서 JSON을 찾지 못했습니다', text.slice(0, 500));
}
