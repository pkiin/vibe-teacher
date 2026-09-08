import type { Context } from 'hono';
import type { Paths, ConfigStore } from '../config/store';
import type { SessionIndex } from '../index/session-index';
import type { AnalysisService } from '../analyzers/index';
import type { EnrichService } from '../llm/service';
import type { AuthService, AuthUser } from '../auth/service';

export interface AppDeps {
  store: ConfigStore;
  index: SessionIndex;
  paths: Paths;
  analysis: AnalysisService;
  enrich: EnrichService;
  auth: AuthService;
  version: string;
}

export type AppEnv = { Variables: { user: AuthUser } };

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, 'not_found', `${what}을(를) 찾을 수 없습니다`);
}

export function currentUser(c: Context<AppEnv>): AuthUser {
  return c.get('user');
}

export function requireAdmin(c: Context<AppEnv>): AuthUser {
  const user = currentUser(c);
  if (!user.isAdmin) throw new HttpError(403, 'forbidden', '관리자만 할 수 있습니다');
  return user;
}

/** 계정 범위 밖이면 존재 여부를 숨기기 위해 404 로 처리 */
export function assertAccount(c: Context<AppEnv>, deps: AppDeps, accountId: string, what = '계정'): void {
  if (!deps.auth.canAccessAccount(currentUser(c), accountId)) throw notFound(what);
}
