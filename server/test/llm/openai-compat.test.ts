import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultConfig } from '../../src/config/schema';
import { ModelCatalog, parseOpenAiModels, parseOpenRouterModels } from '../../src/llm/models';
import { OpenAiCompatProvider, toStrictJsonSchema } from '../../src/llm/openai-compat';
import { modelFor, probeProviders, resolveLlm, RoutedProvider } from '../../src/llm/select';
import { LlmError, type LlmProvider } from '../../src/llm/types';

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

  it('redirects legacy OpenAI calls through OpenRouter with the OpenRouter key', async () => {
    const { fn, calls } = fakeFetch([{ body: okBody('{"title":"t","note":"n","items":[]}') }]);
    await new OpenAiCompatProvider({ id: 'openai', model: 'gpt-5-mini', env: { OPENROUTER_API_KEY: 'or-x', OPENAI_API_KEY: 'unused' }, fetch: fn }).complete(req);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]!.body.max_tokens).toBe(1000);
    expect(calls[0]!.body.model).toBe('openai/gpt-5-mini');
    expect(calls[0]!.headers.authorization).toBe('Bearer or-x');
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
    await expect(new OpenAiCompatProvider({ id: 'openai', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, fetch: truncated.fn }).complete(req)).rejects.toMatchObject({ kind: 'parse' });
    const wrong = fakeFetch([{ body: okBody('{"title":3}') }]);
    await expect(new OpenAiCompatProvider({ id: 'openai', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, fetch: wrong.fn }).complete(req)).rejects.toMatchObject({ kind: 'parse' });
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
    expect(list.map((m) => m.id)).toEqual(['a/free:free', 'openrouter/free', 'openrouter/auto', 'b/paid']);
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
    await c.list('openai');
    expect(n).toBe(2);
  });
});

describe('provider routing', () => {
  const cfg = { ...defaultConfig().llm, claudeCliPath: '/nonexistent/claude' };
  const env = (e: Record<string, string>) => ({ PATH: '', HOME: '/nonexistent-home', ...e });
  it('defaults to GPT-5 Mini through OpenRouter, and never uses direct API keys', async () => {
    expect(cfg.openrouterModel).toBe('openai/gpt-5-mini');
    expect(modelFor('openai', cfg)).toBe('openai/gpt-5-mini');
    expect((await resolveLlm(cfg, '/tmp', { env: env({ OPENAI_API_KEY: 'unused', ANTHROPIC_API_KEY: 'unused' }) })).status.available).toBe(false);
    expect((await resolveLlm(cfg, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openrouter');
    expect((await resolveLlm({ ...cfg, provider: 'openai' }, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openrouter');
    expect((await resolveLlm({ ...cfg, provider: 'anthropic-sdk' }, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) })).status.resolvedProvider).toBe('openrouter');
    expect((await probeProviders(cfg, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k' }) })).map((o) => o.id)).toEqual(['claude-cli', 'openrouter']);
  });
  it('prefers an available CLI even when API keys are present', async () => {
    const result = await resolveLlm({ ...cfg, claudeCliPath: process.execPath }, '/tmp', { env: env({ OPENROUTER_API_KEY: 'k', OPENAI_API_KEY: 'unused', ANTHROPIC_API_KEY: 'unused' }) });
    expect(result.status.resolvedProvider).toBe('claude-cli');
  });
  it('uses CLI for text, OpenRouter for research and CLI failures, and never retries cancellation', async () => {
    let cliCalls = 0, apiCalls = 0, fail = false;
    const cli: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async <T,>() => {
      cliCalls++; if (fail) throw new LlmError('spawn', 'CLI 실패');
      return { data: {} as T, provider: 'claude-cli', durationMs: 1 };
    } };
    const api: LlmProvider = { id: 'openrouter', availability: async () => ({ ok: true }), complete: async <T,>() => { apiCalls++; return { data: {} as T, provider: 'openrouter', durationMs: 1 }; } };
    const p = new RoutedProvider(cli, api);
    expect((await p.complete(req)).provider).toBe('claude-cli');
    expect((await p.complete({ ...req, task: 'research' })).provider).toBe('openrouter');
    expect(cliCalls).toBe(1);
    fail = true;
    expect((await p.complete(req)).provider).toBe('openrouter');
    const controller = new AbortController(); controller.abort();
    await expect(p.complete({ ...req, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(apiCalls).toBe(2);
  });
  it('enables web search only for research and retains actual citation metadata', async () => {
    const f = fakeFetch([{ body: JSON.stringify({ choices: [{ message: { content: '{"title":"t","note":null,"items":[]}', annotations: [{ type: 'url_citation', url_citation: { url: 'https://docs.example.test/framework', title: '공식 문서' } }] } }] }) }]);
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: cfg.openrouterModel, env: { OPENROUTER_API_KEY: 'key' }, fetch: f.fn });
    const result = await p.complete({ ...req, task: 'research' });
    expect(f.calls[0]?.body.plugins).toEqual([{ id: 'web', max_results: 5 }]);
    expect(result.sources).toEqual([{ title: '공식 문서', url: 'https://docs.example.test/framework' }]);
  });
});
