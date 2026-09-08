import { Hono, type Context } from 'hono';
import { mergeBuilt } from '../analyzers/built/index';
import { assertAccount, currentUser, notFound, type AppDeps, type AppEnv } from './deps';

export function projectsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    await deps.index.ensureFresh();
    const user = currentUser(c);
    const account = c.req.query('account') || undefined;
    if (account && !deps.auth.canAccessAccount(user, account)) return c.json([]);
    const allowed = deps.auth.allowedAccountIds(user);
    return c.json(deps.index.getProjects(account).filter((p) => allowed === 'all' || allowed.has(p.accountId)));
  });

  const getProject = async (c: Context<AppEnv>) => {
    await deps.index.ensureFresh();
    const p = deps.index.getProject(c.req.param('id') ?? '');
    if (!p) throw notFound('프로젝트');
    assertAccount(c, deps, p.accountId, '프로젝트');
    return p;
  };

  app.get('/:id', async (c) => c.json(await getProject(c)));

  app.get('/:id/sessions', async (c) => {
    const p = await getProject(c);
    return c.json(deps.index.getSessions(p.id));
  });

  app.get('/:id/built', async (c) => {
    const p = await getProject(c);
    const parts = [];
    for (const s of deps.index.getSessions(p.id)) {
      const session = await deps.index.loadSession(s.key);
      if (!session) continue;
      parts.push((await deps.analysis.analyze(session)).built);
    }
    return c.json(mergeBuilt(parts));
  });

  return app;
}
