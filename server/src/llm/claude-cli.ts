import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { LlmError, extractJson, type LlmAvailability, type LlmProvider, type LlmRequest, type LlmResult } from './types';

export interface ClaudeCliOptions {
  binaryPath?: string | null;
  cwd: string;
  model?: string | null;
  maxBudgetUsd: number;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof nodeSpawn;
}

/** 설정 → PATH 의 claude → CLAUDE_CODE_EXECPATH 순으로 바이너리를 찾는다 */
export function resolveClaudeBinary(configured: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (configured) candidates.push(configured);
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'claude'));
  }
  if (env.CLAUDE_CODE_EXECPATH) candidates.push(env.CLAUDE_CODE_EXECPATH);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // next
    }
  }
  return null;
}

/** 중첩 실행 차단을 피하기 위해 CLAUDE_CONFIG_DIR 를 제외한 CLAUDE* 변수를 모두 지운다 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^CLAUDE/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    out[k] = v;
  }
  return out;
}

export function buildArgs(opts: { schemaJson: string; system: string; model?: string | null; maxBudgetUsd: number }): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    opts.schemaJson,
    '--system-prompt',
    opts.system,
    '--no-session-persistence',
    '--tools',
    '',
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
  ];
  if (opts.model) args.push('--model', opts.model);
  return args;
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export class ClaudeCliProvider implements LlmProvider {
  readonly id = 'claude-cli' as const;
  private versionCache: { at: number; value: LlmAvailability } | null = null;
  constructor(private readonly opts: ClaudeCliOptions) {}

  get binary(): string | null {
    return resolveClaudeBinary(this.opts.binaryPath, this.opts.env ?? process.env);
  }

  async availability(): Promise<LlmAvailability> {
    const bin = this.binary;
    if (!bin) {
      return { ok: false, reason: 'claude CLI를 찾지 못했습니다 (PATH, CLAUDE_CODE_EXECPATH, 설정의 claudeCliPath 확인)' };
    }
    if (this.versionCache && Date.now() - this.versionCache.at < 60_000) return this.versionCache.value;
    const value: LlmAvailability = { ok: true, detail: bin };
    try {
      const version = await this.runVersion(bin);
      if (version) value.version = version;
    } catch {
      // 버전 조회 실패는 무시
    }
    this.versionCache = { at: Date.now(), value };
    return value;
  }

  private runVersion(bin: string): Promise<string> {
    const spawn = this.opts.spawn ?? nodeSpawn;
    return new Promise((resolve) => {
      let out = '';
      const child = spawn(bin, ['--version'], { env: childEnv(this.opts.env ?? process.env), cwd: this.opts.cwd, stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve('');
      }, 8000);
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.on('close', () => {
        clearTimeout(timer);
        resolve(out.trim().split('\n')[0] ?? '');
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve('');
      });
    });
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const bin = this.binary;
    if (!bin) throw new LlmError('spawn', 'claude CLI를 찾지 못했습니다');
    const spawn = this.opts.spawn ?? nodeSpawn;
    const schemaJson = JSON.stringify(toCliJsonSchema(req.schema));
    const args = buildArgs({ schemaJson, system: req.system, model: this.opts.model, maxBudgetUsd: this.opts.maxBudgetUsd });
    const started = Date.now();

    const { stdout, stderr, code, timedOut, cancelled } = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean; cancelled: boolean }>(
      (resolve, reject) => {
        let child: ChildProcess;
        try {
          child = spawn(bin, args, { cwd: this.opts.cwd, env: childEnv(this.opts.env ?? process.env), stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (err) {
          reject(new LlmError('spawn', `claude 실행 실패: ${(err as Error).message}`));
          return;
        }
        let out = '';
        let errOut = '';
        let timedOut = false;
        let cancelled = false;
        const killer = (why: 'timeout' | 'cancel') => {
          if (why === 'timeout') timedOut = true;
          else cancelled = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode == null) child.kill('SIGKILL');
          }, 5000).unref();
        };
        const timer = setTimeout(() => killer('timeout'), req.timeoutMs);
        const onAbort = () => killer('cancel');
        req.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr?.on('data', (d: Buffer) => (errOut += d.toString()));
        child.on('error', (err) => {
          clearTimeout(timer);
          req.signal?.removeEventListener('abort', onAbort);
          reject(new LlmError('spawn', `claude 실행 실패: ${err.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          req.signal?.removeEventListener('abort', onAbort);
          resolve({ stdout: out, stderr: errOut, code, timedOut, cancelled });
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(req.user);
      },
    );

    const stderrTail = stderr.trim().split('\n').slice(-8).join('\n');
    if (cancelled) throw new LlmError('cancelled', '작업이 취소되었습니다');
    if (timedOut) throw new LlmError('timeout', `claude 응답이 ${Math.round(req.timeoutMs / 1000)}초 안에 오지 않았습니다`, stderrTail);

    let parsed: CliResult | undefined;
    try {
      parsed = extractJson(stdout) as CliResult;
    } catch (err) {
      if (code !== 0) {
        const kind = /not logged in|auth|login|unauthorized|401/i.test(stderr + stdout) ? 'auth' : 'spawn';
        throw new LlmError(kind, `claude 종료 코드 ${code}: ${stderrTail || stdout.slice(0, 300) || '출력 없음'}`, stderrTail);
      }
      throw err;
    }
    if (parsed.is_error || (parsed.subtype && parsed.subtype !== 'success')) {
      const text = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result ?? '');
      const kind = parsed.subtype === 'error_max_budget_usd' || /budget/i.test(parsed.subtype ?? '') ? 'budget' : /login|auth|unauthorized/i.test(text) ? 'auth' : 'unknown';
      throw new LlmError(kind, `claude 오류(${parsed.subtype ?? 'error'}): ${text.slice(0, 300)}`, stderrTail);
    }
    let raw: unknown = parsed.structured_output;
    if (raw == null) {
      if (typeof parsed.result === 'string') raw = extractJson(parsed.result);
      else raw = parsed.result;
    }
    const validated = req.schema.safeParse(raw);
    if (!validated.success) throw new LlmError('parse', 'LLM 응답이 스키마와 맞지 않습니다', validated.error.message.slice(0, 500));
    return {
      data: validated.data,
      provider: 'claude-cli',
      model: this.opts.model ?? firstModel(parsed.modelUsage),
      costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
      usage: parsed.usage ? { input: parsed.usage.input_tokens ?? 0, output: parsed.usage.output_tokens ?? 0 } : undefined,
      durationMs: Date.now() - started,
    };
  }
}

/** claude CLI 의 검증기는 draft 2020-12 메타스키마를 모르므로 draft-7 로 만들고 $schema 를 뺀다 */
export function toCliJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function firstModel(modelUsage: Record<string, unknown> | undefined): string | undefined {
  if (!modelUsage) return undefined;
  return Object.keys(modelUsage)[0];
}
