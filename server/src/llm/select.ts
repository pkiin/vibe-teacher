import type { LlmStatus } from '@vibe-teacher/shared';
import type { AppConfig } from '../config/schema';
import { AnthropicSdkProvider } from './anthropic-sdk';
import { ClaudeCliProvider, resolveClaudeBinary } from './claude-cli';
import type { LlmProvider } from './types';

export interface ResolvedLlm {
  provider: LlmProvider | null;
  status: LlmStatus;
}

export async function resolveLlm(cfg: AppConfig['llm'], llmCwd: string, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedLlm> {
  const setting = env.VIBE_TEACHER_LLM_PROVIDER?.trim() || cfg.provider;
  const cli = new ClaudeCliProvider({ binaryPath: cfg.claudeCliPath, cwd: llmCwd, model: cfg.model, maxBudgetUsd: cfg.maxBudgetUsd, env });
  const sdk = new AnthropicSdkProvider({ model: cfg.model, env });
  const cliPath = resolveClaudeBinary(cfg.claudeCliPath, env) ?? undefined;

  const pick = async (p: LlmProvider): Promise<ResolvedLlm> => {
    const a = await p.availability();
    const status: LlmStatus = { resolvedProvider: p.id, available: a.ok, reason: a.reason, cliPath };
    if (p.id === 'claude-cli' && a.version) status.cliVersion = a.version;
    return { provider: a.ok ? p : null, status };
  };

  if (setting === 'none') return { provider: null, status: { resolvedProvider: 'none', available: false, reason: '설정에서 AI 분석을 껐습니다', cliPath } };
  if (setting === 'claude-cli') return pick(cli);
  if (setting === 'anthropic-sdk') return pick(sdk);
  // auto
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return pick(sdk);
  const viaCli = await pick(cli);
  if (viaCli.provider) return viaCli;
  return {
    provider: null,
    status: { resolvedProvider: 'none', available: false, reason: `사용 가능한 AI 제공자가 없습니다 (${viaCli.status.reason ?? 'claude CLI 없음'}; ANTHROPIC_API_KEY 도 없음)`, cliPath },
  };
}
