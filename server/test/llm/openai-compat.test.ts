import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultConfig } from '../../src/config/schema';
import { ModelCatalog, parseOpenAiModels, parseOpenRouterModels } from '../../src/llm/models';
import { OpenAiCompatProvider, toStrictJsonSchema } from '../../src/llm/openai-compat';
import { modelFor, probeProviders, resolveLlm } from '../../src/llm/select';
import { LlmError } from '../../src/llm/types';

const schema = z.object({ title: z.string(), note: z.string().nullable(), items: z.array(z.object({ name: z.string() })) });
const req = { system: 'sys', user: 'u', schema, schemaName: 'test_output', maxTokens: 1000, timeoutMs: 5000 };
const okBody = (content: string, extra: object = {}) => JSON.stringify({ model: 'routed/model:free', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 }, ...extra });

function fakeFetch(responses: { status?: number; body: string }[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(url), headers, body: JSON.parse(String(init.body ?? '{}')) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(r.body, { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('OpenAI-compatible provider', () => {
  it('makes every object strict for structured outputs', () => {
    const json = toStrictJsonSchema(schema) as { additionalProperties: boolean; required: string[]; properties: { items: { items: { additionalProperties: boolean } } } };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['title', 'note', 'items']);
    expect(json.properties.items.items.additionalProperties).toBe(false);
  });

  it('calls OpenRouter with a JSON schema and the key, and validates the answer', async () => {
    const { fn, calls } = fakeFetch([{ body: okBody('```json\n{"title":"제목","note":null,"items":[{"name":"a"}]}\n```', { usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0 } }) }]);
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: 'openrouter/free', env: { OPENROUTER_API_KEY: 'or-key' }, fetch: fn, structured: async () => true });
    const res = await p.complete(req);
    expect(res.data.title).toBe('제목');
    expect(res).toMatchObject({ provider: 'openrouter', model: 'routed/model:free', costUsd: 0, usage: { input: 10, output: 4 } });
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]!.headers.authorization).toBe('Bearer or-key');
    expect(calls[0]!.body).toMatchObject({ model: 'openrouter/free', max_tokens: 1000, response_format: { type: 'json_schema', json_schema: { name: 'test_output', strict: true } } });
  });

  it('uses max_completion_tokens for OpenAI', async () => {
    const { fn, calls } = fakeFetch([{ body: okBody('{"title":"t","note":"n","items":[]}') }]);
    await new OpenAiCompatProvider({ id: 'openai', model: 'gpt-5-mini', env: { OPENAI_API_KEY: 'sk-x' }, fetch: fn }).complete(req);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.body.max_completion_tokens).toBe(1000);
    expect(calls[0]!.body.max_tokens).toBeUndefined();
  });

  it('falls back to JSON mode or prompt instructions when the model cannot take a schema', async () => {
    const noSchema = fakeFetch([{ body: okBody('{"title":"t","note":null,"items":[]}') }]);
    await new OpenAiCompatProvider({ id: 'openrouter', model: 'x/plain:free', env: { OPENROUTER_API_KEY: 'k' }, fetch: noSchema.fn, structured: async () => false }).complete(req);
    expect(noSchema.calls[0]!.body.response_format).toEqual({ type: 'json_object' });
    expect(String((noSchema.calls[0]!.body.messages as { content: string }[])[0]!.content)).toContain('JSON 스키마');

    const rejected = fakeFetch([{ status: 400, body: JSON.stringify({ error: { message: 'response_format is not supported by this model' } }) }, { body: okBody('{"title":"t","note":null,"items":[]}') }]);
    const res = await new OpenAiCompatProvider({ id: 'openrouter', model: 'x/y', env: { OPENROUTER_API_KEY: 'k' }, fetch: rejected.fn, structured: async () => null }).complete(req);
    expect(res.data.title).toBe('t');
    expect(rejected.calls).toHaveLength(2);
    expect(rejected.calls[1]!.body.response_format).toBeUndefined();
  });

  it('maps HTTP errors to clear messages', async () => {
    const run = async (status: number, message: string) => {
      const { fn } = fakeFetch([{ status, body: JSON.stringify({ error: { message } }) }]);
      return new OpenAiCompatProvider({ id: 'openrouter', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, fetch: fn, structured: async () => true }).complete(req).catch((e: LlmError) => e);
    };
    expect(((await run(401, 'bad key')) as LlmError).kind).toBe('auth');
    expect(((await run(429, 'slow down')) as LlmError).kind).toBe('rate_limit');
    expect(((await run(402, 'no credits')) as LlmError).kind).toBe('budget');
    expect(((await run(404, 'No endpoints found matching your data policy')) as LlmError).message).toContain('Privacy');
  });

  it('rejects truncated or schema-breaking answers', async () => {
    const truncated = fakeFetch([{ body: JSON.stringify({ choices: [{ message: { content: '{"title"' }, finish_reason: 'length' }] }) }]);
    await expect(new OpenAiCompatProvider({ id: 'openai', model: 'm', env: { OPENAI_API_KEY: 'k' }, fetch: truncated.fn }).complete(req)).rejects.toMatchObject({ kind: 'parse' });
    const wrong = fakeFetch([{ body: okBody('{"title":3}') }]);
    await expect(new OpenAiCompatProvider({ id: 'openai', model: 'm', env: { OPENAI_API_KEY: 'k' }, fetch: wrong.fn }).complete(req)).rejects.toMatchObject({ kind: 'parse' });
  });

  it('reports a missing key instead of calling the network', async () => {
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: 'm', env: {} });
    expect(await p.availability()).toEqual({ ok: false, reason: 'OPENROUTER_API_KEY 환경변수가 없습니다' });
  });
});

