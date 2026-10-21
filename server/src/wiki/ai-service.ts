import path from 'node:path';
import type { BuiltSummary, ConceptHit, NormalizedSession, WikiAiJobResult, WikiAiLayer, WikiAiPreview, WikiAiStartResponse, WikiSnapshot } from '@vibe-teacher/shared';
import { DEFAULT_READER_LEVEL, WIKI_AI_PROMPT_VERSION, type ReaderLevel } from '@vibe-teacher/shared';
import type { ConfigStore } from '../config/store';
import { JobQueue } from '../llm/jobs';
import { withReader } from '../llm/reader';
import type { ResolvedLlm } from '../llm/select';
import type { WikiStorage } from '../storage/store';
import { WIKI_AI_SYSTEM_PROMPT, WikiAiOutputSchema, acceptWikiAiOutput, buildEvidencePool, buildWikiAiPrompt } from './ai';
import type { WikiService } from './service';

class WikiAiError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 위키 AI 보강 실행·저장. 결과는 snapshot revision 단위로
 *   wiki/projects/<projectId>/ai/<revision>.<읽는 사람 수준>.json
 * 에 따로 저장하고, 화면에 보일 때 원장과 합친다 (mergeWikiAi).
 */
export class WikiAiService {
  readonly jobs = new JobQueue<WikiAiJobResult>();

  constructor(
    private readonly opts: {
      storage: WikiStorage;
      store: ConfigStore;
      wiki: WikiService;
      resolveProvider: () => Promise<ResolvedLlm>;
    },
  ) {}

  private file(projectId: string, revision: string, level: ReaderLevel): string {
    return path.join(this.opts.storage.projectDir(projectId), 'ai', `${revision}.${level}.json`);
  }

  async layer(projectId: string, revision: string, level: ReaderLevel = DEFAULT_READER_LEVEL): Promise<WikiAiLayer | null> {
    const layer = await this.opts.storage.readJson<WikiAiLayer>(this.file(projectId, revision, level));
    return layer && layer.snapshotRevision === revision && layer.promptVersion === WIKI_AI_PROMPT_VERSION && (layer.readerLevel ?? DEFAULT_READER_LEVEL) === level ? layer : null;
  }

  private prompt(session: NormalizedSession, analysis: { built: BuiltSummary; concepts: ConceptHit[] }, snapshot: WikiSnapshot) {
    const catalog = this.opts.wiki.catalog();
    const pool = buildEvidencePool(session, snapshot);
    const user = buildWikiAiPrompt({ session, built: analysis.built, concepts: analysis.concepts, snapshot, pool, catalog: catalog.concepts });
    return { pool, user, conceptIds: new Set(catalog.concepts.keys()) };
  }

  /** 보내기 전에 확인할 수 있도록 AI 에 보낼 내용을 그대로 돌려준다 */
  async preview(session: NormalizedSession, analysis: { built: BuiltSummary; concepts: ConceptHit[] }, snapshot: WikiSnapshot, level: ReaderLevel = DEFAULT_READER_LEVEL): Promise<WikiAiPreview> {
    const { status } = await this.opts.resolveProvider();
    const { user } = this.prompt(session, analysis, snapshot);
    const system = withReader(WIKI_AI_SYSTEM_PROMPT, level);
    return { llmStatus: status, chars: system.length + user.length, system, user };
  }

  async start(session: NormalizedSession, analysis: { built: BuiltSummary; concepts: ConceptHit[] }, snapshot: WikiSnapshot, force = false, level: ReaderLevel = DEFAULT_READER_LEVEL): Promise<WikiAiStartResponse> {
    const { provider, status } = await this.opts.resolveProvider();
    if (!provider) throw new WikiAiError(409, 'llm_unavailable', status.reason ?? 'AI 제공자를 사용할 수 없습니다');
    if (!force) {
      const cached = await this.layer(snapshot.projectId, snapshot.revision, level);
      if (cached) return { status: 'done', cached: true, layer: cached };
    }
    const { pool, user, conceptIds } = this.prompt(session, analysis, snapshot);
    const cfg = this.opts.store.get().llm;
    const job = this.jobs.enqueue(`${session.key}|${level}`, async (signal) => {
      const res = await provider.complete({
        system: withReader(WIKI_AI_SYSTEM_PROMPT, level),
        user,
        schema: WikiAiOutputSchema,
        schemaName: 'wiki_ai_candidates',
        maxTokens: 32_000,
        timeoutMs: Math.max(cfg.timeoutMs, 300_000),
        signal,
      });
      const { data, ...meta } = res;
      const layer: WikiAiLayer = { ...acceptWikiAiOutput({ snapshot, pool, output: data, conceptIds, result: meta }), readerLevel: level };
      await this.opts.storage.writeJson(this.file(snapshot.projectId, snapshot.revision, level), layer);
      return { revision: snapshot.revision, accepted: layer.narratives.length + layer.claims.length + layer.items.length, rejected: layer.rejected.length };
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}

export { WikiAiError };
