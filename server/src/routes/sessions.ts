import { Hono, type Context } from 'hono';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { extractUserMessages } from '../analyzers/user-messages';
import { learnerIdFor } from '../learner/service';
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

  /** 지금 사용자의 읽는 사람 수준 — AI 문장은 수준별로 따로 쓰고 저장한다 */
  const level = (c: Context<AppEnv>) => deps.prefs.level(learnerIdFor(currentUser(c).username));

  app.get('/:key', async (c) => {
    const session = await load(c);
    return c.json(c.req.query('full') === '1' ? session : slim(session));
  });

  app.get('/:key/user-messages', async (c) => c.json(extractUserMessages(await load(c))));

  app.get('/:key/built', async (c) => c.json((await deps.analysis.analyze(await load(c))).built));

  app.get('/:key/concepts', async (c) => {
    const session = await load(c);
    const { concepts } = await deps.analysis.analyze(session);
    const cached = await deps.enrich.getCached(session, await level(c));
    const snapshot = await deps.wiki.current(session.projectId, session.key);
    const layer = snapshot ? await deps.wikiAi.layer(session.projectId, snapshot.revision, await level(c), snapshot.generationId) : null;
    if (layer?.concepts) {
      const evidence = new Map(layer.evidence.map((e) => [e.id, e]));
      return c.json(layer.concepts.map((x) => ({ id: x.id, name: x.name, category: x.category, level: x.level ?? 'beginner', explanation: x.explanation, whyHere: x.whyHere ?? '', score: 0, links: x.links,
        evidence: (x.evidenceIds ?? []).flatMap((id) => { const e = evidence.get(id); return e ? [{ snippet: e.excerpt, messageIndex: e.messageIndex, toolCallId: e.toolCallId }] : []; }),
        llm: { explanation: x.explanation, whyHere: x.whyHere ?? '', example: x.example ?? null } })));
    }
    return c.json(cached ? deps.enrich.mergeConcepts([], cached) : []);
  });

  app.get('/:key/enrichment', async (c) => {
    const cached = await deps.enrich.getCached(await load(c), await level(c));
    if (!cached) throw notFound('AI 분석 결과');
    return c.json(cached);
  });

  app.get('/:key/enrich/preview', async (c) => {
    const session = await load(c);
    const { concepts } = await deps.analysis.analyze(session);
    return c.json(deps.enrich.preview(session, concepts, await level(c)));
  });

  app.post('/:key/enrich', async (c) => {
    const session = await load(c);
    const allowed = deps.auth.canEnrich(currentUser(c));
    if (!allowed.ok) throw new HttpError(403, 'forbidden', allowed.reason ?? 'AI 분석 권한이 없습니다');
    const force = c.req.query('force') === '1';
    const { concepts } = await deps.analysis.analyze(session);
    const res = await deps.enrich.start(session, concepts, force, await level(c));
    return c.json(res, res.status === 'done' ? 200 : 202);
  });

  return app;
}
