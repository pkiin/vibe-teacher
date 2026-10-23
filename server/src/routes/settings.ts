import { Hono } from 'hono';
import { z } from 'zod';
import type { LlmModelsResponse, SettingsResponse, SettingsUpdateRequest } from '@vibe-teacher/shared';
import { LlmSchema } from '../config/schema';
import { DEFAULT_OPENAI_MODEL, DEFAULT_OPENROUTER_MODEL } from '../llm/models';
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
      provider: z.enum(['auto', 'claude-cli', 'anthropic-sdk', 'openrouter', 'openai', 'none']).optional(),
      claudeCliPath: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      maxBudgetUsd: z.number().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      openrouterModel: z.string().min(1).max(200).optional(),
      openaiModel: z.string().min(1).max(200).optional(),
      autoText: z.boolean().optional(),
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
    const envOverride = process.env.VIBE_TEACHER_LLM_PROVIDER?.trim();
    return {
      scan: cfg.scan,
      llm: cfg.llm,
      auth: cfg.auth,
      llmStatus: await deps.enrich.status(),
      llmOptions: await deps.enrich.providerOptions(),
      ...(envOverride ? { llmEnvOverride: envOverride } : {}),
      llmDefaultModel: 'Claude CLI 기본 모델',
      llmDefaultModels: { openrouter: DEFAULT_OPENROUTER_MODEL, openai: DEFAULT_OPENAI_MODEL },
      home: deps.paths.home,
    };
  };

  app.get('/', async (c) => {
    requireAdmin(c);
    return c.json(await respond());
  });

  /** 모델 선택 목록 (OpenRouter 공개 목록 / OpenAI 계정 목록). ?refresh=1 이면 캐시를 무시 */
  app.get('/llm-models', async (c) => {
    requireAdmin(c);
    const provider = c.req.query('provider');
    if (provider !== 'openrouter' && provider !== 'openai') throw new HttpError(422, 'invalid_query', 'provider 는 openrouter 또는 openai 여야 합니다');
    try {
      const { models, fetchedAt } = await deps.enrich.models.list(provider, c.req.query('refresh') === '1');
      const body: LlmModelsResponse = { provider, models, fetchedAt };
      return c.json(body);
    } catch (err) {
      throw new HttpError(409, 'models_unavailable', (err as Error).message);
    }
  });

  app.put('/', async (c) => {
    requireAdmin(c);
    const parsed = UpdateSchema.safeParse(await c.req.json<SettingsUpdateRequest>().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, 'bad_request', '설정 형식이 올바르지 않습니다');
    const scanChanged = !!parsed.data.scan;
    await deps.store.update((cfg) => {
      if (parsed.data.scan) cfg.scan = { ...cfg.scan, ...stripUndefined(parsed.data.scan) };
      if (parsed.data.llm) cfg.llm = LlmSchema.parse({ ...cfg.llm, ...stripUndefined(parsed.data.llm) });
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
