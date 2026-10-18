import { z } from 'zod';

export const ProviderSchema = z.enum(['claude-code', 'codex', 'copilot-cli', 'copilot-vscode']);

export const CustomSourceSchema = z.object({
  id: z.string(),
  accountId: z.string().optional(),
  provider: ProviderSchema,
  path: z.string(),
  label: z.string().default(''),
  enabled: z.boolean().default(true),
});

export const ScanSchema = z.object({
  mode: z.enum(['current', 'list', 'all']).default('current'),
  homes: z.array(z.string()).default([]),
  homeRoots: z.array(z.string()).default(['/home']),
});

export const LlmSchema = z.object({
  provider: z.enum(['auto', 'claude-cli', 'anthropic-sdk', 'openrouter', 'openai', 'none']).default('auto'),
  claudeCliPath: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  maxBudgetUsd: z.number().positive().default(0.5),
  timeoutMs: z.number().int().positive().default(180_000),
  /** Anthropic API 요청의 effort. claude-opus-5-5 의 기본값과 같은 medium 으로 명시한다 */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  openrouterModel: z.string().min(1).default('openrouter/free'),
  openaiModel: z.string().min(1).default('gpt-5-mini'),
});

export const AuthSchema = z.object({
  mode: z.enum(['none', 'home-token']).default('none'),
  admins: z.array(z.string()).default([]),
  sessionTtlHours: z.number().positive().default(24 * 7),
  enrichFor: z.enum(['admins', 'everyone']).default('admins'),
});

/** 위키 설명 계획기의 초기 개발 기본값 (검증된 적정값이 아님, plan §15.4) */
export const WikiSchema = z.object({
  briefTokenBudget: z.number().int().positive().default(900),
  maxPrerequisiteDepth: z.number().int().min(0).max(5).default(2),
  maxPrerequisitesPerBundle: z.number().int().min(0).max(10).default(4),
  maxOptionalQuestions: z.number().int().min(0).max(10).default(2),
  suggestQuestions: z.boolean().default(true),
});

export const ServerSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().positive().default(8787),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  scan: ScanSchema.default({ mode: 'current', homes: [], homeRoots: ['/home'] }),
  sources: z.array(CustomSourceSchema).default([]),
  disabledDefaultSourceIds: z.array(z.string()).default([]),
  llm: LlmSchema.default({
    provider: 'auto',
    claudeCliPath: null,
    model: null,
    maxBudgetUsd: 0.5,
    timeoutMs: 180_000,
    effort: 'medium',
    openrouterModel: 'openrouter/free',
    openaiModel: 'gpt-5-mini',
  }),
  server: ServerSchema.default({ host: '127.0.0.1', port: 8787 }),
  auth: AuthSchema.default({ mode: 'none', admins: [], sessionTtlHours: 24 * 7, enrichFor: 'admins' }),
  wiki: WikiSchema.default({ briefTokenBudget: 900, maxPrerequisiteDepth: 2, maxPrerequisitesPerBundle: 4, maxOptionalQuestions: 2, suggestQuestions: true }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export type CustomSource = z.infer<typeof CustomSourceSchema>;
export type WikiSettings = z.infer<typeof WikiSchema>;

export function defaultConfig(): AppConfig {
  return ConfigSchema.parse({});
}
