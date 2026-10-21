import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import {
  AssessmentRequestSchema,
  AssessmentResponseRequestSchema,
  FeedbackRequestSchema,
  type LearnerEvent,
  type UnderstandingResponse,
} from '@vibe-teacher/shared';
import type { EventDraft } from '../learner/service';
import { learnerIdFor } from '../learner/service';
import { assertAccount, currentUser, notFound, parseBody, requireJson, sessionSummaryFor, type AppDeps, type AppEnv } from './deps';

/**
 * /api/projects/:id/understanding · /assessments — 본인의 개인 평면만 다룬다.
 * 학습자는 인증 주체에서 정하며 요청 본문의 사용자 ID 로 바꿀 수 없다.
 * 관리자의 원본 기록 열람 권한이 다른 사람의 퀴즈·이해 정보 열람으로 넓어지지 않는다.
 */
export function learnerRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const project = async (c: Context<AppEnv>) => {
    await deps.index.ensureFresh();
    const p = deps.index.getProject(c.req.param('id') ?? '');
    if (!p) throw notFound('프로젝트');
    assertAccount(c, deps, p.accountId, '프로젝트');
    return p;
  };
  const me = (c: Context<AppEnv>) => learnerIdFor(currentUser(c).username);

  app.get('/:id/understanding', async (c) => {
    const p = await project(c);
    const learnerId = me(c);
    const [profile, events] = await Promise.all([deps.learner.profile(learnerId), deps.learner.events(learnerId)]);
    const catalog = deps.wiki.catalog();
    const conceptNames: Record<string, string> = {};
    for (const id of Object.keys(profile.concepts)) conceptNames[id] = catalog.concepts.get(id)?.name ?? id;
    const body: UnderstandingResponse = { profile, events: events.slice(-50).reverse(), conceptNames };
    return c.json(body);
  });

  app.post('/:id/understanding/feedback', requireJson, async (c) => {
    const p = await project(c);
    const req = await parseBody(c, FeedbackRequestSchema);
    if (req.sessionKey) {
      const s = await sessionSummaryFor(c, deps, req.sessionKey);
      if (s.projectId !== p.id) throw notFound('세션');
    }
    const draft = {
      ...req.event,
      id: req.requestId ? `fb_${req.requestId}` : `fb_${randomUUID()}`,
      at: new Date().toISOString(),
      projectId: p.id,
      ...(req.sessionKey ? { sessionKey: req.sessionKey } : {}),
    } as EventDraft;
    const { profile, event } = await deps.learner.record(me(c), req.baseRevision, draft);
    return c.json({ profile, event: event as LearnerEvent });
  });

  app.post('/:id/assessments', requireJson, async (c) => {
    const p = await project(c);
    const req = await parseBody(c, AssessmentRequestSchema);
    let snapshot = null;
    if (req.sessionKey) {
      const s = await sessionSummaryFor(c, deps, req.sessionKey);
      if (s.projectId !== p.id) throw notFound('세션');
      snapshot = await deps.wiki.current(p.id, s.key);
    }
    return c.json(await deps.assessments.start(me(c), p.id, req, snapshot));
  });

  app.post('/:id/assessments/:assessmentId/responses', requireJson, async (c) => {
    const p = await project(c);
    const body = await parseBody(c, AssessmentResponseRequestSchema);
    return c.json(await deps.assessments.respond(me(c), p.id, c.req.param('assessmentId'), body));
  });

  return app;
}
