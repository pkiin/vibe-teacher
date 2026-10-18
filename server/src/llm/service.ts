import { ENRICH_PROMPT_VERSION, EnrichmentSchema, type BuiltSummary, type ConceptHit, type EnrichStartResponse, type EnrichmentRecord, type LlmProviderId, type LlmProviderOption, type LlmStatus, type NormalizedSession } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../analyzers/built/index';
import type { ConfigStore, Paths } from '../config/store';
import { enrichCacheKey, readEnrichment, writeEnrichment } from './cache';
import { buildDigest } from './digest';
import { JobQueue } from './jobs';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { probeProviders, resolveLlm, type ResolvedLlm } from './select';
import type { LlmProvider } from './types';

export interface EnrichServiceOptions {
  store: ConfigStore;
  paths: Paths;
  env?: NodeJS.ProcessEnv;
  /** 테스트용 제공자 주입 */
  providerOverride?: LlmProvider | null;
  buildBuilt?: (session: NormalizedSession) => BuiltSummary;
}

export class EnrichService {
  readonly jobs = new JobQueue();
  private resolved: { at: number; value: ResolvedLlm } | null = null;

  constructor(private readonly opts: EnrichServiceOptions) {}

  invalidate(): void {
    this.resolved = null;
  }

  /** 위키 AI 보강처럼 같은 제공자 설정을 쓰는 다른 기능용 */
  resolveProvider(): Promise<ResolvedLlm> {
    return this.resolve();
  }

  async providerOptions(): Promise<LlmProviderOption[]> {
    if (this.opts.providerOverride !== undefined) {
      const p = this.opts.providerOverride;
      return p ? [{ id: p.id, available: true }] : [];
    }
    return probeProviders(this.opts.store.get().llm, this.opts.paths.llmCwd, this.opts.env ?? process.env);
  }

  private async resolve(): Promise<ResolvedLlm> {
    if (this.opts.providerOverride !== undefined) {
      const p = this.opts.providerOverride;
      return { provider: p, status: { resolvedProvider: p?.id ?? 'none', available: !!p, reason: p ? undefined : '테스트: 제공자 없음' } };
    }
    if (this.resolved && Date.now() - this.resolved.at < 60_000) return this.resolved.value;
    const value = await resolveLlm(this.opts.store.get().llm, this.opts.paths.llmCwd, this.opts.env ?? process.env);
    this.resolved = { at: Date.now(), value };
    return value;
  }

  async status(): Promise<LlmStatus> {
    return (await this.resolve()).status;
  }

  private candidateKeys(session: NormalizedSession, providerId: LlmProviderId | 'none'): string[] {
    const model = this.opts.store.get().llm.model;
    const ids: LlmProviderId[] = providerId === 'none' ? ['claude-cli', 'anthropic-sdk'] : [providerId, ...(['claude-cli', 'anthropic-sdk'] as LlmProviderId[]).filter((x) => x !== providerId)];
    return ids.map((id) => enrichCacheKey(session, id, model, ENRICH_PROMPT_VERSION));
  }

  /** 어느 제공자로든 만들어 둔 결과가 있으면 돌려준다 */
  async getCached(session: NormalizedSession): Promise<EnrichmentRecord | null> {
    const { status } = await this.resolve();
    for (const k of this.candidateKeys(session, status.resolvedProvider)) {
      const rec = await readEnrichment(this.opts.paths.enrichCacheDir, k);
      if (rec) return rec;
    }
    return null;
  }

  mergeConcepts(ruleBased: ConceptHit[], record: EnrichmentRecord): ConceptHit[] {
    const out = ruleBased.map((c) => ({ ...c }));
    for (const lc of record.data.concepts) {
      const note = { explanation: lc.explanation, whyHere: lc.whyHere, example: lc.example };
      const target = lc.id ? out.find((c) => c.id === lc.id) : undefined;
      if (target) {
        target.llm = note;
      } else {
        out.push({
          id: lc.id ?? `llm-${out.length + 1}`,
          name: lc.name,
          category: 'AI 제안',
          level: lc.level,
          explanation: lc.explanation,
          whyHere: lc.whyHere,
          score: 0,
          evidence: [],
          llm: note,
        });
      }
    }
    return out;
  }

  async start(session: NormalizedSession, concepts: ConceptHit[], force = false): Promise<EnrichStartResponse> {
    const { provider, status } = await this.resolve();
    if (!provider) throw new EnrichUnavailable(status.reason ?? 'AI 제공자를 사용할 수 없습니다');
    const model = this.opts.store.get().llm.model;
    const key = enrichCacheKey(session, provider.id, model, ENRICH_PROMPT_VERSION);
    if (!force) {
      const cached = await readEnrichment(this.opts.paths.enrichCacheDir, key);
      if (cached) return { status: 'done', result: cached, cached: true };
    }
    const built = (this.opts.buildBuilt ?? summarizeBuilt)(session);
    const digest = buildDigest(session, built, concepts);
    const cfg = this.opts.store.get().llm;
    const job = this.jobs.enqueue(session.key, async (signal) => {
      const res = await provider.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(digest),
        schema: EnrichmentSchema,
        schemaName: 'session_enrichment',
        // 생각(thinking) 토큰도 max_tokens 에 포함되므로 여유 있게 잡는다 (CLI 에는 적용되지 않음)
        maxTokens: 32_000,
        timeoutMs: cfg.timeoutMs,
        signal,
      });
      const record: EnrichmentRecord = {
        sessionKey: session.key,
        provider: res.provider,
        model: res.model,
        promptVersion: ENRICH_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
        durationMs: res.durationMs,
        costUsd: res.costUsd,
        usage: res.usage,
        data: res.data,
      };
      await writeEnrichment(this.opts.paths.enrichCacheDir, key, record);
      return record;
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}

export class EnrichUnavailable extends Error {
  readonly status = 409;
  readonly code = 'llm_unavailable';
}
