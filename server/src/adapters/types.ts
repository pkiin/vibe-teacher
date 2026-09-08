import type {
  Account,
  Message,
  NormalizedSession,
  Provider,
  SessionSummary,
  Source,
  SourceStatus,
  ToolCall,
} from '@vibe-teacher/shared';

export interface SessionFileInfo {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/** 어댑터가 만들어 내는 세션 요약 초안. key/projectId/accountId/sourceId 는 인덱스가 채운다. */
export type SessionDraft = Omit<SessionSummary, 'key' | 'accountId' | 'sourceId' | 'projectId' | 'provider'>;

export interface NormalizedDraft extends SessionDraft {
  messages: Message[];
  toolCalls: ToolCall[];
  parseWarnings: string[];
}

export type NormalizedFromDraft = NormalizedSession;

export interface RootCandidate {
  path: string;
  label: string;
}

export interface DefaultRootContext {
  home: string;
  env: NodeJS.ProcessEnv;
  isCurrent: boolean;
  platform: NodeJS.Platform;
}

export interface SourceContext {
  account: Account;
  /** 어댑터가 prepare() 에서 만든 소스 단위 부가 정보 */
  extra?: unknown;
}

export interface HistoryAdapter {
  provider: Provider;
  label: string;
  /** 계정 홈 기준 기본 후보 경로 (존재하지 않을 수 있음) */
  defaultRoots(ctx: DefaultRootContext): RootCandidate[];
  /** 존재 여부와 세션 파일 수만 확인 (가벼움) */
  probe(source: Source): Promise<Omit<SourceStatus, keyof Source>>;
  listSessionFiles(source: Source): AsyncIterable<SessionFileInfo>;
  /** 소스 단위로 한 번 준비 (예: 활성 세션 목록 읽기) */
  prepare?(source: Source, account: Account): Promise<unknown>;
  scan(file: SessionFileInfo, source: Source, ctx: SourceContext): Promise<SessionDraft>;
  load(file: SessionFileInfo, source: Source, ctx: SourceContext): Promise<NormalizedDraft>;
}

export function emptyCounts() {
  return { human: 0, assistant: 0, toolCalls: 0, slashCommands: 0, subagents: 0 };
}
