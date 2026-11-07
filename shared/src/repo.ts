/**
 * 레포 위키 — 프로젝트(저장소) 단위로 "이 레포가 무엇이고 어떻게 동작하는지"를 정리한다.
 * 저장소를 읽기 전용으로 살펴본 결과와 그 프로젝트의 세션들에서 모은 사실을 합쳐 만들고,
 * 새 세션이나 저장소 변경이 생기면 갱신하며 이전 판과 달라진 점을 남긴다.
 */
import type { BaseJobStatus, LlmProviderId, LlmStatus } from './api';
import type { ReaderLevel } from './reader';
import type { Readable } from './domain';

export type RepoSource = { kind: 'file'; path: string; startLine?: number; endLine?: number; hash?: string } | { kind: 'session'; key: string; title: string };

export interface RepoFileView {
  path: string;
  lines: string[];
  startLine: number;
  endLine: number;
  lineCount: number;
  hash: string;
  truncated: boolean;
  masked: boolean;
}

export interface RepoFlow {
  /** 파일 역할과 영역은 코드 근거를 읽은 AI가 채운다. */
  groups?: { id: string; label: string; description: string }[];
  nodes: { id: string; label: string; column: number; source: Extract<RepoSource, { kind: 'file' }>; description?: string; groupId?: string }[];
  edges: { from: string; to: string; label: string; source: Extract<RepoSource, { kind: 'file' }> }[];
  limited: boolean;
}

type FileSource = Extract<RepoSource, { kind: 'file' }>;

/**
 * 데이터베이스 표(테이블·뷰·컬렉션·ORM 모델)의 컬럼 하나.
 * 이름·타입·제약은 저장소 코드에서 구문으로 읽은 원문이고, description 만 AI 가 쓴다.
 */
export interface RepoDbColumn {
  name: string;
  /** 코드에 적힌 타입 그대로 */
  type: string;
  primaryKey?: boolean;
  /** 비어 있으면 안 되는 값 (NOT NULL, required, nullable=False 등) */
  notNull?: boolean;
  unique?: boolean;
  /** 기본값 식 그대로 */
  default?: string;
  /** 참조하는 표(외래 키) 원문. 예: auth.users(id), User */
  references?: string;
  /** 들어갈 수 있는 값을 제한하는 원문 (CHECK·enum) */
  check?: string;
  /** 실제 컬럼이 아니라 다른 표와의 관계를 나타내는 필드 (Prisma 관계 필드, ORM relationship) */
  relation?: boolean;
  source: FileSource;
  /** AI: 이 컬럼에 실제로 들어가는 값 */
  description?: string;
}

/** 이 표를 쓰는 주요 기능. usage 가 없으면 AI 설명 없이 코드에서만 확인한 연결이다 (기능 파일에 표 이름이 보임) */
export interface RepoDbFeatureUse { featureId: string; usage?: string; sources: RepoSource[] }

export interface RepoDbTable {
  /** 화면 앵커와 AI 입력에서 쓰는 id (영문 소문자·숫자·_·-) */
  id: string;
  name: string;
  schema?: string;
  /** model: 실제 표 이름을 프레임워크가 정하는 ORM 모델 (코드에 표 이름이 없음) */
  kind: 'table' | 'view' | 'collection' | 'model';
  /** 정의를 읽은 형식 (SQL, Prisma, Drizzle, SQLAlchemy …) */
  via: string;
  source: FileSource;
  columns: RepoDbColumn[];
  /** 컬럼이 많아 일부만 담았음 */
  columnsLimited?: boolean;
  /** 서버가 코드에서 찾은, 이 표를 쓰는 줄 (정의 파일 제외) */
  usages: FileSource[];
  usagesLimited?: boolean;
  /** 이 표를 읽고 쓰는 SQL 함수(Supabase RPC 등)의 정의 위치. 코드에서 이 함수를 부르는 줄도 usages 에 들어 있다 */
  routines?: { name: string; source: FileSource }[];
  /** AI: 이 표에 무엇을 저장하는지 */
  description?: string;
  features?: RepoDbFeatureUse[];
  /**
   * AI: "이 표는 주요 기능 중 무엇과 관계가 있나요?"에 대한 짧은 답 (서버가 읽은 사용 줄 발췌 근거).
   * 그래도 주요 기능과 잇지 못한 표에만 싣는다
   */
  linkAnswer?: { text: string; sources: RepoSource[] };
  /**
   * AI: 주요 기능이 아니라 로그인·잠금·기록 같은 공통 기반에서만 쓰는 표라면 그 기반과 이유 (근거 확인).
   * 주요 기능과 이어진 표에는 싣지 않는다
   */
  base?: { text: string; sources: RepoSource[] };
}

export interface RepoDatabase {
  tables: RepoDbTable[];
  /** 표가 많거나 읽은 파일 수 상한에 걸려 일부만 담았음 */
  limited: boolean;
}

