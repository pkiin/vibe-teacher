import { maskSecrets } from '../llm/digest';
import type { AiCallRecord, AiLog, AiRunRecord } from '../llm/log';
import { CloudError, type CloudClient } from './client';

/** 저장 전 정리: 비밀값을 가리고, PostgreSQL jsonb 가 받지 않는 NUL 문자를 바꾼다. */
export function toJsonb(value: unknown): unknown {
  if (typeof value === 'string') return maskSecrets(value).replace(/\u0000/g, '�');
  if (Array.isArray(value)) return value.map(toJsonb);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key.replace(/\u0000/g, '�'), toJsonb(v)]));
  return value;
}

const finite = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * AI 호출 기록을 사용자 토큰으로 vt_ai_calls·vt_ai_runs 에 추가한다 (RLS: 본인 행 추가만).
 * user_id 는 검증한 인증 주체에서만 받는다. 기록 실패는 AI 작업을 막지 않고 서버 로그에 코드만 남긴다.
 */
export class CloudAiLog implements AiLog {
  constructor(private readonly client: CloudClient, private readonly userId: string) {}

  async call(r: AiCallRecord): Promise<void> {
    const t = r.trace;
    await this.insert('vt_ai_calls', {
      id: r.id, user_id: this.userId, run_id: t?.runId ?? null, feature: t?.feature ?? null,
      project_id: t?.projectId ?? null, session_key: t?.sessionKey ?? null, reader_level: t?.readerLevel ?? null,
      provider: r.provider, task: r.task, schema_name: r.schemaName, attempt: r.attempt, output_mode: r.outputMode,
      requested_model: r.requestedModel ?? null, model: r.model ?? r.requestedModel ?? null, generation_id: r.generationId ?? null,
      status: r.status, error: r.error ? toJsonb(r.error) : null, http_status: r.httpStatus ?? null,
      request: toJsonb(r.request ?? {}), response: r.response === undefined ? null : toJsonb(r.response), output: r.output === undefined ? null : toJsonb(r.output),
      input_tokens: int(r.usage?.inputTokens), output_tokens: int(r.usage?.outputTokens), total_tokens: int(r.usage?.totalTokens),
      cached_tokens: int(r.usage?.cachedTokens), reasoning_tokens: int(r.usage?.reasoningTokens), usage: r.usage?.raw === undefined ? null : toJsonb(r.usage.raw),
      cost_usd: finite(r.costUsd), started_at: r.startedAt, duration_ms: Math.max(0, Math.round(r.durationMs)),
    });
  }

  async run(r: AiRunRecord): Promise<void> {
    const t = r.trace;
    await this.insert('vt_ai_runs', {
      id: t.runId, user_id: this.userId, feature: t.feature, project_id: t.projectId ?? null, session_key: t.sessionKey ?? null, reader_level: t.readerLevel ?? null,
      status: r.status, artifact_key: r.artifactKey ?? null, result: r.result === undefined ? null : toJsonb(r.result), error: r.error ? toJsonb(r.error) : null,
      started_at: r.startedAt, finished_at: r.finishedAt,
    });
  }

  private async insert(table: 'vt_ai_calls' | 'vt_ai_runs', row: Record<string, unknown>): Promise<void> {
    try {
      // 요청·응답 본문이 커서 일반 저장보다 시간 여유를 둔다.
      await this.client.call(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      console.warn(`[ai-log] ${table} 기록을 저장하지 못했습니다 (${err instanceof CloudError ? err.code : 'unknown'}). 관리자에게 AI 호출 기록 마이그레이션 적용을 확인하세요.`);
    }
  }
}
