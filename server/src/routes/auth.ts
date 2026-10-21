import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthMeResponse, LoginRequest, LoginResponse } from '@vibe-teacher/shared';
import { tokenSetupCommand } from '../auth/token-file';
import { learnerIdFor } from '../learner/service';
import { HttpError, type AppDeps, type AppEnv } from './deps';

const LoginSchema = z.object({ username: z.string().min(1).max(64), token: z.string().min(1).max(512) });

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/me', async (c) => {
    const user = await deps.auth.authenticate(c);
    const mode = deps.auth.mode();
    const body: AuthMeResponse = {
      mode,
      authenticated: !!user,
      username: user?.username,
      isAdmin: user?.isAdmin,
      via: user?.via,
      canEnrich: user ? deps.auth.canEnrich(user).ok : false,
      enrichReason: user ? deps.auth.canEnrich(user).reason : undefined,
      tokenRequired: deps.auth.tokenRequired(),
      serviceUser: deps.auth.serviceUser,
      llmStatus: user ? await deps.enrich.status() : null,
      autoText: deps.store.get().llm.autoText,
      reader: user ? await deps.prefs.get(learnerIdFor(user.username)) : null,
    };
    return c.json(body);
  });

  app.get('/setup-command', (c) => c.json({ command: tokenSetupCommand(deps.auth.serviceUser), serviceUser: deps.auth.serviceUser }));

  app.post('/login', async (c) => {
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

  app.post('/logout', (c) => {
    deps.auth.logout(c);
    return c.body(null, 204);
  });

  return app;
}
