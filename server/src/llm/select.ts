import type { LlmProviderId, LlmProviderOption, LlmProviderSetting, LlmStatus } from '@vibe-teacher/shared';
import type { AppConfig } from '../config/schema';
import { ClaudeCliProvider, resolveClaudeBinary } from './claude-cli';
import type { ModelCatalog } from './models';
import { OpenAiCompatProvider } from './openai-compat';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from './types';

type LlmConfig = Omit<AppConfig['llm'], 'provider'> & { provider: LlmProviderSetting };

export interface ResolvedLlm { provider: LlmProvider | null; status: LlmStatus }
export interface LlmDeps { env?: NodeJS.ProcessEnv; catalog?: ModelCatalog; fetch?: typeof fetch }

export function modelFor(id: LlmProviderId, cfg: LlmConfig): string | null {
  return id === 'claude-cli' ? cfg.model : cfg.openrouterModel;
}

/** 일반 생성은 CLI 우선, 검색·CLI 실패는 OpenRouter. 취소한 요청은 재시도하지 않는다. */
export class RoutedProvider implements LlmProvider {
  readonly id: LlmProviderId;
  constructor(private readonly primary: LlmProvider, private readonly api: LlmProvider) { this.id = primary.id; }
  availability() { return this.primary.availability(); }
  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (req.signal?.aborted) throw new LlmError('cancelled', '작업이 취소되었습니다');
    if (req.task === 'research') return this.api.complete(req);
    try { return await this.primary.complete(req); }
    catch (err) {
      if (req.signal?.aborted || (err instanceof LlmError && err.kind === 'cancelled')) throw err;
      const available = await this.api.availability();
      if (!available.ok) throw new LlmError('unknown', `Claude CLI 작업에 실패했습니다. OpenRouter로 재시도하려면 OPENROUTER_API_KEY가 필요합니다. ${err instanceof Error ? err.message : String(err)}`);
      return this.api.complete(req);
    }
  }
}

function providers(cfg: LlmConfig, llmCwd: string, deps: LlmDeps) {
  const env = deps.env ?? process.env;
  return {
    cli: new ClaudeCliProvider({ binaryPath: cfg.claudeCliPath, cwd: llmCwd, model: cfg.model, maxBudgetUsd: cfg.maxBudgetUsd, env }),
    api: new OpenAiCompatProvider({ id: 'openrouter', model: cfg.openrouterModel, env, fetch: deps.fetch, structured: deps.catalog ? (m) => deps.catalog!.structured('openrouter', m) : undefined }),
  };
}

export async function resolveLlm(cfg: LlmConfig, llmCwd: string, deps: LlmDeps = {}): Promise<ResolvedLlm> {
  const env = deps.env ?? process.env;
  const setting = env.VIBE_TEACHER_LLM_PROVIDER?.trim() || cfg.provider;
  const { cli, api } = providers(cfg, llmCwd, deps);
  const cliPath = resolveClaudeBinary(cfg.claudeCliPath, env) ?? undefined;
  if (setting === 'none') return { provider: null, status: { resolvedProvider: 'none', available: false, reason: '설정에서 AI 생성을 껐습니다' } };
  // 예전 OpenAI·Anthropic 설정도 직접 API를 호출하지 않고 OpenRouter로 이관한다.
  if (setting === 'openrouter' || setting === 'openai' || setting === 'anthropic-sdk') {
    const a = await api.availability();
    return { provider: a.ok ? api : null, status: { resolvedProvider: a.ok ? 'openrouter' : 'none', available: a.ok, reason: a.reason } };
  }
  const c = await cli.availability();
  if (c.ok) return { provider: new RoutedProvider(cli, api), status: { resolvedProvider: 'claude-cli', available: true, cliPath, cliVersion: c.version } };
  const a = await api.availability();
  if (a.ok) return { provider: api, status: { resolvedProvider: 'openrouter', available: true, cliPath } };
  return { provider: null, status: { resolvedProvider: 'none', available: false, reason: `AI를 사용할 수 없습니다 (${c.reason ?? 'Claude CLI 없음'}; ${a.reason})`, cliPath } };
}

export async function probeProviders(cfg: LlmConfig, llmCwd: string, deps: LlmDeps = {}): Promise<LlmProviderOption[]> {
  const { cli, api } = providers(cfg, llmCwd, deps);
  return Promise.all([cli, api].map(async (p) => {
    const a = await p.availability();
    return { id: p.id, available: a.ok, ...(a.reason ? { reason: a.reason } : {}), ...(a.detail || a.version ? { detail: a.detail ?? a.version } : {}) };
  }));
}
