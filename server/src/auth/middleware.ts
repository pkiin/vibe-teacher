import type { MiddlewareHandler } from 'hono';
import type { AuthService } from './service';

/** /api/* 보호. /api/auth/* 는 통과. 인증 실패 시 401 JSON. */
export function authGuard(auth: AuthService): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    const user = await auth.authenticate(c);
    if (!user) {
      const mode = auth.mode();
      return c.json(
        {
          error: { code: 'unauthorized', message: mode === 'home-token' ? '로그인이 필요합니다' : '접근 토큰이 필요합니다' },
          authMode: mode,
        },
        401,
      );
    }
    c.set('user', user);
    return next();
  };
}
