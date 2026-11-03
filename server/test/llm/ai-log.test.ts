import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeCliProvider } from '../../src/llm/claude-cli';
import { withAiRun, type AiCallRecord, type AiLog, type AiRunRecord } from '../../src/llm/log';
import { OpenAiCompatProvider } from '../../src/llm/openai-compat';
import { LlmError } from '../../src/llm/types';
import { WikiStorage } from '../../src/storage/store';

const schema = z.object({ title: z.string() });
const trace = { runId: '99999999-9999-4999-8999-999999999999', feature: 'session_enrich' as const, projectId: 'p1', sessionKey: 's1', readerLevel: 'junior' as const };

function memoryLog() {
  const calls: AiCallRecord[] = [];
  const runs: AiRunRecord[] = [];
  const log: AiLog = { call: async (r) => { calls.push(structuredClone(r)); }, run: async (r) => { runs.push(structuredClone(r)); } };
  return { log, calls, runs };
}

function fetchSeq(responses: { status?: number; body: string }[]) {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(r.body, { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
}

describe('AI 호출 기록 — OpenRouter', () => {
  it('실제 요청 본문·응답 원문·검사한 결과·토큰·요금·모델을 남기고 인증 헤더는 남기지 않는다', async () => {
    const { log, calls } = memoryLog();
    const body = JSON.stringify({
      id: 'gen-synthetic-1', model: 'openai/gpt-5-mini-2025', provider: 'SyntheticUpstream',
      choices: [{ message: { content: '{"title":"제목"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 12 } },
    });
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: 'openai/gpt-5-mini', env: { OPENROUTER_API_KEY: 'sk-or-synthetic-key-0000000000' }, fetch: fetchSeq([{ body }]), log });
    const r = await p.complete({ system: '시스템 프롬프트', user: '사용자 프롬프트', schema, schemaName: 'synthetic_out', maxTokens: 500, timeoutMs: 5000, trace });
    expect(r.data).toEqual({ title: '제목' });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c).toMatchObject({
      trace, provider: 'openrouter', task: 'text', schemaName: 'synthetic_out', attempt: 1, outputMode: 'json_schema', status: 'ok', httpStatus: 200,
      requestedModel: 'openai/gpt-5-mini', model: 'openai/gpt-5-mini-2025', generationId: 'gen-synthetic-1', costUsd: 0.00042,
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedTokens: 20, reasoningTokens: 12 },
      output: { title: '제목' },
    });
    const req = c.request as { url: string; headers: Record<string, string>; body: { messages: { role: string; content: string }[]; usage: unknown; response_format: unknown; max_tokens: number } };
    expect(req.url).toMatch(/\/chat\/completions$/);
    expect(req.body.messages).toEqual([{ role: 'system', content: '시스템 프롬프트' }, { role: 'user', content: '사용자 프롬프트' }]);
    expect(req.body).toMatchObject({ max_tokens: 500, usage: { include: true }, response_format: { type: 'json_schema' } });
    expect(c.response).toMatchObject({ id: 'gen-synthetic-1', provider: 'SyntheticUpstream' });
    expect(JSON.stringify(c)).not.toContain('sk-or-synthetic-key');
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('출력 형식을 바꿔 다시 보내면 두 요청을 모두 남기고, 스키마 불일치도 받은 응답과 함께 실패로 남긴다', async () => {
    const { log, calls } = memoryLog();
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, log, fetch: fetchSeq([
      { status: 400, body: JSON.stringify({ error: { message: 'response_format is not supported' } }) },
      { body: JSON.stringify({ choices: [{ message: { content: '{"title":"t"}' } }] }) },
    ]) });
    await p.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 });
    expect(calls.map((c) => [c.attempt, c.outputMode, c.status, c.httpStatus])).toEqual([[1, 'json_schema', 'error', 400], [2, 'prompt', 'ok', 200]]);
    expect(calls[0]!.response).toMatchObject({ error: { message: 'response_format is not supported' } });

    const bad = memoryLog();
    const wrong = new OpenAiCompatProvider({ id: 'openrouter', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, log: bad.log, fetch: fetchSeq([{ body: JSON.stringify({ choices: [{ message: { content: '{"title":3}' } }], usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.1 } }) }]) });
    await expect(wrong.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'parse' });
    expect(bad.calls[0]).toMatchObject({ status: 'error', error: { kind: 'parse' }, costUsd: 0.1, usage: { inputTokens: 5, outputTokens: 1 } });
    expect(bad.calls[0]!.output).toBeUndefined();
  });

  it('취소한 요청은 cancelled 로 남긴다', async () => {
    const { log, calls } = memoryLog();
    const ctrl = new AbortController();
    const fetchHang = ((_: unknown, init: RequestInit) => new Promise((_, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (init.signal!.aborted) abort();
      else init.signal!.addEventListener('abort', abort);
    })) as unknown as typeof fetch;
    const p = new OpenAiCompatProvider({ id: 'openrouter', model: 'm', env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchHang, log });
    const pending = p.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000, signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(calls[0]).toMatchObject({ status: 'cancelled', error: { kind: 'cancelled' } });
  });
});

