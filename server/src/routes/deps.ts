import type { Context, MiddlewareHandler } from 'hono';
import type { SessionSummary } from '@vibe-teacher/shared';
import type { z } from 'zod';
import type { Paths, ConfigStore } from '../config/store';
import type { SessionIndex } from '../index/session-index';
import type { AnalysisService } from '../analyzers/index';
import type { EnrichService } from '../llm/service';
import type { AuthService, AuthUser } from '../auth/service';
import type { AssessmentService } from '../assessment/service';
import type { LearnerService } from '../learner/service';
import type { HelpService } from '../help/service';
import type { WikiAiService } from '../wiki/ai-service';
import type { WikiService } from '../wiki/service';

export interface AppDeps {
  store: ConfigStore;
  index: SessionIndex;
  paths: Paths;
  analysis: AnalysisService;
  enrich: EnrichService;
  auth: AuthService;
  wiki: WikiService;
  learner: LearnerService;
  assessments: AssessmentService;
  wikiAi: WikiAiService;
  help: HelpService;
  version: string;
}

export type AppEnv = { Variables: { user: AuthUser } };

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 500,
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

/** 세션 요약을 찾고 계정 범위를 검사한다 (본문은 읽지 않음) */
export async function sessionSummaryFor(c: Context<AppEnv>, deps: AppDeps, key: string): Promise<SessionSummary> {
  await deps.index.ensureFresh();
  const summary = deps.index.getSummary(key);
  if (!summary) throw notFound('세션');
  assertAccount(c, deps, summary.accountId, '세션');
  return summary;
}

/**
 * 쓰기 요청은 application/json 만 받는다. 다른 사이트의 폼 전송은 이 헤더를 붙이려면
 * CORS preflight 를 거쳐야 하고 이 서버는 preflight 를 허용하지 않으므로 CSRF 를 막는다.
 */
export const requireJson: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
    throw new HttpError(415, 'unsupported_media_type', '요청 본문은 application/json 이어야 합니다');
  }
  return next();
};

/** 요청 본문을 zod 로 검사한다. 형식이 틀리면 422 */
export async function parseBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(422, 'invalid_body', '요청 본문이 올바른 JSON 이 아닙니다');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.') || '본문'}: ${i.message}`).join('; '));
  return parsed.data;
}