describe('model catalog', () => {
  const orRaw = {
    data: [
      { id: 'b/paid', name: 'B Paid', pricing: { prompt: '0.000002', completion: '0.000008' }, supported_parameters: ['response_format'], context_length: 1000, architecture: { output_modalities: ['text'] } },
      { id: 'a/free:free', name: 'A Free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['structured_outputs'], architecture: { output_modalities: ['text'] } },
      { id: 'openrouter/free', name: 'Free Models Router', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['structured_outputs', 'response_format'] },
      { id: 'img/only', name: 'Image', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } },
      { id: 'openrouter/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
    ],
  };

  it('puts the free router first, then free models, and converts prices to $/1M', () => {
    const list = parseOpenRouterModels(orRaw);
    expect(list.map((m) => m.id)).toEqual(['openrouter/free', 'a/free:free', 'openrouter/auto', 'b/paid']);
    expect(list.find((m) => m.id === 'b/paid')).toMatchObject({ free: false, structured: false, promptPrice: 2, completionPrice: 8, contextLength: 1000 });
    expect(list.find((m) => m.id === 'openrouter/auto')?.promptPrice).toBeUndefined();
    expect(list[0]).toMatchObject({ free: true, structured: true });
  });

  it('keeps only chat models from OpenAI', () => {
    const list = parseOpenAiModels({ data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-audio-preview' }, { id: 'o4-mini' }, { id: 'dall-e-3' }] });
    expect(list.map((m) => m.id)).toEqual(['gpt-5-mini', 'o4-mini']);
  });

  it('caches the OpenRouter list and answers structured-output support from it', async () => {
    let n = 0;
    const fn = (async () => {
      n += 1;
      return new Response(JSON.stringify(orRaw));
    }) as unknown as typeof fetch;
    const c = new ModelCatalog({ fetch: fn });
    await c.list('openrouter');
    await c.list('openrouter');
    expect(n).toBe(1);
    expect(await c.structured('openrouter', 'a/free:free')).toBe(true);
    expect(await c.structured('openrouter', 'b/paid')).toBe(false);
    expect(await c.structured('openrouter', 'unknown/model')).toBeNull();
    await expect(new ModelCatalog({ env: {} }).list('openai')).rejects.toThrow('OPENAI_API_KEY');
  });
});

describe('provider selection', () => {
  const cfg = { ...defaultConfig().llm, claudeCliPath: '/nonexistent/claude' };
  // 실제 홈의 Claude Code 확장을 찾지 않도록 없는 홈을 쓴다
  const env = (e: Record<string, string>) => ({ PATH: '', HOME: '/nonexistent-home', ...e });

  it('defaults OpenRouter to the free router and picks providers by setting', async () => {
    expect(cfg.openrouterModel).toBe('openrouter/free');
    expect(modelFor('openrouter', cfg)).toBe('openrouter/free');
    const r = await resolveLlm({ ...cfg, provider: 'openrouter' }, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) });
    expect(r.status).toMatchObject({ resolvedProvider: 'openrouter', available: true });
    expect((await resolveLlm({ ...cfg, provider: 'openai' }, '/tmp', { env: env({}) })).status).toMatchObject({ resolvedProvider: 'openai', available: false });
  });

  it('auto prefers GPT when an OpenAI key is available, otherwise keeps existing fallbacks', async () => {
    expect((await resolveLlm(cfg, '/tmp', { env: env({ ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k', OPENAI_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openai');
    expect((await resolveLlm(cfg, '/tmp', { env: env({ OPENAI_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openai');
    expect((await resolveLlm(cfg, '/tmp', { env: env({ ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k' }) })).status.resolvedProvider).toBe('anthropic-sdk');
    expect((await resolveLlm(cfg, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openrouter');
  });

  it('keeps explicit settings and environment overrides ahead of the GPT preference', async () => {
    const keys = { ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k', OPENAI_API_KEY: 'k' };
    expect((await resolveLlm({ ...cfg, provider: 'anthropic-sdk' }, '/tmp', { env: env(keys) })).status.resolvedProvider).toBe('anthropic-sdk');
    expect((await resolveLlm(cfg, '/tmp', { env: env({ ...keys, VIBE_TEACHER_LLM_PROVIDER: 'openrouter' }) })).status.resolvedProvider).toBe('openrouter');
  });

  it('lists all four providers with their availability', async () => {
    const opts = await probeProviders(cfg, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) });
    expect(opts.map((o) => `${o.id}:${o.available}`)).toEqual(['claude-cli:false', 'anthropic-sdk:false', 'openrouter:true', 'openai:false']);
    expect(opts.find((o) => o.id === 'openrouter')?.detail).toBe('openrouter/free');
  });
});
