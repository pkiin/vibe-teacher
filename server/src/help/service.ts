import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_READER_LEVEL, type BuiltSummary, type ConceptHit, type HelpJobStatus, type HelpMessage, type HelpRequest, type NormalizedSession, type ReaderLevel, type WikiSnapshot } from '@vibe-teacher/shared';
import { JobQueue } from '../llm/jobs';
import { withAiRun } from '../llm/log';
import { withReader } from '../llm/reader';
import type { ResolvedLlm } from '../llm/select';
import { LlmError } from '../llm/types';
import { conceptFromHit } from '../llm/concepts';
import type { LearnerService } from '../learner/service';
import type { MemoryService } from '../memory/service';
import { maskSecrets } from '../llm/digest';
import type { ConfigStore } from '../config/store';
import type { WikiStorage } from '../storage/store';
import { mergeWikiAi } from '../wiki/ai';
import type { WikiAiService } from '../wiki/ai-service';
import type { WikiService } from '../wiki/service';
import { HELP_SYSTEM_PROMPT, HelpOutputSchema, acceptHelpOutput, buildHelpContext, buildHelpPrompt } from './answer';

/**
 * 도움 패널 질문·답변. 개인 기록으로만 남는다:
 *   wiki/learners/<learnerId>/projects/<projectId>/help.jsonl   (추가만, 같은 id 는 마지막 줄이 현재 상태)
 * 질문 활동은 learner 원장에 연결하고 설명 방침에 활용한다. 숙련 상태는 낮추지 않는다.
 */
export class HelpService {
  readonly jobs = new JobQueue<HelpMessage>();
  private readonly owners = new Map<string, { learnerId: string; projectId: string }>();
  /** 질문 id → 진행 중인 작업 id (서버 메모리) */
  private readonly jobByMessage = new Map<string, string>();

  constructor(
    private readonly opts: {
      storage: WikiStorage;
      store: ConfigStore;
      wiki: WikiService;
      wikiAi: WikiAiService;
      resolveProvider: () => Promise<ResolvedLlm>;
      learner: LearnerService;
      memory: MemoryService;
    },
  ) {}

  private file(learnerId: string, projectId: string): string {
    return path.join(this.opts.storage.learnerProjectDir(learnerId, projectId), 'help.jsonl');
  }

  private async all(learnerId: string, projectId: string): Promise<HelpMessage[]> {
    const latest = new Map<string, HelpMessage>();
    // 대표 폴더의 재시도·완료 기록이 예전 폴더의 같은 질문보다 우선한다.
    for (const file of this.opts.storage.learnerProjectFiles(learnerId, projectId, 'help.jsonl').reverse()) {
      for (const m of (await this.opts.storage.readJsonl<HelpMessage>(file)).items) latest.set(m.id, m);
    }
    return [...latest.values()].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  }

  private append(learnerId: string, projectId: string, m: HelpMessage): Promise<void> {
    return this.opts.storage.appendJsonl(this.file(learnerId, projectId), m);
  }

  /** 이 세션에서 한 질문들. 서버가 다시 시작되어 끊긴 질문은 오류로 보여 준다 */
  async messages(learnerId: string, projectId: string, sessionKey: string): Promise<HelpMessage[]> {
    return (await this.all(learnerId, projectId))
      .filter((m) => m.sessionKey === sessionKey)
      .map((m) => {
        if (m.status !== 'pending') return m;
        const jobId = this.jobByMessage.get(m.id);
        if (jobId && this.jobs.get(jobId)) return { ...m, jobId };
        return { ...m, status: 'error' as const, error: { kind: 'interrupted', message: '서버가 다시 시작되어 답을 받지 못했습니다. 다시 물어봐 주세요.' } };
      })
      .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  }

  async llmStatus(allowed: { ok: boolean; reason?: string }): Promise<{ available: boolean; reason?: string; provider?: string }> {
    if (!allowed.ok) return { available: false, reason: allowed.reason };
    const { provider, status } = await this.opts.resolveProvider();
    return provider ? { available: true, provider: provider.id } : { available: false, reason: status.reason };
  }

  private async snapshot(projectId: string, sessionKey: string, level: ReaderLevel): Promise<WikiSnapshot | null> {
    const base = await this.opts.wiki.current(projectId, sessionKey);
    if (!base) return null;
    const layer = await this.opts.wikiAi.layer(projectId, base.revision, level, base.generationId);
    return mergeWikiAi(base, layer, new Set(this.opts.wiki.catalog(base).concepts.keys())).snapshot;
  }

