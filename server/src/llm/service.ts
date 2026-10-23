import { DEFAULT_READER_LEVEL, ENRICH_PROMPT_VERSION, EnrichmentSchema, READER_LEVELS, type BuiltSummary, type ConceptHit, type EnrichStartResponse, type EnrichmentRecord, type LlmProviderId, type LlmProviderOption, type LlmStatus, type NormalizedSession, type ReaderLevel } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../analyzers/built/index';
import type { ConfigStore, Paths } from '../config/store';
import { enrichCacheKey, readEnrichment, writeEnrichment } from './cache';
import { buildDigest, maskSecrets, maskOutput } from './digest';
import { conceptId, safeLinks } from './concepts';
import { JobQueue } from './jobs';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { withReader } from './reader';
import { ModelCatalog } from './models';
import { modelFor, probeProviders, resolveLlm, type ResolvedLlm } from './select';
import type { LlmProvider } from './types';

export interface EnrichServiceOptions {
  store: ConfigStore;
  paths: Paths;
  env?: NodeJS.ProcessEnv;
  /** 테스트용 제공자 주입 */
  providerOverride?: LlmProvider | null;
  /** 테스트용 네트워크 주입 (OpenRouter·OpenAI) */
  fetch?: typeof fetch;
  buildBuilt?: (session: NormalizedSession) => BuiltSummary;
}

export class EnrichService {
  readonly jobs = new JobQueue();
  /** OpenRouter·OpenAI 모델 선택 목록 */
  readonly models: ModelCatalog;
  private resolved: { at: number; value: ResolvedLlm } | null = null;

  constructor(private readonly opts: EnrichServiceOptions) {
    this.models = new ModelCatalog({ fetch: opts.fetch, env: opts.env });
  }

