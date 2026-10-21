import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { HealthResponse } from '@vibe-teacher/shared';
import { authGuard } from './auth/middleware';
import { currentUser as osUser } from './config/env';
import { accountsRoutes } from './routes/accounts';
import { authRoutes } from './routes/auth';
import { HttpError, type AppDeps, type AppEnv } from './routes/deps';
import { jobsRoutes } from './routes/jobs';
import { helpRoutes } from './routes/help';
import { learnerRoutes } from './routes/learner';
import { meRoutes } from './routes/me';
import { repoRoutes } from './routes/repo';
import { projectsRoutes } from './routes/projects';
import { sessionsRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';
import { rescanRoute, sourcesRoutes } from './routes/sources';
import { staticRoutes } from './routes/static';
import { wikiRoutes } from './routes/wiki';

export interface CreateAppOptions {
  deps: AppDeps;
  distDir?: string;
  quiet?: boolean;
}

export function createApp({ deps, distDir, quiet = false }: CreateAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  if (!quiet) app.use('*', logger());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    const duck = err as { status?: number; code?: string };
    if (typeof duck.status === 'number' && typeof duck.code === 'string' && duck.status >= 400 && duck.status < 600) {
      return c.json({ error: { code: duck.code, message: err.message } }, duck.status as 400);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: err.message || '서버 오류' } }, 500);
  });

  const api = new Hono<AppEnv>();
  api.route('/auth', authRoutes(deps));
  api.use('*', authGuard(deps.auth));
  api.get('/health', (c) => {
    const body: HealthResponse = { ok: true, version: deps.version, home: deps.paths.home, runningAs: osUser(), scanMode: deps.store.get().scan.mode };
    return c.json(body);
  });
  api.route('/accounts', accountsRoutes(deps));
  api.route('/sources', sourcesRoutes(deps));
  api.route('/rescan', rescanRoute(deps));
  api.route('/projects', projectsRoutes(deps));
  api.route('/projects', learnerRoutes(deps));
  api.route('/projects', helpRoutes(deps));
  api.route('/me', meRoutes(deps));
  api.route('/projects', repoRoutes(deps));
  api.route('/sessions', sessionsRoutes(deps));
  api.route('/sessions', wikiRoutes(deps));
  api.route('/settings', settingsRoutes(deps));
  api.route('/jobs', jobsRoutes(deps));
  // 개념 카탈로그 (일반 배경 지식 — 도움 패널의 설명에 쓴다)
  api.get('/catalog/concepts', (c) => c.json([...deps.wiki.catalog().concepts.values()]));
  app.route('/api', api);
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: { code: 'not_found', message: '없는 API 경로입니다' } }, 404) : c.text('Not Found', 404)));

  if (distDir) {
    const s = staticRoutes(distDir);
    if (s) app.route('/', s);
  }
  return app;
}
