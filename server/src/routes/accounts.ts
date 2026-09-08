import { Hono } from 'hono';
import type { AccountSummaryProject, AccountSummaryResponse } from '@vibe-teacher/shared';
import { assertAccount, currentUser, notFound, type AppDeps, type AppEnv } from './deps';

export function accountsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    await deps.index.ensureFresh();
    return c.json(deps.auth.filterAccounts(currentUser(c), deps.index.getAccounts()));
  });

  app.get('/:id', async (c) => {
    await deps.index.ensureFresh();
    const a = deps.index.getAccount(c.req.param('id'));
    if (!a) throw notFound('계정');
    assertAccount(c, deps, a.id);
    return c.json(a);
  });

  app.get('/:id/projects', async (c) => {
    await deps.index.ensureFresh();
    const a = deps.index.getAccount(c.req.param('id'));
    if (!a) throw notFound('계정');
    assertAccount(c, deps, a.id);
    return c.json(deps.index.getProjects(a.id));
  });

  app.get('/:id/summary', async (c) => {
    await deps.index.ensureFresh();
    const account = deps.index.getAccount(c.req.param('id'));
    if (!account) throw notFound('계정');
    assertAccount(c, deps, account.id);
    const projects = deps.index.getProjects(account.id);
    const conceptCounts = new Map<string, { id: string; name: string; count: number }>();
    const rows: AccountSummaryProject[] = [];
    const totals = { sessions: 0, humanMessages: 0, filesCreated: 0, filesModified: 0, packages: 0, commits: 0 };
    for (const project of projects) {
      const row: AccountSummaryProject = { project, sessions: 0, humanMessages: 0, filesCreated: 0, filesModified: 0, packages: 0, commits: 0, topConcepts: [] };
      const local = new Map<string, { id: string; name: string; count: number }>();
      for (const summary of deps.index.getSessions(project.id)) {
        row.sessions += 1;
        row.humanMessages += summary.counts.human;
        const session = await deps.index.loadSession(summary.key);
        if (!session) continue;
        const { built, concepts } = await deps.analysis.analyze(session);
        row.filesCreated += built.filesCreated.length;
        row.filesModified += built.filesModified.length;
        row.packages += built.packagesInstalled.length;
        row.commits += built.gitCommits.length;
        for (const ch of concepts) {
          const bump = (m: Map<string, { id: string; name: string; count: number }>) => {
            const cur = m.get(ch.id) ?? { id: ch.id, name: ch.name, count: 0 };
            cur.count += 1;
            m.set(ch.id, cur);
          };
          bump(local);
          bump(conceptCounts);
        }
      }
      row.topConcepts = Array.from(local.values()).sort((a, b) => b.count - a.count).slice(0, 5);
      totals.sessions += row.sessions;
      totals.humanMessages += row.humanMessages;
      totals.filesCreated += row.filesCreated;
      totals.filesModified += row.filesModified;
      totals.packages += row.packages;
      totals.commits += row.commits;
      rows.push(row);
    }
    const body: AccountSummaryResponse = {
      account,
      projects: rows,
      totals,
      topConcepts: Array.from(conceptCounts.values()).sort((a, b) => b.count - a.count).slice(0, 8),
    };
    return c.json(body);
  });

  return app;
}