  async ask(input: {
    learnerId: string;
    projectId: string;
    session: NormalizedSession;
    built: BuiltSummary;
    hits: ConceptHit[];
    req: HelpRequest;
    /** AI 사용 권한 (관리자만 등) */
    allowed: { ok: boolean; reason?: string };
    /** 읽는 사람 수준 (답의 단어·설명 깊이) */
    level?: ReaderLevel;
  }): Promise<HelpMessage> {
    const { learnerId, projectId, session, req } = input;
    const level = input.level ?? DEFAULT_READER_LEVEL;
    return this.opts.storage.lock(`help:${learnerId}:${projectId}`, async () => {
      const existing = (await this.all(learnerId, projectId)).find((m) => m.requestId === req.requestId);
      if (existing) return existing;

      const snapshot = await this.snapshot(projectId, session.key, level);
      const catalog = this.opts.wiki.catalog(snapshot);
      for (const h of input.hits) if (!catalog.concepts.has(h.id)) catalog.concepts.set(h.id, conceptFromHit(h));
      const ctx = buildHelpContext({ focus: req.focus, snapshot, built: input.built, hits: input.hits, catalog });
      const all = await this.all(learnerId, projectId);
      const requestedThread = req.threadId ? all.find((m) => m.threadId === req.threadId && m.sessionKey === session.key) : undefined;
      if (req.threadId && !requestedThread) throw Object.assign(new Error('대화를 찾을 수 없습니다'), { status: 404, code: 'not_found' });
      const previous = [...all].reverse().find((m) => m.sessionKey === session.key && m.focus.kind === req.focus.kind && m.focus.id === req.focus.id);
      const base: HelpMessage = {
        id: `h_${randomUUID()}`,
        threadId: requestedThread?.threadId ?? previous?.threadId ?? `t_${randomUUID().replace(/-/g, '')}`,
        requestId: req.requestId,
        sessionKey: session.key,
        ...(snapshot ? { snapshotRevision: snapshot.revision } : {}),
        focus: req.focus,
        question: maskSecrets(req.question),
        ...(req.selectedText ? { selectedText: maskSecrets(req.selectedText) } : {}),
        askedAt: new Date().toISOString(),
        status: 'pending',
        notices: [],
      };

      // AI 사용 여부와 무관하게 질문을 먼저 보존한다.
      await this.append(learnerId, projectId, base);
      const conceptIdsForQuestion = req.focus.kind === 'concept' && req.focus.id && catalog.concepts.has(req.focus.id) ? [req.focus.id] : [...new Set(ctx.items.flatMap((i) => i.conceptIds))];
      await this.opts.learner.rememberConcepts(learnerId, ctx.concepts, { projectId, sessionKey: session.key });
      const activity = await this.opts.learner.record(learnerId, null, { id: `question_${base.id}`, kind: 'question', at: base.askedAt, projectId, sessionKey: session.key, conceptIds: conceptIdsForQuestion, messageId: base.id });

      const { provider, status } = input.allowed.ok ? await this.opts.resolveProvider() : { provider: null, status: { reason: input.allowed.reason } };
      if (!provider) {
        const reason = input.allowed.ok ? `AI 제공자를 쓸 수 없습니다 (${status.reason ?? '설정 확인'})` : `AI 질문을 쓸 수 없습니다 (${input.allowed.reason ?? '권한 없음'})`;
        const done: HelpMessage = { ...base, status: 'error', error: { kind: 'unavailable', message: reason }, answeredAt: new Date().toISOString() };
        await this.append(learnerId, projectId, done);
        return done;
      }

      const recalled = await this.opts.memory.search(learnerId, { projectId, allowedProjectIds: [projectId] }, { query: req.question, conceptIds: conceptIdsForQuestion, sessionKey: session.key, remote: true, excludeId: base.id });
      base.memories = recalled.records;
      base.notices.push(...recalled.notices);
      const history = all.filter((m) => m.threadId === base.threadId && m.sessionKey === session.key);
      const user = buildHelpPrompt({ ctx, session, built: input.built, hits: input.hits, question: req.question, selectedText: req.selectedText, history, profile: activity.profile, memories: recalled.records });
      const claimIds = new Set(ctx.claims.map((c) => c.id));
      const conceptIds = new Set(catalog.concepts.keys());
      const cfg = this.opts.store.get().llm;
      // 진행 중 기록을 먼저 남긴 뒤 작업을 시작한다 (완료 기록이 진행 중 기록보다 먼저 쓰이지 않게)
      await this.append(learnerId, projectId, base);
      const trace = { feature: 'help_answer' as const, projectId, sessionKey: session.key, readerLevel: level };
      const job = this.jobs.enqueue(`${session.key}:${base.id}`, (signal) => withAiRun(this.opts.storage, trace, signal, async (run) => {
        try {
          const res = await provider.complete({ system: withReader(HELP_SYSTEM_PROMPT, level), user, schema: HelpOutputSchema, schemaName: 'help_answer', maxTokens: 8000, timeoutMs: cfg.timeoutMs, signal, trace: run.trace });
          const { answer, notices } = acceptHelpOutput(res.data, claimIds, conceptIds);
          const done: HelpMessage = {
            ...base,
            jobId: job.id,
            status: 'done',
            mode: 'llm',
            answer,
            notices: [...base.notices, ...notices],
            answeredAt: new Date().toISOString(),
            provider: res.provider,
            ...(res.model ? { model: res.model } : {}),
            durationMs: res.durationMs,
            ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}),
          };
          await this.append(learnerId, projectId, done);
          run.result(this.file(learnerId, projectId), done);
          this.opts.memory.scheduleSync(learnerId, { projectId, allowedProjectIds: [projectId] });
          return done;
        } catch (err) {
          const e = err as LlmError;
          const cancelled = signal.aborted || (err instanceof LlmError && e.kind === 'cancelled');
          await this.append(learnerId, projectId, { ...base, jobId: job.id, status: cancelled ? 'cancelled' : 'error', error: { kind: e.kind ?? 'unknown', message: e.message ?? String(err) } });
          this.opts.memory.scheduleSync(learnerId, { projectId, allowedProjectIds: [projectId] });
          throw err;
        }
      }));
      this.owners.set(job.id, { learnerId, projectId });
      this.jobByMessage.set(base.id, job.id);
      return { ...base, jobId: job.id };
    });
  }

  /** 다른 사용자의 작업은 없는 것으로 다룬다 */
  job(learnerId: string, projectId: string, jobId: string): HelpJobStatus | undefined {
    const owner = this.owners.get(jobId);
    if (!owner || owner.learnerId !== learnerId || owner.projectId !== projectId) return undefined;
    return this.jobs.get(jobId);
  }

  cancel(learnerId: string, projectId: string, jobId: string): HelpJobStatus | undefined {
    return this.job(learnerId, projectId, jobId) ? this.jobs.cancel(jobId) : undefined;
  }
}
