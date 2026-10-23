import type { LlmProviderId, LlmProviderOption, LlmStatus } from '@vibe-teacher/shared';
import type { AppConfig } from '../config/schema';
import { AnthropicSdkProvider } from './anthropic-sdk';
import { ClaudeCliProvider, resolveClaudeBinary } from './claude-cli';
import type { ModelCatalog } from './models';
import { OpenAiCompatProvider } from './openai-compat';
import type { LlmProvider } from './types';

export interface ResolvedLlm {
  provider: LlmProvider | null;
  status: LlmStatus;
}

export interface LlmDeps {
  env?: NodeJS.ProcessEnv;
  catalog?: ModelCatalog;
  fetch?: typeof fetch;
}

/** 제공자별로 실제 요청에 쓰는 모델 (캐시 키·표시용) */
export function modelFor(id: LlmProviderId, cfg: AppConfig['llm']): string | null {
  if (id === 'openrouter') return cfg.openrouterModel;
  if (id === 'openai') return cfg.openaiModel;
  return cfg.model;
}

function providers(cfg: AppConfig['llm'], llmCwd: string, deps: LlmDeps): Record<LlmProviderId, LlmProvider> {
  const env = deps.env ?? process.env;
  return {
    'claude-cli': new ClaudeCliProvider({ binaryPath: cfg.claudeCliPath, cwd: llmCwd, model: cfg.model, maxBudgetUsd: cfg.maxBudgetUsd, env }),
    'anthropic-sdk': new AnthropicSdkProvider({ model: cfg.model, effort: cfg.effort, env }),
    openrouter: new OpenAiCompatProvider({ id: 'openrouter', model: cfg.openrouterModel, env, fetch: deps.fetch, structured: deps.catalog ? (m) => deps.catalog!.structured('openrouter', m) : undefined }),
    openai: new OpenAiCompatProvider({ id: 'openai', model: cfg.openaiModel, env, fetch: deps.fetch }),
  };
}

const IDS: LlmProviderId[] = ['claude-cli', 'anthropic-sdk', 'openrouter', 'openai'];

export async function resolveLlm(cfg: AppConfig['llm'], llmCwd: string, deps: LlmDeps = {}): Promise<ResolvedLlm> {
  const env = deps.env ?? process.env;
  const setting = env.VIBE_TEACHER_LLM_PROVIDER?.trim() || cfg.provider;
  const all = providers(cfg, llmCwd, deps);
  const cliPath = resolveClaudeBinary(cfg.claudeCliPath, env) ?? undefined;

  const pick = async (p: LlmProvider): Promise<ResolvedLlm> => {
    const a = await p.availability();
    const status: LlmStatus = { resolvedProvider: p.id, available: a.ok, reason: a.reason, cliPath };
    if (p.id === 'claude-cli' && a.version) status.cliVersion = a.version;
    return { provider: a.ok ? p : null, status };
  };

  if (setting === 'none') return { provider: null, status: { resolvedProvider: 'none', available: false, reason: '설정에서 AI 분석을 껐습니다', cliPath } };
  if ((IDS as string[]).includes(setting)) return pick(all[setting as LlmProviderId]);
  // auto: 글 작성에 쓸 GPT를 우선하고, 키가 없으면 기존 제공자를 이용한다.
  if (env.OPENAI_API_KEY) return pick(all.openai);
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return pick(all['anthropic-sdk']);
  const viaCli = await pick(all['claude-cli']);
  if (viaCli.provider) return viaCli;
  if (env.OPENROUTER_API_KEY) return pick(all.openrouter);
  return {
    provider: null,
    status: { resolvedProvider: 'none', available: false, reason: `사용 가능한 AI 제공자가 없습니다 (${viaCli.status.reason ?? 'claude CLI 없음'}; API 키도 없음)`, cliPath },
  };
}

/** 선택 UI 용: 제공자마다 실제로 쓸 수 있는지 확인한다 (설정과 무관) */
export async function probeProviders(cfg: AppConfig['llm'], llmCwd: string, deps: LlmDeps = {}): Promise<LlmProviderOption[]> {
  const all = providers(cfg, llmCwd, deps);
  const out: LlmProviderOption[] = [];
  for (const id of IDS) {
    const a = await all[id].availability();
    out.push({ id, available: a.ok, ...(a.reason ? { reason: a.reason } : {}), ...((a.version ?? a.detail) ? { detail: a.version ?? a.detail } : {}) });
  }
  return out;
}
