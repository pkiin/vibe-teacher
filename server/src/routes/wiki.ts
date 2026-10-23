import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { LearnerEvent, LearnerProfile, SessionSummary, WikiSnapshot } from '@vibe-teacher/shared';
import { learnerIdFor } from '../learner/service';
import { HttpError, currentUser, notFound, parseBody, requireJson, sessionSummaryFor, type AppDeps, type AppEnv } from './deps';

const AiStartSchema = z.object({ force: z.boolean().default(false) });

/** 해설을 이미 본(정답 제출 또는 모르겠어요) 문항 — 다시 제안하지 않는다 */
export function answeredQuestionIds(events: LearnerEvent[]): Set<string> {
  return new Set(events.flatMap((e) => (e.kind === 'response' && (e.status === 'answered' || e.status === 'dont_know') ? [e.questionId] : [])));
}

/** /api/sessions/:key/wiki — 세션 하나의 프로젝트 위키 (P0 수직 구현) */
export function wikiRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** 개인 상태를 못 읽어도 위키는 보여 준다 (개인화 없이, 공통 알림은 유지) */
  const personal = async (c: Context<AppEnv>, summary: SessionSummary): Promise<{ profile: LearnerProfile | null; answered: Set<string> }> => {
    try {
      const learnerId = learnerIdFor(currentUser(c).username);
      const events = await deps.learner.events(learnerId);
      return { profile: await deps.learner.profile(learnerId), answered: answeredQuestionIds(events) };
    } catch (err) {
      console.warn(`[wiki] 개인 상태를 읽지 못해 개인화 없이 보여 줍니다: ${(err as Error).message}`);
      return { profile: null, answered: new Set() };
    }
  };

  const level = (c: Context<AppEnv>) => deps.prefs.level(learnerIdFor(currentUser(c).username));

  app.get('/:key/wiki', async (c) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key'));
    const snapshot = await deps.wiki.current(summary.projectId, summary.key);
    if (!snapshot) throw new HttpError(404, 'wiki_not_built', '아직 이 세션의 위키를 만들지 않았습니다');
    const { profile, answered } = await personal(c, summary);
    const ai = await deps.wikiAi.layer(summary.projectId, snapshot.revision, await level(c), snapshot.generationId);
    return c.json(deps.wiki.view(snapshot, profile, answered, deps.wiki.isStale(snapshot, summary), ai));
  });

  app.post('/:key/wiki/build', requireJson, async (c) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key'));
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw new HttpError(403, 'forbidden', allowed.reason ?? 'AI 사용 권한이 없습니다');
    const status = await deps.enrich.status();
    if (!status.available) throw new HttpError(409, 'llm_unavailable', status.reason ?? 'AI 제공자를 설정해 주세요');
    const session = await deps.index.loadSession(summary.key);
    if (!session) throw notFound('세션');
    const analysis = await deps.analysis.analyze(session);
    const snapshot = await deps.wiki.build(session, analysis);
    const started = await deps.wikiAi.start(session, analysis, snapshot, true, await level(c));
    const { profile, answered } = await personal(c, summary);
    const ai = await deps.wikiAi.layer(summary.projectId, snapshot.revision, await level(c), snapshot.generationId);
    return c.json({ ...deps.wiki.view(snapshot, profile, answered, false, ai), ...(started.status !== 'done' ? { generation: { jobId: started.jobId, status: started.status } } : {}) });
  });

  /** AI 보강은 현재 기록으로 만든 위키에만 붙인다 */
  const currentSnapshot = async (summary: SessionSummary): Promise<WikiSnapshot> => {
    const snapshot = await deps.wiki.current(summary.projectId, summary.key);
    if (!snapshot) throw new HttpError(404, 'wiki_not_built', '먼저 위키를 만들어 주세요');
    if (deps.wiki.isStale(snapshot, summary)) throw new HttpError(409, 'wiki_stale', '세션 기록이나 설명 기준이 바뀌었습니다. 위키를 다시 만든 뒤 AI 설명을 작성해 주세요');
    return snapshot;
  };

  app.get('/:key/wiki/ai/preview', async (c) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key'));
    const snapshot = await currentSnapshot(summary);
    const session = await deps.index.loadSession(summary.key);
    if (!session) throw notFound('세션');
    return c.json(await deps.wikiAi.preview(session, await deps.analysis.analyze(session), snapshot, await level(c)));
  });

  app.post('/:key/wiki/ai', requireJson, async (c) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key'));
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw new HttpError(403, 'forbidden', allowed.reason ?? 'AI 사용 권한이 없습니다');
    const { force } = await parseBody(c, AiStartSchema);
    const snapshot = await currentSnapshot(summary);
    const session = await deps.index.loadSession(summary.key);
    if (!session) throw notFound('세션');
    const res = await deps.wikiAi.start(session, await deps.analysis.analyze(session), snapshot, force, await level(c));
    return c.json(res, res.status === 'done' ? 200 : 202);
  });

  const jobFor = async (c: Context<AppEnv>) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key') ?? '');
    const job = deps.wikiAi.jobs.get(c.req.param('id') ?? '');
    if (!job || job.sessionKey.split('|')[0] !== summary.key) throw notFound('작업');
    return job;
  };
  app.get('/:key/wiki/ai/jobs/:id', async (c) => c.json(await jobFor(c)));
  app.delete('/:key/wiki/ai/jobs/:id', async (c) => {
    const job = await jobFor(c);
    return c.json(deps.wikiAi.jobs.cancel(job.id));
  });

  app.get('/:key/wiki/history', async (c) => {
    const summary = await sessionSummaryFor(c, deps, c.req.param('key'));
    return c.json(await deps.wiki.history(summary.projectId, summary.key));
  });

  return app;
}
