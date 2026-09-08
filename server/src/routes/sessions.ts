import { Hono, type Context } from 'hono';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { extractUserMessages } from '../analyzers/user-messages';
import { HttpError, assertAccount, currentUser, notFound, type AppDeps, type AppEnv } from './deps';

function slim(session: NormalizedSession): NormalizedSession {
  return {
    ...session,
    toolCalls: session.toolCalls.map((tc) => ({ ...tc, input: undefined })),
    messages: session.messages.map((m) => (m.toolCall ? { ...m, toolCall: { ...m.toolCall, input: undefined } } : m)),
  };
}

export function sessionsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const load = async (c: Context<AppEnv>): Promise<NormalizedSession> => {
    await deps.index.ensureFresh();
    const key = c.req.param('key') ?? '';
    const summary = deps.index.getSummary(key);
    if (!summary) throw notFound('세션');
    assertAccount(c, deps, summary.accountId, '세션');
    const session = await deps.index.loadSession(key);
    if (!session) throw notFound('세션');
    return session;
  };

  app.get('/:key', async (c) => {
    const session = await load(c);
    return c.json(c.req.query('full') === '1' ? session : slim(session));
  });

  app.get('/:key/user-messages', async (c) => c.json(extractUserMessages(await load(c))));

  app.get('/:key/built', async (c) => c.json((await deps.analysis.analyze(await load(c))).built));

  app.get('/:key/concepts', async (c) => {
    const session = await load(c);
    const { concepts } = await deps.analysis.analyze(session);
    const cached = await deps.enrich.getCached(session);
    return c.json(cached ? deps.enrich.mergeConcepts(concepts, cached) : concepts);
  });

  app.get('/:key/enrichment', async (c) => {
    const cached = await deps.enrich.getCached(await load(c));
    if (!cached) throw notFound('AI 분석 결과');
    return c.json(cached);
  });

  app.post('/:key/enrich', async (c) => {
    const session = await load(c);
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw new HttpError(403, 'forbidden', allowed.reason ?? 'AI 분석 권한이 없습니다');
    const force = c.req.query('force') === '1';
    const { concepts } = await deps.analysis.analyze(session);
    const res = await deps.enrich.start(session, concepts, force);
    return c.json(res, res.status === 'done' ? 200 : 202);
  });

  return app;
}
