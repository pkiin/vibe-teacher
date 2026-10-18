import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeCliProvider, buildArgs, childEnv, toCliJsonSchema } from '../../src/llm/claude-cli';
import { EnrichmentSchema } from '@vibe-teacher/shared';
import { extractJson } from '../../src/llm/types';

function fakeSpawn(behavior: { stdout?: string; stderr?: string; code?: number; hang?: boolean }) {
  const calls: { bin: string; args: string[]; opts: Record<string, unknown>; stdin: string }[] = [];
  const spawn = ((bin: string, args: string[], opts: Record<string, unknown>) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: (s: string) => void; exitCode: number | null };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    let stdin = '';
    child.stdin.on('data', (d: Buffer) => (stdin += d.toString()));
    const rec = { bin, args, opts, stdin: '' };
    calls.push(rec);
    child.kill = () => {
      child.exitCode = 143;
      child.emit('close', 143);
    };
    child.stdin.on('finish', () => {
      rec.stdin = stdin;
      if (behavior.hang) return;
      setTimeout(() => {
        if (behavior.stdout) child.stdout.write(behavior.stdout);
        if (behavior.stderr) child.stderr.write(behavior.stderr);
        child.exitCode = behavior.code ?? 0;
        child.emit('close', behavior.code ?? 0);
      }, 5);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawn, calls };
}

const schema = z.object({ title: z.string() });
const bin = process.execPath; // 존재하는 실행 파일

describe('claude-cli provider', () => {
  it('builds safe headless args and strips CLAUDE* env except CLAUDE_CONFIG_DIR', () => {
    const args = buildArgs({ schemaJson: '{}', system: 'sys', model: 'sonnet', maxBudgetUsd: 0.25 });
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema', '{}', '--system-prompt', 'sys', '--no-session-persistence', '--tools', '', '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--max-budget-usd', '0.25', '--model', 'sonnet']));
    expect(args).not.toContain('--bare');
    const env = childEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_AUTH_TOKEN: 't' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' });
  });

  it('parses structured_output from the result JSON and passes the prompt via stdin', async () => {
    const { spawn, calls } = fakeSpawn({ stdout: 'noise\n' + JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"title":"x"}', structured_output: { title: '제목' }, total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 2 } }) + '\n' });
    const p = new ClaudeCliProvider({ binaryPath: bin, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, spawn });
    const r = await p.complete({ system: 's', user: '프롬프트', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 });
    expect(r.data).toEqual({ title: '제목' });
    expect(r.costUsd).toBe(0.01);
    expect(calls[0]?.stdin).toBe('프롬프트');
    expect((calls[0]?.opts.env as Record<string, string>).CLAUDECODE).toBeUndefined();
  });

  it('falls back to parsing result text and reports budget errors', async () => {
    const ok = fakeSpawn({ stdout: JSON.stringify({ type: 'result', subtype: 'success', result: '```json\n{"title":"t"}\n```' }) });
    const p1 = new ClaudeCliProvider({ binaryPath: bin, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, spawn: ok.spawn });
    expect((await p1.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 })).data).toEqual({ title: 't' });
    const budget = fakeSpawn({ stdout: JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: 'budget' }) });
    const p2 = new ClaudeCliProvider({ binaryPath: bin, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, spawn: budget.spawn });
    await expect(p2.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'budget' });
  });

  it('kills the child on timeout', async () => {
    const { spawn } = fakeSpawn({ hang: true });
    const p = new ClaudeCliProvider({ binaryPath: bin, cwd: '/tmp', maxBudgetUsd: 0.5, env: { PATH: '' }, spawn });
    await expect(p.complete({ system: 's', user: 'u', schema, schemaName: 'x', maxTokens: 10, timeoutMs: 50 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('emits a draft-7 JSON schema without $schema for the CLI', () => {
    const j = toCliJsonSchema(EnrichmentSchema) as { $schema?: string; type?: string; properties?: Record<string, unknown> };
    expect(j.$schema).toBeUndefined();
    expect(j.type).toBe('object');
    expect(Object.keys(j.properties ?? {})).toEqual(['summary', 'concepts']);
    expect(JSON.stringify(j)).not.toContain('2020-12');
  });

  it('extractJson finds the last JSON object in noisy output', () => {
    expect(extractJson('warn\n{"a":1}\n{"b":2}\n')).toEqual({ b: 2 });
    expect(() => extractJson('nothing')).toThrow();
  });
});
