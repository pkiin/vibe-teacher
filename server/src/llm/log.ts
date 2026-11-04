import { randomUUID } from 'node:crypto';
import type { LlmProviderId, ReaderLevel } from '@vibe-teacher/shared';
import type { WikiStorage } from '../storage/store';
import { LlmError } from './types';
import { artifactSaved } from '../lib/progress';

/** 사용자 작업 하나의 종류. 실제 API 요청 여러 개(재시도·보조 확인 포함)를 묶는다. */
export type AiFeature = 'session_enrich' | 'session_wiki' | 'repo_wiki' | 'repo_feature' | 'knowledge_text' | 'help_answer' | 'practice_question' | 'memory_extract';

export interface AiTrace {
  runId?: string;
  feature: AiFeature;
  projectId?: string;
  sessionKey?: string;
  readerLevel?: ReaderLevel;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** 제공자가 돌려준 사용량 원문 */
  raw?: unknown;
}

/** 실제로 보낸 요청 하나. API 키·인증 헤더는 넣지 않는다. */
export interface AiCallRecord {
  id: string;
  trace?: AiTrace;
  provider: LlmProviderId;
  task: 'text' | 'research' | 'repo-inspect';
  schemaName: string;
  /** 같은 complete() 안의 몇 번째 요청인지 (출력 형식을 바꿔 다시 보내면 2) */
  attempt: number;
  outputMode: 'json_schema' | 'json_object' | 'prompt' | 'cli';
  requestedModel?: string;
  model?: string;
  generationId?: string;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'cancelled';
  error?: { kind: string; message: string; detail?: string };
  httpStatus?: number;
  request: unknown;
  response?: unknown;
  /** 스키마 검사를 통과한 결과 */
  output?: unknown;
  usage?: AiUsage;
  costUsd?: number;
}

/** 사용자 작업 하나의 최종 결과물. 토큰·요금 합계는 같은 runId 의 호출 기록에서 계산한다. */
export interface AiRunRecord {
  trace: AiTrace & { runId: string };
  status: 'done' | 'error' | 'cancelled';
  startedAt: string;
  finishedAt: string;
  /** 결과물을 저장한 저장소 키 (wiki 루트 기준, Supabase 문서·원장 키와 같음) */
  artifactKey?: string;
  result?: unknown;
  error?: { kind: string; message: string };
}

/** 구현은 기록 실패를 던지지 않는다. AI 결과 저장과 작업 진행을 기록 장애로 막지 않는다. */
export interface AiLog {
  call(record: AiCallRecord): Promise<void>;
  run(record: AiRunRecord): Promise<void>;
}

export interface AiRunHandle {
  readonly trace: AiTrace & { runId: string };
  /** 저장한 최종 결과물. 여러 번 부르면 마지막 것을 남긴다. */
  result(file: string | undefined, value: unknown): void;
}

export function newCallId(): string {
  return randomUUID();
}

export function errorInfo(err: unknown): { kind: string; message: string; detail?: string } {
  const e = err as { kind?: unknown; code?: unknown; message?: unknown; detail?: unknown };
  const kind = typeof e?.kind === 'string' ? e.kind : typeof e?.code === 'string' ? e.code : 'unknown';
  return { kind, message: typeof e?.message === 'string' ? e.message : String(err), ...(typeof e?.detail === 'string' ? { detail: e.detail } : {}) };
}

/**
 * 사용자 작업 하나를 감싸 실행 기록을 남긴다. 안의 AI 요청은 run.trace 를 넘겨 같은 runId 로 묶는다.
 * 저장소에 기록 대상(Supabase)이 없으면 기록 없이 실행만 한다.
 */
export async function withAiRun<T>(storage: WikiStorage | undefined, info: AiTrace, signal: AbortSignal | undefined, fn: (run: AiRunHandle) => Promise<T>): Promise<T> {
  const log = storage?.aiLog;
  const trace = { ...info, runId: randomUUID() };
  const startedAt = new Date().toISOString();
  let saved: { artifactKey?: string; result: unknown } | undefined;
  const run: AiRunHandle = {
    trace,
    result: (file, value) => { saved = { ...(file && storage ? { artifactKey: storage.keyOf(file) } : {}), result: value }; },
  };
  try {
    const out = await fn(run);
    artifactSaved();
    await log?.run({ trace, status: 'done', startedAt, finishedAt: new Date().toISOString(), ...saved });
    return out;
  } catch (err) {
    const cancelled = signal?.aborted || (err instanceof LlmError && err.kind === 'cancelled');
    const { kind, message } = errorInfo(err);
    await log?.run({ trace, status: cancelled ? 'cancelled' : 'error', startedAt, finishedAt: new Date().toISOString(), ...saved, error: { kind, message } });
    throw err;
  }
}
