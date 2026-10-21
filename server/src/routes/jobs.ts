import { Hono, type Context } from 'hono';
import { assertAccount, notFound, type AppDeps, type AppEnv } from './deps';

export function jobsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // 작업 키는 "<세션 키>|<읽는 사람 수준>" (세션 키에는 | 가 없다)
  const guard = (c: Context<AppEnv>, jobKey: string) => {
    const summary = deps.index.getSummary(jobKey.split('|')[0] ?? '');
    if (!summary) throw notFound('작업');
    assertAccount(c, deps, summary.accountId, '작업');
  };
  app.get('/:id', (c) => {
    const job = deps.enrich.jobs.get(c.req.param('id'));
    if (!job) throw notFound('작업');
    guard(c, job.sessionKey);
    return c.json(job);
  });
  app.delete('/:id', (c) => {
    const job = deps.enrich.jobs.get(c.req.param('id'));
    if (!job) throw notFound('작업');
    guard(c, job.sessionKey);
    return c.json(deps.enrich.jobs.cancel(job.id));
  });
  return app;
}