/** 주요 기능이 쓰는 표 (레포 위키의 데이터베이스 표에서 거꾸로 모은 것) */
export interface RepoFeatureTable { id: string; name: string; kind: RepoDbTable['kind']; usage?: string; columns: string[]; source: FileSource }

/** 레포 위키를 쓸 때 AI가 고른 주요 기능. 읽는 사람 수준별 문장 레이어에 함께 저장한다. */
export interface RepoFeature {
  /** 영문 소문자·숫자·하이픈. 다시 생성해도 같은 기능이면 같은 id 를 쓰도록 이전 목록을 AI 에 준다 */
  id: string;
  name: string;
  summary: string;
  files: FileSource[];
  sessions: Extract<RepoSource, { kind: 'session' }>[];
  sources: RepoSource[];
  /** 이 기능이 쓰는 데이터베이스 표 */
  tables?: RepoFeatureTable[];
}

export interface RepoFeatureFlowStep { title: string; detail: string; sources: RepoSource[] }
export interface RepoFeatureFile { path: string; role: string; sources: RepoSource[] }
/** 저장소에서 읽은 줄을 그대로 보여 준다 (AI 가 다시 쓴 프롬프트가 아님) */
export interface RepoFeatureCode {
  source: FileSource;
  text: string;
  /** 이 코드가 AI 에 넘기는 프롬프트. 읽을 때 서버가 구문 분석으로 만든다 (AI 가 다시 쓴 문장이 아님) */
  prompts?: RepoFeaturePromptPart[];
}

/** text: 코드에 적힌 고정 문장, slot: 실행할 때 채워지는 값(코드의 식을 그대로 보여 줌) */
export interface RepoFeaturePromptSegment { kind: 'text' | 'slot'; text: string }
export interface RepoFeaturePromptPart {
  /** 프롬프트를 넘기거나 정의한 줄 */
  line: number;
  segments: RepoFeaturePromptSegment[];
  /** 거쳐 간 감싸는 함수 (예: withReader). 실행할 때 내용을 덧붙이거나 바꿀 수 있다 */
  via: string[];
  /** 따라간 변수·상수·함수가 있는 곳 */
  from: { path: string; line: number }[];
  /** 이 프롬프트를 넘기는 호출 (예: provider.complete · schemaName). 한 범위에 요청이 여러 개면 구분에 쓴다 */
  call?: string;
}

/** 기능이 AI·LLM API 를 부르는 곳 하나 */
export interface RepoFeatureAiCall {
  purpose: string;
  /** 코드에서 확인한 SDK·서비스 이름 */
  provider: string;
  /** 코드에 적힌 모델 값 또는 모델을 정하는 설정 이름. 근거 줄에서 확인한 것만 싣는다 */
  model?: string;
  modelOrigin: 'code' | 'config' | 'unknown';
  modelSource?: FileSource;
  systemPrompt?: RepoFeatureCode;
  userPrompt?: RepoFeatureCode;
  outputHandling: string;
  sources: RepoSource[];
}

/** 자세한 분석 중 AI 가 만든 질문과, 서버가 읽어 준 코드에 근거한 답 */
export interface RepoFeatureQuestion { round: number; question: string; answer: string; sources: RepoSource[] }

/** 기능별 페이지: wiki/projects/<p>/repo/features/<기능>.<수준>.json */
export interface RepoFeaturePage {
  version: number;
  featureId: string;
  level: ReaderLevel;
  /** 분석할 때의 레포 위키 판 */
  revision: string;
  at: string;
  name: string;
  summary: string;
  generator: { provider?: LlmProviderId; model?: string; durationMs: number; costUsd?: number; calls: number; rounds: number };
  overview: string[];
  overviewSources: RepoSource[];
  userFlow: RepoFeatureFlowStep[];
  files: RepoFeatureFile[];
  aiCalls: RepoFeatureAiCall[];
  questions: RepoFeatureQuestion[];
  limits: string[];
  warnings: string[];
  /** 읽은 코드 범위와 내용 지문. 파일이 바뀌면 다시 분석하라고 알린다 */
  read: { path: string; hash: string; startLine: number; endLine: number }[];
}

export const REPO_FEATURE_LIMITS = { rounds: 3, questionsPerRound: 6, maxChars: 48_000 } as const;

export interface RepoFeatureListItem extends RepoFeature {
  /** 이 수준의 자세한 분석을 마친 시각 (없으면 기본 정보만 있음) */
  analyzedAt?: string;
}

export interface RepoFeatureListResponse {
  level: ReaderLevel;
  revision?: string;
  features: RepoFeatureListItem[];
}

export interface RepoFeatureResponse {
  /** 지금 레포 위키의 기능 목록 항목. 다시 생성하면서 목록에서 빠졌으면 null */
  feature: RepoFeature | null;
  page: RepoFeaturePage | null;
  stale: boolean;
  staleReasons: string[];
  /** 분석을 실행할 수 없는 사유 (권한·제공자) */
  unavailable?: string;
  /** 진행 중인 분석 작업 */
  jobId?: string;
  limits: typeof REPO_FEATURE_LIMITS;
}