function fakeSpawn(stdout: string, code = 0) {
  return ((_: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void; exitCode: number | null };
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
    child.kill = () => { child.exitCode = 143; child.emit('close', 143); };
    child.stdin.on('data', () => {});
    child.stdin.on('finish', () => setTimeout(() => { child.stdout.write(stdout); child.exitCode = code; child.emit('close', code); }, 1));
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('AI 호출 기록 — Claude CLI', () => {
  it('실행 인자(시스템 프롬프트·스키마)와 표준 입력, 출력 원문, 실제 모델·토큰·요금을 남긴다', async () => {
    const { log, calls } = memoryLog();
    const out = { type: 'result', subtype: 'success', is_error: false, structured_output: { title: '제목' }, total_cost_usd: 0.012,
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }, modelUsage: { 'claude-haiku-synthetic': {} } };
    const p = new ClaudeCliProvider({ binaryPath: process.execPath, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, spawn: fakeSpawn(JSON.stringify(out)), log });
    await p.complete({ task: 'repo-inspect', system: '시스템', user: '입력 프롬프트', schema, schemaName: 'repo_inspect_plan', maxTokens: 10, timeoutMs: 5000, trace });
    const c = calls[0]!;
    expect(c).toMatchObject({ provider: 'claude-cli', task: 'repo-inspect', outputMode: 'cli', status: 'ok', requestedModel: 'haiku', model: 'claude-haiku-synthetic', costUsd: 0.012,
      usage: { inputTokens: 115, outputTokens: 4, totalTokens: 119, cachedTokens: 100 }, output: { title: '제목' }, trace });
    const req = c.request as { command: string; args: string[]; stdin: string };
    expect(req.command).toBe('claude');
    expect(req.args).toEqual(expect.arrayContaining(['--system-prompt', '시스템', '--json-schema']));
    expect(req.stdin).toBe('입력 프롬프트');
    expect(JSON.stringify(req)).not.toContain(process.execPath);
    expect(c.response).toMatchObject({ exitCode: 0, output: { total_cost_usd: 0.012 } });
  });

  it('CLI 오류 응답도 출력과 함께 실패로 남긴다', async () => {
    const { log, calls } = memoryLog();
    const p = new ClaudeCliProvider({ binaryPath: process.execPath, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, log,
      spawn: fakeSpawn(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.5 }), 1) });
    await expect(p.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'budget' });
    expect(calls[0]).toMatchObject({ status: 'error', error: { kind: 'budget' }, costUsd: 0.5, response: { exitCode: 1 } });
  });
});

describe('withAiRun', () => {
  function storageWith(log: AiLog) {
    const backend = { aiLog: log, readJson: async () => null, writeJson: async () => {}, appendJsonl: async () => {}, readJsonl: async () => ({ items: [], warnings: [] }), lock: <T>(_: string, fn: () => Promise<T>) => fn() };
    return new WikiStorage('/synthetic/home', undefined, backend);
  }

  it('같은 runId 로 호출을 묶고 최종 결과물과 저장 키를 남긴다', async () => {
    const m = memoryLog();
    const storage = storageWith(m.log);
    const file = `${storage.projectDir('p1')}/ai/rev.junior.json`;
    const seen: string[] = [];
    const out = await withAiRun(storage, { feature: 'session_wiki', projectId: 'p1', readerLevel: 'junior' }, undefined, async (run) => {
      seen.push(run.trace.runId);
      run.result(file, { accepted: 3 });
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0]).toMatchObject({ status: 'done', artifactKey: 'projects/p1/ai/rev.junior.json', result: { accepted: 3 }, trace: { runId: seen[0], feature: 'session_wiki', projectId: 'p1' } });
  });

  it('실패와 취소를 구분해 남기고 원래 오류를 그대로 던진다', async () => {
    const m = memoryLog();
    const storage = storageWith(m.log);
    await expect(withAiRun(storage, { feature: 'repo_wiki' }, undefined, async () => { throw new LlmError('parse', '형식 오류'); })).rejects.toThrow('형식 오류');
    const ctrl = new AbortController(); ctrl.abort();
    await expect(withAiRun(storage, { feature: 'repo_wiki' }, ctrl.signal, async () => { throw new Error('중단'); })).rejects.toThrow('중단');
    expect(m.runs.map((r) => [r.status, r.error?.kind])).toEqual([['error', 'parse'], ['cancelled', 'unknown']]);
  });

  it('기록 대상이 없는 로컬 저장소에서는 실행만 한다', async () => {
    await expect(withAiRun(new WikiStorage('/synthetic/home'), { feature: 'help_answer' }, undefined, async () => 1)).resolves.toBe(1);
    await expect(withAiRun(undefined, { feature: 'help_answer' }, undefined, async () => 2)).resolves.toBe(2);
  });
});
