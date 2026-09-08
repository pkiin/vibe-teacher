import { Hono } from 'hono';
import { z } from 'zod';
import type { AddSourceRequest, PatchSourceRequest, RescanResponse } from '@vibe-teacher/shared';
import { ProviderSchema } from '../config/schema';
import { expandHome, normalizePath } from '../lib/fsx';
import { sourceIdFor } from '../index/session-index';
import { HttpError, currentUser, notFound, requireAdmin, type AppDeps, type AppEnv } from './deps';

const AddSchema = z.object({
  provider: ProviderSchema,
  path: z.string().min(1),
  label: z.string().optional(),
  accountId: z.string().optional(),
});

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
});

export function sourcesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    await deps.index.ensureFresh();
    const user = currentUser(c);
    const allowed = deps.auth.allowedAccountIds(user);
    const account = c.req.query('account') || undefined;
    return c.json(deps.index.getSources(account).filter((s) => allowed === 'all' || allowed.has(s.accountId)));
  });

  app.post('/', async (c) => {
    requireAdmin(c);
    const parsed = AddSchema.safeParse(await c.req.json<AddSourceRequest>().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, 'bad_request', '경로와 제공자를 입력하세요');
    const p = normalizePath(expandHome(parsed.data.path));
    const id = sourceIdFor(parsed.data.provider, p);
    await deps.store.update((cfg) => {
      if (cfg.sources.some((s) => s.id === id)) return;
      cfg.sources.push({ id, provider: parsed.data.provider, path: p, label: parsed.data.label ?? '', enabled: true, accountId: parsed.data.accountId });
    });
    await deps.index.rescan();
    const status = deps.index.getSource(id);
    if (!status) throw new HttpError(409, 'conflict', '같은 경로가 기본 소스로 이미 등록되어 있습니다');
    return c.json(status, 201);
  });

  app.patch('/:id', async (c) => {
    requireAdmin(c);
    const id = c.req.param('id');
    const parsed = PatchSchema.safeParse(await c.req.json<PatchSourceRequest>().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, 'bad_request', '잘못된 요청입니다');
    const existing = deps.index.getSource(id);
    if (!existing) throw notFound('소스');
    await deps.store.update((cfg) => {
      if (existing.kind === 'custom') {
        const s = cfg.sources.find((x) => x.id === id);
        if (!s) return;
        if (parsed.data.enabled !== undefined) s.enabled = parsed.data.enabled;
        if (parsed.data.label !== undefined) s.label = parsed.data.label;
      } else if (parsed.data.enabled !== undefined) {
        const set = new Set(cfg.disabledDefaultSourceIds);
        if (parsed.data.enabled) set.delete(id);
        else set.add(id);
        cfg.disabledDefaultSourceIds = Array.from(set);
      }
    });
    await deps.index.rescan();
    const status = deps.index.getSource(id);
    if (!status) throw notFound('소스');
    return c.json(status);
  });

  app.delete('/:id', async (c) => {
    requireAdmin(c);
    const id = c.req.param('id');
    const existing = deps.index.getSource(id);
    if (!existing) throw notFound('소스');
    if (existing.kind !== 'custom') throw new HttpError(400, 'bad_request', '기본 소스는 삭제할 수 없습니다. 대신 비활성화하세요');
    await deps.store.update((cfg) => {
      cfg.sources = cfg.sources.filter((s) => s.id !== id);
    });
    await deps.index.rescan();
    return c.body(null, 204);
  });

  return app;
}

export function rescanRoute(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/', async (c) => {
    requireAdmin(c);
    const res: RescanResponse = await deps.index.rescan();
    return c.json(res);
  });
  return app;
}
