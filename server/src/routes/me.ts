import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { AssessmentRequestSchema, AssessmentResponseRequestSchema, FeedbackRequestSchema, type WikiSnapshot } from '@vibe-teacher/shared';
import { z } from 'zod';
import { ReaderPrefsRequestSchema, type KnowledgeTextStartResponse, type KnowledgeWikiResponse, type TextGenerator } from '@vibe-teacher/shared';
import { textGate } from '../llm/gate';
import { KnowledgeService } from '../learner/knowledge-service';
import { KnowledgeTextService } from '../learner/knowledge-text';
import { learnerIdFor, type EventDraft } from '../learner/service';
import { WikiStorage } from '../storage/store';
import { assertAccount, currentUser, HttpError, notFound, parseBody, requireJson, sessionSummaryFor, type AppDeps, type AppEnv } from './deps';

const ScopeSchema = z.object({ projectId: z.string().max(200).optional(), sessionKey: z.string().max(2000).optional(), force: z.boolean().default(false) });
const MemorySearchSchema = z.object({ query: z.string().trim().max(2000).default(''), projectId: z.string().max(200).optional(), conceptId: z.string().max(64).optional() });

/**
 * /api/me — 로그인한 사용자 본인의 지식 위키와 이해 정보 (프로젝트를 가리지 않음).
 * 세션을 함께 주면 그 세션의 접근 권한을 검사하고, 이벤트에 어느 프로젝트·세션에서 생겼는지 남긴다.
 */