export type RepoFeatureAnalyzeResponse = { status: 'done'; response: RepoFeatureResponse } | { status: 'running' | 'queued'; jobId: string };
export type RepoFeatureJobStatus = BaseJobStatus<{ featureId: string; questions: number; files: number }>;

/** 분석을 시작하기 전 AI 에 처음 보내는 질문 계획 요청 (GET 은 AI 를 부르지 않는다) */
export interface RepoFeaturePreview {
  llmStatus: LlmStatus;
  fallbackReason?: string;
  system: string;
  user: string;
  chars: number;
  limits: typeof REPO_FEATURE_LIMITS;
}

export interface RepoListItem {
  text: string;
  detail?: string;
  sources?: RepoSource[];
}

export type RepoBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: RepoListItem[] }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'flow'; graph: RepoFlow }
  /** role: 화면이 긴 표를 접을 때 붙이는 이름 (api: API 경로 목록, scripts: 실행 스크립트) */
  | { kind: 'table'; head: string[]; rows: string[][]; role?: 'api' | 'scripts' }
  /** 주요 기능 목록(RepoWiki.features)에서 이 id 들을 기능 페이지 링크로 보여 준다 */
  | { kind: 'features'; ids: string[] }
  | { kind: 'database'; db: RepoDatabase };

export interface RepoSection {
  id: string;
  title: string;
  blocks: RepoBlock[];
  sources: RepoSource[];
  /** 이 절의 한계 (예: "코드를 정적으로 읽어 추정함") */
  note?: string;
  /** llm: AI 설명, source: 원문 자료. rule은 이전 저장 형식 호환용 */
  origin?: 'llm' | 'rule' | 'source';
}

export interface RepoWikiInputs {
  sessions: { key: string; title: string; at?: string; mtime?: number }[];
  repo: { readable: Readable; fileCount: number; truncated: boolean; head?: string; branch?: string; signature?: string };
}

export interface RepoWiki {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  rootPath: string;
  revision: string;
  builtAt: string;
  /** llm: AI 결과, pending: 생성 대기, unavailable: 생성 불가. rule은 이전 형식 호환용 */
  generator: {
    kind: 'llm' | 'rule' | 'pending' | 'unavailable';
    version: string;
    provider?: LlmProviderId;
    model?: string;
    /** 생성하지 못한 사유 (제공자 없음, 권한 없음, 호출 실패) */
    reason?: string;
    durationMs?: number;
    costUsd?: number;
    /** AI 에 보낸 입력의 지문. 같으면 다시 부르지 않고 이전 문장을 쓴다 */
    inputHash?: string;
  };
  inputs: RepoWikiInputs;
  /** 사용자 중심: 무엇을 하고, 어떻게 쓰고, 무엇을 알아 둬야 하는지 */
  user: RepoSection[];
  /** 기능·동작 중심: 어떻게 구성되어 어떻게 동작하는지 */
  system: RepoSection[];
  /** 주요 기능 목록 (이 수준의 AI 문장과 함께 만든다) */
  features?: RepoFeature[];
  /** 이전 판과 달라진 점 */
  changes: string[];
  warnings: string[];
  /** 다음 갱신 때 달라진 점을 계산하려고 남기는 요약 (화면에는 쓰지 않음) */
  facts: RepoFacts;
  previousFacts?: RepoFacts;
}

export interface RepoFacts {
  sessions: string[];
  features: string[];
  scripts: string[];
  routes: string[];
  dirs: string[];
  deps: string[];
  findings: string[];
  /** 데이터베이스 표와 컬럼 이름 (예전 판에는 없음) */
  tables?: string[];
}

export interface RepoWikiHistoryEntry {
  revision: string;
  builtAt: string;
  changes: string[];
  sessions: number;
}

export interface RepoWikiAiPreview {
  llmStatus: LlmStatus;
  /** AI를 쓸 수 없는 사유 (이 경우 생성하지 않는다) */
  fallbackReason?: string;
  chars: number;
  system: string;
  user: string;
  /** 생성 중 AI가 추가로 확인할 수 있는 코드 발췌의 상한. */
  inspection?: { maxQuestions: number; maxChars: number };
}

export type RepoWikiBuildResponse = { status: 'done'; response: RepoWikiResponse } | { status: 'running' | 'queued'; jobId: string };

export interface RepoWikiResponse {
  wiki: RepoWiki | null;
  /** 만든 뒤 새 세션이 생겼거나 저장소가 바뀌었으면 true */
  stale: boolean;
  staleReasons: string[];
  history: RepoWikiHistoryEntry[];
  /**
   * 문장은 읽는 사람 수준별로 따로 쓴다. 이 수준의 AI 문장이 아직 없고 쓸 수 있으면 canGenerate —
   * 화면이 자동으로 쓰기 작업(POST /repo-wiki/text)을 시작한다.
   */
  text?: { level: ReaderLevel; canGenerate: boolean };
}
