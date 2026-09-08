import { Hono, type Context } from 'hono';
import { assertAccount, notFound, type AppDeps, type AppEnv } from './deps';

export function jobsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const guard = (c: Context<AppEnv>, sessionKey: string) => {
    const summary = deps.index.getSummary(sessionKey);
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