  private get deps() {
    return { env: this.opts.env ?? process.env, catalog: this.models, fetch: this.opts.fetch };
  }

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
    return probeProviders(this.opts.store.get().llm, this.opts.paths.llmCwd, this.deps);
  }

  private async resolve(): Promise<ResolvedLlm> {
    if (this.opts.providerOverride !== undefined) {
      const p = this.opts.providerOverride;
      return { provider: p, status: { resolvedProvider: p?.id ?? 'none', available: !!p, reason: p ? undefined : '테스트: 제공자 없음' } };
    }
    if (this.resolved && Date.now() - this.resolved.at < 60_000) return this.resolved.value;
    const value = await resolveLlm(this.opts.store.get().llm, this.opts.paths.llmCwd, this.deps);
    this.resolved = { at: Date.now(), value };
    return value;
  }

  async status(): Promise<LlmStatus> {
    return (await this.resolve()).status;
  }

  private candidateKeys(session: NormalizedSession, providerId: LlmProviderId | 'none', levels: readonly ReaderLevel[]): string[] {
    const cfg = this.opts.store.get().llm;
    const all: LlmProviderId[] = ['claude-cli', 'openrouter'];
    const ids = providerId === 'none' ? all : [providerId, ...all.filter((x) => x !== providerId)];
    return levels.flatMap((level) => ids.map((id) => enrichCacheKey(session, id, modelFor(id, cfg), ENRICH_PROMPT_VERSION, level)));
  }

  /**
   * 어느 제공자로든 만들어 둔 결과가 있으면 돌려준다.
   * level 을 주면 그 읽는 사람 수준으로 쓴 것만, 'any' 면 어느 수준이든 (레포 위키 재료처럼 사실만 쓸 때).
   */
  async getCached(session: NormalizedSession, level: ReaderLevel | 'any' = DEFAULT_READER_LEVEL): Promise<EnrichmentRecord | null> {
    const { status } = await this.resolve();
    const levels = level === 'any' ? READER_LEVELS : [level];
    for (const k of this.candidateKeys(session, status.resolvedProvider, levels)) {
      const rec = await readEnrichment(this.opts.paths.enrichCacheDir, k);
      if (rec) return rec;
    }
    return null;
  }

  /** 목록의 선정과 순서는 AI 응답을 그대로 따른다. 규칙 카드를 섞지 않는다. */
  mergeConcepts(_ruleBased: ConceptHit[], record: EnrichmentRecord): ConceptHit[] {
    const seen = new Set<string>();
    return record.data.concepts.flatMap((c) => {
      const id = conceptId(c.id, c.name);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, name: c.name, category: c.category ?? '이번 작업의 개념', level: c.level, explanation: c.explanation,
        whyHere: c.whyHere, score: 0, evidence: (c.evidence ?? []).map((snippet) => ({ snippet })), links: safeLinks(c.links ?? []),
        llm: { explanation: c.explanation, whyHere: c.whyHere, example: c.example } }];
    });
  }

  /** 보내기 전에 확인할 수 있도록 세션 분석에 보낼 내용을 그대로 돌려준다 */
  preview(session: NormalizedSession, concepts: ConceptHit[], level: ReaderLevel = DEFAULT_READER_LEVEL): { system: string; user: string; chars: number } {
    const digest = buildDigest(session, (this.opts.buildBuilt ?? summarizeBuilt)(session), concepts);
    const user = buildUserPrompt(digest);
    const system = withReader(SYSTEM_PROMPT, level);
    return { system, user, chars: system.length + user.length };
  }

  async start(session: NormalizedSession, concepts: ConceptHit[], force = false, level: ReaderLevel = DEFAULT_READER_LEVEL): Promise<EnrichStartResponse> {
    const { provider, status } = await this.resolve();
    if (!provider) throw new EnrichUnavailable(status.reason ?? 'AI 제공자를 사용할 수 없습니다');
    if (!force) {
      const cached = await this.getCached(session, level);
      if (cached) return { status: 'done', result: cached, cached: true };
    }
    const built = (this.opts.buildBuilt ?? summarizeBuilt)(session);
    const digest = buildDigest(session, built, concepts);
    const cfg = this.opts.store.get().llm;
    const job = this.jobs.enqueue(`${session.key}|${level}`, async (signal) => {
      const res = await provider.complete({
        system: withReader(SYSTEM_PROMPT, level),
        user: buildUserPrompt(digest),
        schema: EnrichmentSchema,
        schemaName: 'session_enrichment',
        // 생각(thinking) 토큰도 max_tokens 에 포함되므로 여유 있게 잡는다 (CLI 에는 적용되지 않음)
        maxTokens: 32_000,
        timeoutMs: cfg.timeoutMs,
        signal,
      });
      const data = EnrichmentSchema.parse(maskOutput(res.data));
      const knownEvidence = new Set([
        ...[...built.filesCreated, ...built.filesModified, ...built.filesDeleted].flatMap((f) => [f.path, f.relPath].filter((p): p is string => !!p)),
        ...built.commandsRun.map((c) => c.command),
      ].map(maskSecrets));
      const inputUrls = new Set(digest.match(/https?:\/\/[^\s<>"')]+/g) ?? []);
      const record: EnrichmentRecord = {
        sessionKey: session.key,
        provider: res.provider,
        model: res.model,
        promptVersion: ENRICH_PROMPT_VERSION,
        readerLevel: level,
        createdAt: new Date().toISOString(),
        durationMs: res.durationMs,
        costUsd: res.costUsd,
        usage: res.usage,
        data: { ...data, concepts: data.concepts.slice(0, 12).map((c) => ({ ...c,
          links: safeLinks(c.links ?? [], inputUrls), evidence: (c.evidence ?? []).filter((e) => knownEvidence.has(e)),
        })) },
      };
      const actualKey = enrichCacheKey(session, res.provider, modelFor(res.provider, cfg), ENRICH_PROMPT_VERSION, level);
      await writeEnrichment(this.opts.paths.enrichCacheDir, actualKey, record);
      return record;
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}

export class EnrichUnavailable extends Error {
  readonly status = 409;
  readonly code = 'llm_unavailable';
}
