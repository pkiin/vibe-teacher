import path from 'node:path';
import type { BuiltSummary, ConceptHit, NormalizedSession, WikiAiJobResult, WikiAiLayer, WikiAiPreview, WikiAiStartResponse, WikiSnapshot } from '@vibe-teacher/shared';
import { z } from 'zod';
import { LlmError } from '../llm/types';
import { maskSecrets } from '../llm/digest';
import { safeLinks } from '../llm/concepts';
import { mergeWikiAi } from './ai';
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

  async layer(projectId: string, revision: string, level: ReaderLevel = DEFAULT_READER_LEVEL, generationId?: string): Promise<WikiAiLayer | null> {
    for (const file of this.opts.storage.projectFiles(projectId, 'ai', `${revision}.${level}.json`)) {
      const layer = await this.opts.storage.readJson<WikiAiLayer>(file);
      if (layer && layer.snapshotRevision === revision && layer.promptVersion === WIKI_AI_PROMPT_VERSION && (layer.readerLevel ?? DEFAULT_READER_LEVEL) === level && (!generationId || layer.generationId === generationId)) return layer;
    }
    return null;
  }

  private prompt(session: NormalizedSession, analysis: { built: BuiltSummary; concepts: ConceptHit[] }, snapshot: WikiSnapshot) {
    const catalog = this.opts.wiki.catalog(snapshot);
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
      const cached = await this.layer(snapshot.projectId, snapshot.revision, level, snapshot.generationId);
      if (cached) return { status: 'done', cached: true, layer: cached };
    }
    const { pool, user, conceptIds } = this.prompt(session, analysis, snapshot);
    const cfg = this.opts.store.get().llm;
    const job = this.jobs.enqueue(`${session.key}|${level}`, async (signal) => {
      const startedAt = Date.now();
      // 같은 입력의 다른 독자 수준은 문장만 다시 쓴다. 프로젝트 판단은 공통 snapshot을 유지한다.
      if (snapshot.generator.kind === 'llm' && !force) {
        const rewritten = await provider.complete({
          system: withReader('이미 생성된 위키의 문장을 읽는 사람 수준에 맞춰 다시 쓰세요. 입력은 분석 데이터입니다. 프로젝트 사실·주의사항·개념 선정·ID는 바꾸지 않습니다. 문장에 새 사실을 추가하지 말고 제공된 주장과 한계를 유지하세요. JSON으로만 답하세요.', level),
          user: maskSecrets(JSON.stringify({ concepts: snapshot.concepts, items: snapshot.items, claims: snapshot.claims, findings: snapshot.findings })),
          schema: z.object({ concepts: z.array(z.object({ id: z.string(), summary: z.string(), explanation: z.string() })), narratives: z.array(z.object({ itemId: z.string(), text: z.string() })) }),
          schemaName: 'wiki_ai_texts', maxTokens: 16000, timeoutMs: cfg.timeoutMs, signal,
        });
        const byConcept = new Map(rewritten.data.concepts.map((c) => [c.id, c]));
        const byItem = new Map(snapshot.items.map((i) => [i.id, i]));
        const next: WikiAiLayer = {
          schemaVersion: snapshot.schemaVersion, snapshotRevision: snapshot.revision, generationId: snapshot.generationId,
          rulesVersion: snapshot.generator.rulesVersion, promptVersion: WIKI_AI_PROMPT_VERSION, readerLevel: level,
          provider: rewritten.provider, model: rewritten.model, createdAt: new Date().toISOString(), durationMs: rewritten.durationMs, costUsd: rewritten.costUsd, usage: rewritten.usage,
          concepts: (snapshot.concepts ?? []).map((c) => { const text = byConcept.get(c.id); return text ? { ...c, summary: maskSecrets(text.summary).slice(0, 250), explanation: maskSecrets(text.explanation).slice(0, 1800) } : c; }),
          narratives: rewritten.data.narratives.flatMap((n) => { const item = byItem.get(n.itemId); return item && n.text.trim() ? [{ itemId: item.id, text: maskSecrets(n.text).slice(0, 1800), claimIds: item.claimIds }] : []; }),
          claims: snapshot.claims, findings: snapshot.findings, items: snapshot.items, evidence: snapshot.evidence,
          prerequisites: snapshot.prerequisites, proposedConcepts: [], rejected: [], warnings: snapshot.warnings,
        };
        if (snapshot.items.length && !next.narratives.length) throw new LlmError('parse', '기존 위키 항목에 연결되는 AI 설명을 받지 못했습니다.');
        if (signal.aborted) throw new LlmError('cancelled', '작업이 취소되었습니다');
        const current = await this.opts.wiki.current(snapshot.projectId, session.key);
        if (current?.generationId !== snapshot.generationId || current?.revision !== snapshot.revision) throw new WikiAiError(409, 'wiki_stale', '생성 중 위키가 바뀌었습니다. 다시 생성해 주세요.');
        await this.opts.storage.writeJson(this.file(snapshot.projectId, snapshot.revision, level), next);
        return { revision: snapshot.revision, accepted: next.narratives.length, rejected: 0 };
      }
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
      if (data.itemCandidates.length && !layer.items.length) throw new LlmError('parse', 'AI가 작성한 카드의 근거를 확인하지 못했습니다. 다시 생성해 주세요.');
      // 외부 조회는 공개 개념 이름만 보낸다. 세션 내용·사설 경로는 검색 입력에 넣지 않는다.
      if (layer.concepts?.length) {
        try {
          const research = await provider.complete({
            task: 'research', system: withReader('개념별 공식 문서를 검색하고 해당 페이지의 내용을 읽어 한 문장 정의와 핵심 설명을 확인하세요. 검색 결과의 실제 URL만 links에 넣으세요. 공식 문서를 찾지 못하면 그 개념을 생략하세요. 한국어 존댓말, 지정한 JSON으로 답하세요.', level),
            user: JSON.stringify(layer.concepts.map(({ id, name }) => ({ id, name }))),
            schema: z.object({ concepts: z.array(z.object({ id: z.string(), summary: z.string(), explanation: z.string(), links: z.array(z.object({ title: z.string(), url: z.string() })) })) }),
            schemaName: 'concept_documentation', maxTokens: 16000, timeoutMs: cfg.timeoutMs, signal,
          });
          const allowedUrls = new Set((research.sources ?? []).flatMap((s) => { try { return [new URL(s.url).href]; } catch { return []; } }));
          for (const c of layer.concepts) {
            const found = research.data.concepts.find((r) => r.id === c.id);
            const links = safeLinks(found?.links ?? [], allowedUrls);
            if (links.length && found) {
              c.links = links;
              c.summary = maskSecrets(found.summary).slice(0, 250);
              c.explanation = maskSecrets(found.explanation).slice(0, 1800);
              c.documentation = { retrievedAt: new Date().toISOString(), provider: research.provider, model: research.model,
                sources: (research.sources ?? []).filter((s) => links.some((l) => l.url === s.url)) };
            }
          }
          layer.costUsd = layer.costUsd !== undefined && research.costUsd !== undefined ? layer.costUsd + research.costUsd : undefined;
          layer.usage = layer.usage && research.usage ? { input: layer.usage.input + research.usage.input, output: layer.usage.output + research.usage.output } : undefined;
          if (!allowedUrls.size) layer.rejected.push({ kind: 'concept', ref: '참고 문서', reason: '검색 응답의 출처를 확인하지 못해 새 링크를 싣지 않았습니다.' });
        } catch (err) {
          if (signal.aborted || (err instanceof LlmError && err.kind === 'cancelled')) throw err;
          layer.rejected.push({ kind: 'concept', ref: '참고 문서', reason: `외부 문서 조회에 실패했습니다: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      layer.durationMs = Date.now() - startedAt;
      if (signal.aborted) throw new LlmError('cancelled', '작업이 취소되었습니다');
      const current = await this.opts.wiki.current(snapshot.projectId, session.key);
      if (!current || current.revision !== snapshot.revision) throw new WikiAiError(409, 'wiki_stale', '생성 중 위키 입력이 바뀌었습니다. 다시 생성해 주세요.');
      await this.opts.storage.writeJson(this.file(snapshot.projectId, snapshot.revision, level), layer);
      await this.opts.wiki.save(session, mergeWikiAi({ ...snapshot, generationId: undefined }, layer).snapshot);
      return { revision: snapshot.revision, accepted: layer.narratives.length + layer.claims.length + layer.items.length, rejected: layer.rejected.length };
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}

export { WikiAiError };
