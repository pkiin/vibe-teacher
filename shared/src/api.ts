import type {
  Account,
  BuiltSummary,
  ConceptHit,
  NormalizedSession,
  Project,
  Provider,
  SessionSummary,
  SourceStatus,
  UserMessagesResult,
} from './domain';
import type { Enrichment } from './enrich';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface HealthResponse {
  ok: true;
  version: string;
  home: string;
  runningAs: { uid: number; username: string };
  scanMode: ScanMode;
}

export type ScanMode = 'current' | 'list' | 'all';

export interface ScanSettings {
  mode: ScanMode;
  homes: string[];
  homeRoots: string[];
}

export type LlmProviderId = 'claude-cli' | 'anthropic-sdk';
export type LlmProviderSetting = 'auto' | LlmProviderId | 'none';

export interface LlmSettings {
  provider: LlmProviderSetting;
  claudeCliPath: string | null;
  model: string | null;
  maxBudgetUsd: number;
  timeoutMs: number;
}

export interface LlmStatus {
  resolvedProvider: LlmProviderId | 'none';
  available: boolean;
  reason?: string;
  cliPath?: string;
  cliVersion?: string;
}

export type AuthMode = 'none' | 'home-token';

export interface AuthSettings {
  mode: AuthMode;
  admins: string[];
  sessionTtlHours: number;
  enrichFor: 'admins' | 'everyone';
}

export interface AuthMeResponse {
  mode: AuthMode;
  authenticated: boolean;
  username?: string;
  isAdmin?: boolean;
  via?: 'cookie' | 'bearer' | 'open';
  canEnrich: boolean;
  enrichReason?: string;
  /** 비-loopback 바인딩 + 로그인 없음 모드에서 Bearer 토큰이 필요한지 */
  tokenRequired: boolean;
  /** 앱을 실행 중인 OS 계정 (토큰 파일 ACL 안내에 사용) */
  serviceUser: string;
  llmStatus: LlmStatus | null;
}

export interface LoginRequest {
  username: string;
  token: string;
}

export interface LoginResponse {
  username: string;
  isAdmin: boolean;
}

export interface SettingsResponse {
  scan: ScanSettings;
  llm: LlmSettings;
  auth: AuthSettings;
  llmStatus: LlmStatus;
  home: string;
}

export interface SettingsUpdateRequest {
  scan?: Partial<ScanSettings>;
  llm?: Partial<LlmSettings>;
  auth?: Partial<AuthSettings>;
}

export type AccountsResponse = Account[];

export interface AccountSummaryProject {
  project: Project;
  sessions: number;
  humanMessages: number;
  filesCreated: number;
  filesModified: number;
  packages: number;
  commits: number;
  topConcepts: { id: string; name: string; count: number }[];
}

export interface AccountSummaryResponse {
  account: Account;
  projects: AccountSummaryProject[];
  totals: {
    sessions: number;
    humanMessages: number;
    filesCreated: number;
    filesModified: number;
    packages: number;
    commits: number;
  };
  topConcepts: { id: string; name: string; count: number }[];
}

export type SourcesResponse = SourceStatus[];

export interface AddSourceRequest {
  provider: Provider;
  path: string;
  label?: string;
  accountId?: string;
}

export interface PatchSourceRequest {
  enabled?: boolean;
  label?: string;
}

export interface RescanResponse {
  accounts: number;
  sources: number;
  projects: number;
  sessions: number;
  durationMs: number;
}

export type ProjectsResponse = Project[];
export type SessionsResponse = SessionSummary[];
export type SessionResponse = NormalizedSession;
export type UserMessagesResponse = UserMessagesResult;
export type BuiltResponse = BuiltSummary;
export type ConceptsResponse = ConceptHit[];

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobStatus {
  id: string;
  sessionKey: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { kind: string; message: string; detail?: string };
  result?: EnrichmentRecord;
}

export interface EnrichmentRecord {
  sessionKey: string;
  provider: LlmProviderId;
  model?: string;
  promptVersion: number;
  createdAt: string;
  durationMs: number;
  costUsd?: number;
  usage?: { input: number; output: number };
  data: Enrichment;
}

export type EnrichStartResponse =
  | { status: 'done'; result: EnrichmentRecord; cached: true }
  | { status: 'queued' | 'running'; jobId: string };
