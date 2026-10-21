import type { ReaderLevel, ReaderPrefs } from './reader';
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

export type LlmProviderId = 'claude-cli' | 'anthropic-sdk' | 'openrouter' | 'openai';
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
  /** OpenRouter 모델 ID (기본 openrouter/free) */
  openrouterModel: string;
  /** OpenAI 모델 ID */
  openaiModel: string;
  /** AI 를 쓸 수 있으면 위키 문장을 AI 로 만든다 (기본 켬) */
  autoText: boolean;
}

/** 문장을 누가 썼는지. rule 이면 reason 에 AI 를 쓰지 못한 사유 */
export interface TextGenerator {
  kind: 'llm' | 'rule';
  provider?: LlmProviderId;
  model?: string;
  reason?: string;
}

/** 모델 선택 목록의 한 줄 (OpenRouter·OpenAI 의 모델 목록 API 에서 가져옴) */
export interface LlmModelInfo {
  id: string;
  name: string;
  /** 입력·출력 모두 0원 */
  free: boolean;
  contextLength?: number;
  /** JSON 스키마 강제(structured outputs) 지원 — 없으면 JSON 모드나 프롬프트 지시로 대신한다 */
  structured: boolean;
  /** 1M 토큰당 달러 (라우터처럼 정해지지 않았으면 없음) */
  promptPrice?: number;
  completionPrice?: number;
  description?: string;
}

export interface LlmModelsResponse {
  provider: 'openrouter' | 'openai';
  models: LlmModelInfo[];
  fetchedAt: string;
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
  /** 설정 llm.autoText — 켜져 있으면 사람이 읽는 문장을 AI 가 자동으로 쓴다 */
  autoText: boolean;
  /** 로그인한 사용자의 읽는 사람 수준 (AI 문장의 단어·설명 깊이) */
  reader: ReaderPrefs | null;
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
  llmDefaultModels: { openrouter: string; openai: string };
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
  /** 어느 읽는 사람 수준으로 썼는지 */
  readerLevel?: ReaderLevel;
  createdAt: string;
  durationMs: number;
  costUsd?: number;
  usage?: { input: number; output: number };
  data: Enrichment;
}

export type EnrichStartResponse =
  | { status: 'done'; result: EnrichmentRecord; cached: true }
  | { status: 'queued' | 'running'; jobId: string };
