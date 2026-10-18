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
/** Anthropic API 요청의 생각 깊이·토큰 사용량 (claude CLI 에는 적용되지 않음) */
export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmSettings {
  provider: LlmProviderSetting;
  claudeCliPath: string | null;
  model: string | null;
  maxBudgetUsd: number;
  timeoutMs: number;
  effort: LlmEffort;
}

/** 제공자별 사용 가능 여부 (선택 UI 에 함께 보여 줌) */
export interface LlmProviderOption {
  id: LlmProviderId;
  available: boolean;
  reason?: string;
  /** CLI 버전 또는 API 모델 */
  detail?: string;
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
  llmOptions: LlmProviderOption[];
  /** VIBE_TEACHER_LLM_PROVIDER 환경변수가 설정되어 있으면 그 값 (화면의 선택보다 우선) */
  llmEnvOverride?: string;
  /** model 을 비웠을 때 Anthropic API 에 쓰는 모델 */
  llmDefaultModel: string;
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

/** 작업 상태. 결과 타입만 작업 종류마다 다르다 */
export interface BaseJobStatus<R> {
  id: string;
  sessionKey: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { kind: string; message: string; detail?: string };
  result?: R;
}

export type JobStatus = BaseJobStatus<EnrichmentRecord>;

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
