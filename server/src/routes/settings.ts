import { Hono } from 'hono';
import { z } from 'zod';
import type { SettingsResponse, SettingsUpdateRequest } from '@vibe-teacher/shared';
import { HttpError, requireAdmin, type AppDeps, type AppEnv } from './deps';

const UpdateSchema = z.object({
  scan: z
    .object({
      mode: z.enum(['current', 'list', 'all']).optional(),
      homes: z.array(z.string()).optional(),
      homeRoots: z.array(z.string()).optional(),
    })
    .optional(),
  llm: z
    .object({
      provider: z.enum(['auto', 'claude-cli', 'anthropic-sdk', 'none']).optional(),
      claudeCliPath: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      maxBudgetUsd: z.number().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
  auth: z
    .object({
      mode: z.enum(['none', 'home-token']).optional(),
      admins: z.array(z.string()).optional(),
      sessionTtlHours: z.number().positive().optional(),
      enrichFor: z.enum(['admins', 'everyone']).optional(),
    })
    .optional(),
});

export function settingsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const respond = async (): Promise<SettingsResponse> => {
    const cfg = deps.store.get();
    return { scan: cfg.scan, llm: cfg.llm, auth: cfg.auth, llmStatus: await deps.enrich.status(), home: deps.paths.home };
  };

  app.get('/', async (c) => {
    requireAdmin(c);
    return c.json(await respond());
  });

  app.put('/', async (c) => {
    requireAdmin(c);
    const parsed = UpdateSchema.safeParse(await c.req.json<SettingsUpdateRequest>().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, 'bad_request', '설정 형식이 올바르지 않습니다');
    const scanChanged = !!parsed.data.scan;
    await deps.store.update((cfg) => {
      if (parsed.data.scan) cfg.scan = { ...cfg.scan, ...stripUndefined(parsed.data.scan) };
      if (parsed.data.llm) cfg.llm = { ...cfg.llm, ...stripUndefined(parsed.data.llm) };
      if (parsed.data.auth) cfg.auth = { ...cfg.auth, ...stripUndefined(parsed.data.auth) };
    });
    deps.enrich.invalidate();
    deps.auth.invalidate();
    if (scanChanged) await deps.index.rescan();
    return c.json(await respond());
  });

  return app;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
