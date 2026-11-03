import { Hono } from 'hono';
import { z } from 'zod';
import { EmailLoginSchema, SignupSchema, type AuthMeResponse, type LoginRequest, type LoginResponse } from '@vibe-teacher/shared';
import { tokenSetupCommand } from '../auth/token-file';
import { learnerIdFor } from '../learner/service';
import { HttpError, parseBody, requireJson, type AppDeps, type AppEnv } from './deps';
import type { CloudRuntime } from '../cloud/runtime';

const LoginSchema = z.object({ username: z.string().min(1).max(64), token: z.string().min(1).max(512) });

export function authRoutes(deps: AppDeps, runtime?: CloudRuntime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/me', async (c) => {
    c.header('Cache-Control', 'no-store');
    const user = await deps.auth.authenticate(c);
    const personal = user ? runtime?.forUser(user) ?? deps : deps;
    const mode = deps.auth.mode();
    const body: AuthMeResponse = {
      mode,
      authenticated: !!user,
      username: user?.username,
      isAdmin: user?.isAdmin,
      canManageInstallation: !!user && (user.isAdmin || !!user.cloud?.localOwner),
      via: user?.via,
      canEnrich: user ? deps.auth.canEnrich(user).ok : false,
      enrichReason: user ? deps.auth.canEnrich(user).reason : undefined,
      tokenRequired: deps.auth.tokenRequired(),
      serviceUser: deps.auth.serviceUser,
      llmStatus: user ? await personal.enrich.status() : null,
      autoText: deps.store.get().llm.autoText,
      reader: user ? await personal.prefs.get(learnerIdFor(user.username)) : null,
      ...(user?.cloud ? { email: user.cloud.email, approved: user.cloud.approved, localOwner: user.cloud.localOwner } : {}),
      ...(deps.auth.cloud ? { deployment: deps.auth.cloud.config.deployment } : {}),
    };
    return c.json(body);
  });

  app.get('/setup-command', (c) => {
    if (deps.auth.mode() !== 'home-token') throw new HttpError(404, 'not_found', '없는 API 경로입니다');
    return c.json({ command: tokenSetupCommand(deps.auth.serviceUser), serviceUser: deps.auth.serviceUser });
  });

  app.post('/login', requireJson, async (c) => {
    if (deps.auth.cloud) {
      const { email, password } = await parseBody(c, EmailLoginSchema);
      await deps.auth.cloud.login(c, email, password);
      return c.body(null, 204);
    }
    if (deps.auth.mode() !== 'home-token') throw new HttpError(400, 'bad_request', '로그인 모드가 꺼져 있습니다');
    const parsed = LoginSchema.safeParse(await c.req.json<LoginRequest>().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, 'bad_request', '사용자 이름과 토큰을 입력하세요');
    const res = await deps.auth.login(c, parsed.data.username, parsed.data.token);
    if (!res.ok) {
      console.log(`[auth] login failed user=${parsed.data.username} (${res.reason})`);
      return c.json({ error: { code: res.status === 429 ? 'locked' : 'unauthorized', message: res.reason } }, res.status);
    }
    console.log(`[auth] login ok user=${res.user.username} admin=${res.user.isAdmin}`);
    const body: LoginResponse = { username: res.user.username, isAdmin: res.user.isAdmin };
    return c.json(body);
  });

  app.post('/signup', requireJson, async (c) => {
    if (!deps.auth.cloud) throw new HttpError(400, 'bad_request', 'Supabase 로그인을 먼저 설정하세요');
    const { email, password } = await parseBody(c, SignupSchema);
    return c.json(await deps.auth.cloud.signup(c, email, password), 201);
  });

  app.post('/logout', async (c) => {
    // 본문 없는 로그아웃도 다른 사이트의 폼 제출은 받지 않는다.
    if (c.req.header('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'forbidden', '같은 사이트에서 로그아웃하세요');
    if (deps.auth.cloud) await deps.auth.cloud.logout(c);
    else deps.auth.logout(c);
    return c.body(null, 204);
  });

  return app;
}
