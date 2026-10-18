import { Hono, type Context } from 'hono';
import { HelpRequestSchema, type HelpThreadsResponse } from '@vibe-teacher/shared';
import { learnerIdFor } from '../learner/service';
import { assertAccount, currentUser, notFound, parseBody, requireJson, sessionSummaryFor, type AppDeps, type AppEnv } from './deps';

/**
 * /api/projects/:id/help — 도움 패널 질문. 본인 질문만 보이고, 학습자는 인증 주체에서 정한다.
 * AI 를 쓸 수 없거나 권한이 없으면 카탈로그 설명과 확인된 사실로 대체 답을 준다.
 */
export function helpRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const project = async (c: Context<AppEnv>) => {
    await deps.index.ensureFresh();
    const p = deps.index.getProject(c.req.param('id') ?? '');
    if (!p) throw notFound('프로젝트');
    assertAccount(c, deps, p.accountId, '프로젝트');
    return p;
  };
  const me = (c: Context<AppEnv>) => learnerIdFor(currentUser(c).username);

  app.get('/:id/help', async (c) => {
    const p = await project(c);
    const s = await sessionSummaryFor(c, deps, c.req.query('sessionKey') ?? '');
    if (s.projectId !== p.id) throw notFound('세션');
    const body: HelpThreadsResponse = {
      messages: await deps.help.messages(me(c), p.id, s.key),
      llm: await deps.help.llmStatus(deps.auth.canEnrich(currentUser(c))),
    };
    return c.json(body);
  });

  app.post('/:id/help', requireJson, async (c) => {
    const p = await project(c);
    const req = await parseBody(c, HelpRequestSchema);
    const s = await sessionSummaryFor(c, deps, req.sessionKey);
    if (s.projectId !== p.id) throw notFound('세션');
    const session = await deps.index.loadSession(s.key);
    if (!session) throw notFound('세션');
    const { built, concepts } = await deps.analysis.analyze(session);
    const message = await deps.help.ask({ learnerId: me(c), projectId: p.id, session, built, hits: concepts, req, allowed: deps.auth.canEnrich(currentUser(c)) });
    return c.json({ message }, message.status === 'pending' ? 202 : 200);
  });

  app.get('/:id/help/jobs/:jobId', async (c) => {
    const p = await project(c);
    const job = deps.help.job(me(c), p.id, c.req.param('jobId'));
    if (!job) throw notFound('작업');
    return c.json(job);
  });

  app.delete('/:id/help/jobs/:jobId', async (c) => {
    const p = await project(c);
    const job = deps.help.cancel(me(c), p.id, c.req.param('jobId'));
    if (!job) throw notFound('작업');
    return c.json(job);
  });

  return app;
}
