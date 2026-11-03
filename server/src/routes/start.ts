import path from 'node:path';
import { Hono } from 'hono';
import { MemberUpdateSchema, OnboardingRequestSchema, type OnboardingProfile } from '@vibe-teacher/shared';
import { learnerIdFor } from '../learner/service';
import { WikiStorage } from '../storage/store';
import { currentUser, HttpError, parseBody, requireAdmin, requireJson, type AppDeps, type AppEnv } from './deps';

export function startRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const storage = deps.storage ?? new WikiStorage(deps.paths.home);
  const file = (username: string) => path.join(storage.learnerDir(learnerIdFor(username)), 'onboarding.json');
  app.get('/onboarding', async (c) => c.json({ profile: await storage.readJson<OnboardingProfile>(file(currentUser(c).username)) }));
  app.put('/onboarding', requireJson, async (c) => {
    const body = await parseBody(c, OnboardingRequestSchema);
    const profile: OnboardingProfile = { ...body, updatedAt: new Date().toISOString() };
    await storage.lock(`onboarding:${currentUser(c).username}`, () => storage.writeJson(file(currentUser(c).username), profile));
    return c.json({ profile });
  });
  return app;
}

export function membersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireJson);
  const adminClient = (user: ReturnType<typeof currentUser>) => {
    if (!user.cloud || !deps.auth.cloud) throw new HttpError(400, 'bad_request', 'Supabase 로그인에서 사용하는 기능입니다');
    return deps.auth.cloud.client(user.cloud.accessToken);
  };
  app.get('/', async (c) => c.json(await adminClient(requireAdmin(c)).rpc('vt_list_members', {})));
  app.get('/accounts', async (c) => {
    adminClient(requireAdmin(c));
    await deps.index.ensureFresh();
    return c.json(deps.index.getAccounts());
  });
  app.put('/', async (c) => {
    const client = adminClient(requireAdmin(c));
    const req = await parseBody(c, MemberUpdateSchema);
    await client.rpc('vt_update_member', { target_user: req.userId, allow_ai: req.approved, accounts: req.accountIds });
    return c.body(null, 204);
  });
  return app;
}
