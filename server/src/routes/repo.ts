import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { learnerIdFor } from '../learner/service';
import { RepoWikiService } from '../repo/service';
import { WikiStorage } from '../storage/store';
import { assertAccount, currentUser, notFound, parseBody, requireJson, type AppDeps, type AppEnv } from './deps';

const TextSchema = z.object({ force: z.boolean().default(false) });

/** /api/projects/:id/repo-wiki — 저장소 단위 위키 (사용자 중심 / 기능·동작 중심). 문장은 읽는 사람 수준별 */
export function repoRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const service = new RepoWikiService({ storage: new WikiStorage(deps.paths.home), store: deps.store, index: deps.index, analysis: deps.analysis, wiki: deps.wiki, enrich: deps.enrich });

  const project = async (c: Context<AppEnv>) => {
    await deps.index.ensureFresh();
    const p = deps.index.getProject(c.req.param('id') ?? '');
    if (!p) throw notFound('프로젝트');
    assertAccount(c, deps, p.accountId, '프로젝트');
    return p;
  };
  const level = (c: Context<AppEnv>) => deps.prefs.level(learnerIdFor(currentUser(c).username));
  const allowed = (c: Context<AppEnv>) => deps.auth.canEnrich(currentUser(c));

  app.get('/:id/repo-wiki', async (c) => c.json(await service.get(await project(c), await level(c), allowed(c))));
  app.get('/:id/repo-wiki/ai/preview', async (c) => c.json(await service.preview(await project(c), await level(c), allowed(c))));
  app.post('/:id/repo-wiki/build', requireJson, async (c) => {
    const res = await service.build(await project(c), await level(c), allowed(c));
    return c.json(res, res.status === 'done' ? 200 : 202);
  });
  // 지금 판의 문장을 내 수준으로 쓴다 (화면이 GET 결과의 text.canGenerate 를 보고 자동으로 부른다)
  app.post('/:id/repo-wiki/text', requireJson, async (c) => {
    const p = await project(c);
    const { force } = await parseBody(c, TextSchema);
    const res = await service.writeText(p, await level(c), allowed(c), force);
    return c.json(res, res.status === 'done' ? 200 : 202);
  });

  const jobFor = async (c: Context<AppEnv>) => {
    const p = await project(c);
    const job = service.jobs.get(c.req.param('jobId') ?? '');
    if (!job || !job.sessionKey.startsWith(`repo:${p.id}:`)) throw notFound('작업');
    return job;
  };
  app.get('/:id/repo-wiki/jobs/:jobId', async (c) => c.json(await jobFor(c)));
  app.delete('/:id/repo-wiki/jobs/:jobId', async (c) => c.json(service.jobs.cancel((await jobFor(c)).id)));
  return app;
}