export function meRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const knowledge = new KnowledgeService({ index: deps.index, analysis: deps.analysis, wiki: deps.wiki, learner: deps.learner, enrich: deps.enrich });
  const texts = new KnowledgeTextService({ storage: deps.storage ?? new WikiStorage(deps.paths.home), store: deps.store });
  const me = (c: Context<AppEnv>) => learnerIdFor(currentUser(c).username);
  const accountScope = (c: Context<AppEnv>) => currentUser(c).cloud ? { accountIds: new Set(deps.index.getAccounts().filter((a) => deps.auth.canAccessAccount(currentUser(c), a.id)).map((a) => a.id)) } : {};
  const gate = (c: Context<AppEnv>) => textGate({ store: deps.store, resolveProvider: () => deps.enrich.resolveProvider(), allowed: deps.auth.canEnrich(currentUser(c)) });

  /** 범위(전체·프로젝트·세션)를 검사하고 지식 위키 항목을 모은 뒤, 저장된 AI 문장을 입힌다 */
  const knowledgeFor = async (c: Context<AppEnv>, scope: { projectId?: string; sessionKey?: string }) => {
    await deps.index.ensureFresh();
    let { projectId } = scope;
    const { sessionKey } = scope;
    if (projectId) {
      const p = deps.index.getProject(projectId);
      if (!p) throw notFound('프로젝트');
      assertAccount(c, deps, p.accountId, '프로젝트');
      projectId = p.id;
    }
    const session = sessionKey ? await sessionSummaryFor(c, deps, sessionKey) : undefined;
    const base = await knowledge.wiki({ username: currentUser(c).username, learnerId: me(c), ...accountScope(c), ...(projectId ? { projectId } : {}), ...(session ? { session } : {}) });
    const level = await deps.prefs.level(me(c));
    const applied = await texts.apply(me(c), base.entries, level);
    return { base, level, ...applied };
  };

  const sessionContext = async (c: Context<AppEnv>, sessionKey?: string): Promise<{ projectId?: string; snapshot: WikiSnapshot | null }> => {
    if (!sessionKey) return { snapshot: null };
    const s = await sessionSummaryFor(c, deps, sessionKey);
    return { projectId: s.projectId, snapshot: await deps.wiki.current(s.projectId, s.key) };
  };

  app.get('/knowledge', async (c) => {
    const projectId = c.req.query('projectId') || undefined;
    const sessionKey = c.req.query('sessionKey') || undefined;
    const { base, entries, missing, generator: used } = await knowledgeFor(c, { ...(projectId ? { projectId } : {}), ...(sessionKey ? { sessionKey } : {}) });
    const g = await gate(c);
    // AI를 쓸 수 없으면 생성하지 않은 상태와 사유를 함께 보낸다
    let generator: TextGenerator;
    if (g.ok) generator = { kind: 'llm', provider: used?.provider ?? g.provider.id, ...(used?.model ? { model: used.model } : {}) };
    else if (used && !missing.length) generator = { kind: 'llm', ...used };
    else generator = { kind: 'unavailable', reason: g.reason };
    const res: KnowledgeWikiResponse = { ...base, entries, text: { generator, missing: missing.length, canGenerate: g.ok && deps.store.get().llm.autoText && missing.length > 0 } };
    return c.json(res);
  });

  // 빠진 설명 문장을 AI 로 쓰는 작업을 시작한다 (화면이 GET 결과의 canGenerate 를 보고 자동으로 부른다)
  app.post('/knowledge/text', requireJson, async (c) => {
    const scope = await parseBody(c, ScopeSchema);
    const g = await gate(c);
    if (!g.ok) return c.json({ status: 'done' } satisfies KnowledgeTextStartResponse);
    const { missing, entries, level } = await knowledgeFor(c, scope);
    const targets = scope.force ? [...missing, ...entries.filter((e) => e.reasonOrigin === 'error')] : missing;
    if (!targets.length) return c.json({ status: 'done' } satisfies KnowledgeTextStartResponse);
    const job = texts.start(me(c), g.provider, targets, level);
    return c.json({ status: job.state === 'running' ? 'running' : 'queued', jobId: job.id } satisfies KnowledgeTextStartResponse, 202);
  });
  const textJob = (c: Context<AppEnv>) => {
    const job = texts.jobs.get(c.req.param('jobId') ?? '');
    if (!job || job.sessionKey !== KnowledgeTextService.jobKey(me(c))) throw notFound('작업');
    return job;
  };
  app.get('/knowledge/text/jobs/:jobId', (c) => c.json(textJob(c)));
  app.delete('/knowledge/text/jobs/:jobId', (c) => c.json(texts.jobs.cancel(textJob(c).id)));

  app.get('/profile', async (c) => c.json({ profile: await deps.learner.profile(me(c)) }));

  const memoryScope = async (c: Context<AppEnv>, projectId?: string) => {
    await deps.index.ensureFresh();
    let canonical: string | undefined;
    if (projectId) {
      const p = deps.index.getProject(projectId);
      if (!p) throw notFound('프로젝트');
      assertAccount(c, deps, p.accountId, '프로젝트');
      canonical = p.id;
    }
    const allowedProjectIds = deps.index.getProjects().filter((p) => deps.auth.canAccessAccount(currentUser(c), p.accountId)).map((p) => p.id);
    return { ...(canonical ? { projectId: canonical } : {}), allowedProjectIds };
  };
  // GET은 로컬 원장만 읽는다. 외부 검색·색인 갱신은 명시적 POST로 분리한다.
  app.get('/memory', async (c) => {
    const result = await deps.memory.search(me(c), await memoryScope(c, c.req.query('projectId')), { query: c.req.query('q') ?? '', limit: 12 });
    return c.json({ ...result, canSync: result.canSync && deps.auth.canEnrich(currentUser(c)).ok });
  });
  app.post('/memory/search', requireJson, async (c) => {
    const req = await parseBody(c, MemorySearchSchema);
    const scope = await memoryScope(c, req.projectId);
    const allowed = deps.auth.canEnrich(currentUser(c)).ok;
    const result = await deps.memory.search(me(c), scope, { query: req.query, ...(req.conceptId ? { conceptIds: [req.conceptId] } : {}), limit: 12, remote: allowed });
    return c.json({ ...result, canSync: result.canSync && allowed });
  });
  app.post('/memory/sync', requireJson, async (c) => {
    const req = await parseBody(c, MemorySearchSchema);
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw new HttpError(403, 'forbidden', allowed.reason ?? '외부 기억 인덱스를 갱신할 권한이 없습니다');
    return c.json(await deps.memory.sync(me(c), await memoryScope(c, req.projectId)));
  });

  // 읽는 사람 수준 — AI 문장의 단어와 설명 깊이. 이해 증거가 아니라 설정이다
  app.get('/prefs', async (c) => c.json(await deps.prefs.get(me(c))));
  app.put('/prefs', requireJson, async (c) => {
    const { readerLevel } = await parseBody(c, ReaderPrefsRequestSchema);
    return c.json(await deps.prefs.set(me(c), readerLevel));
  });

  app.post('/feedback', requireJson, async (c) => {
    const req = await parseBody(c, FeedbackRequestSchema);
    const { projectId, snapshot } = await sessionContext(c, req.sessionKey);
    if (snapshot) await deps.learner.rememberConcepts(me(c), snapshot.concepts ?? [], projectId && req.sessionKey ? { projectId, sessionKey: req.sessionKey } : undefined);
    else if ('conceptId' in req.event && req.event.conceptId) {
      const base = await knowledge.wiki({ username: currentUser(c).username, learnerId: me(c), ...accountScope(c) });
      const concept = base.concepts?.[req.event.conceptId];
      if (concept) {
        const sources = base.entries.find((e) => e.conceptId === concept.id)?.sources ?? [];
        await deps.learner.rememberConcepts(me(c), [concept]);
        for (const source of sources) await deps.learner.rememberConcepts(me(c), [concept], { projectId: source.projectId, sessionKey: source.sessionKey });
      }
    }
    const draft = {
      ...req.event,
      id: req.requestId ? `fb_${req.requestId}` : `fb_${randomUUID()}`,
      at: new Date().toISOString(),
      ...(projectId ? { projectId } : {}),
      ...(req.sessionKey ? { sessionKey: req.sessionKey } : {}),
    } as EventDraft;
    const { profile, event } = await deps.learner.record(me(c), req.baseRevision, draft);
    if (deps.auth.canEnrich(currentUser(c)).ok) deps.memory.scheduleSync(me(c), await memoryScope(c, projectId));
    return c.json({ profile, event });
  });

  app.post('/assessments', requireJson, async (c) => {
    const req = await parseBody(c, AssessmentRequestSchema);
    const { projectId, snapshot } = await sessionContext(c, req.sessionKey);
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw Object.assign(new Error(allowed.reason ?? 'AI 사용 권한이 없습니다'), { status: 403, code: 'forbidden' });
    const { base, level } = await knowledgeFor(c, req.sessionKey ? { sessionKey: req.sessionKey } : {});
    await deps.learner.rememberConcepts(me(c), Object.values(base.concepts ?? {}), projectId && req.sessionKey ? { projectId, sessionKey: req.sessionKey } : undefined);
    return c.json(await deps.assessments.start(me(c), projectId, req, snapshot, new Map(Object.entries(base.concepts ?? {})), level));
  });

  app.post('/assessments/:assessmentId/responses', requireJson, async (c) => {
    const body = await parseBody(c, AssessmentResponseRequestSchema);
    const result = await deps.assessments.respond(me(c), undefined, c.req.param('assessmentId'), body);
    if (deps.auth.canEnrich(currentUser(c)).ok) deps.memory.scheduleSync(me(c), await memoryScope(c));
    return c.json(result);
  });

  return app;
}
