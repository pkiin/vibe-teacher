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
  provider: z.enum(['auto', 'claude-cli', 'anthropic-sdk', 'none']).default('auto'),
  claudeCliPath: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  maxBudgetUsd: z.number().positive().default(0.5),
  timeoutMs: z.number().int().positive().default(180_000),
});

export const AuthSchema = z.object({
  mode: z.enum(['none', 'home-token']).default('none'),
  admins: z.array(z.string()).default([]),
  sessionTtlHours: z.number().positive().default(24 * 7),
  enrichFor: z.enum(['admins', 'everyone']).default('admins'),
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
  }),
  server: ServerSchema.default({ host: '127.0.0.1', port: 8787 }),
  auth: AuthSchema.default({ mode: 'none', admins: [], sessionTtlHours: 24 * 7, enrichFor: 'admins' }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export type CustomSource = z.infer<typeof CustomSourceSchema>;

export function defaultConfig(): AppConfig {
  return ConfigSchema.parse({});
}
