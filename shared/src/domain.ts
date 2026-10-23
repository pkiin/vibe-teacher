/**
 * 제공자에 독립적인 정규화 도메인 모델.
 * 서버 어댑터, 분석기, 라우트, 프론트 컴포넌트가 모두 이 타입을 기준으로 동작한다.
 */

export type Provider = 'claude-code' | 'codex' | 'copilot-cli' | 'copilot-vscode';

export const PROVIDERS: Provider[] = ['claude-code', 'codex', 'copilot-cli', 'copilot-vscode'];

export type Readable = 'ok' | 'denied' | 'missing';

/** 홈 디렉터리 하나 = 계정 하나 */
export interface Account {
  id: string;
  username: string;
  homePath: string;
  isCurrent: boolean;
  readable: Readable;
  sourceCount: number;
  sessionCount: number;
  projectCount: number;
  lastActivityAt?: string;
}

export interface Source {
  id: string;
  accountId: string;
  provider: Provider;
  path: string;
  label: string;
  kind: 'default' | 'custom';
  enabled: boolean;
}

export interface SourceStatus extends Source {
  exists: boolean;
  readable: Readable;
  sessionCount: number;
  lastModified?: string;
  note?: string;
}

export interface Project {
  id: string;
  accountId: string;
  rootPath: string;
  name: string;
  exists: boolean;
  providers: Provider[];
  sessionCount: number;
  lastActivityAt?: string;
  note?: string;
}

export interface SessionCounts {
  human: number;
  assistant: number;
  toolCalls: number;
  slashCommands: number;
  subagents: number;
}

export interface SessionSummary {
  /** base64url(`${provider}\0${filePath}`) — 상태 없이 복원 가능한 키 */
  key: string;
  accountId: string;
  provider: Provider;
  sourceId: string;
  projectId: string;
  projectRoot: string;
  sessionId: string;
  title: string;
  firstPrompt?: string;
  startedAt?: string;
  endedAt?: string;
  filePath: string;
  fileSize: number;
  fileMtime: number;
  counts: SessionCounts;
  models: string[];
  gitBranch?: string;
  toolVersion?: string;
  isLive?: boolean;
  parseWarnings?: string[];
}

export type MessageRole =
  | 'human'
  | 'slash-command'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'system-injected'
  | 'interrupt';

export interface MessageMeta {
  openedFiles?: string[];
  commandName?: string;
  commandArgs?: string;
  model?: string;
  viaLocalCommand?: boolean;
  subagentId?: string;
  hasImage?: boolean;
  subtype?: string;
}

export interface Message {
  id: string;
  index: number;
  role: MessageRole;
  timestamp?: string;
  text?: string;
  toolCall?: ToolCall;
  toolUseId?: string;
  isError?: boolean;
  meta?: MessageMeta;
}

export type ToolCategory =
  | 'shell'
  | 'file_write'
  | 'file_edit'
  | 'file_read'
  | 'search'
  | 'agent'
  | 'web'
  | 'question'
  | 'plan'
  | 'other';

export interface FileResult {
  kind: 'create' | 'update' | 'delete';
  filePath: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  interrupted?: boolean;
  exitCode?: number;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  structured?: FileResult | ShellResult;
}

export interface ToolCall {
  id: string;
  name: string;
  category: ToolCategory;
  command?: string;
  description?: string;
  paths: string[];
  /** 축약된 원본 입력 (긴 문자열은 잘림) */
  input: unknown;
  result?: ToolResult;
  /** 서브에이전트 안에서 실행된 호출이면 그 id */
  subagentId?: string;
  messageIndex?: number;
  /** 서브에이전트 호출이면 부모 세션에서 Agent 도구를 호출한 메시지 인덱스 */
  parentMessageIndex?: number;
  timestamp?: string;
}

export interface NormalizedSession extends SessionSummary {
  messages: Message[];
  toolCalls: ToolCall[];
  parseWarnings: string[];
}

/** 사람 프롬프트 하나와 다음 프롬프트 전까지의 활동 묶음 */
export interface TurnGroup {
  promptIndex: number;
  promptText: string;
  startedAt?: string;
  endedAt?: string;
  messageRange: [number, number];
  toolCallIds: string[];
  filesTouched: string[];
  finalAssistantText?: string;
  interrupted?: boolean;
}

// ---- 분석 결과 ----

export interface Evidence {
  toolCallId?: string;
  messageIndex?: number;
  snippet: string;
}

export interface FileFact {
  path: string;
  relPath?: string;
  language?: string;
  via: 'tool' | 'shell' | 'patch';
  count: number;
  evidence: Evidence[];
}

export type CommandCategory =
  | 'install'
  | 'git'
  | 'test'
  | 'run'
  | 'build'
  | 'scaffold'
  | 'deploy'
  | 'file'
  | 'inspect'
  | 'other';

export interface CommandFact {
  command: string;
  category: CommandCategory;
  count: number;
  failed: number;
  evidence: Evidence[];
}

export type PackageManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'pip'
  | 'uv'
  | 'poetry'
  | 'cargo'
  | 'go'
  | 'gem'
  | 'brew'
  | 'apt';

export interface PackageFact {
  manager: PackageManager;
  name: string;
  dev?: boolean;
  evidence: Evidence[];
}

export interface GitCommitFact {
  message?: string;
  hash?: string;
  pushed?: boolean;
  evidence: Evidence[];
}

export interface ServerFact {
  command: string;
  port?: number;
  evidence: Evidence[];
}

export interface StackFact {
  id: string;
  name: string;
  kind: 'language' | 'framework' | 'tool' | 'service';
  evidence: Evidence[];
}

export interface BuiltStats {
  humanMessages: number;
  toolCalls: number;
  durationMin?: number;
  errors: number;
}

export interface BuiltSummary {
  filesCreated: FileFact[];
  filesModified: FileFact[];
  filesDeleted: FileFact[];
  dirsCreated: string[];
  commandsRun: CommandFact[];
  packagesInstalled: PackageFact[];
  gitCommits: GitCommitFact[];
  gitInitialized: boolean;
  testsRun: CommandFact[];
  serversStarted: ServerFact[];
  stack: StackFact[];
  timeline: TurnGroup[];
  stats: BuiltStats;
}

export interface ConceptLink {
  title: string;
  url: string;
}

export interface ConceptLlmNote {
  explanation: string;
  whyHere: string;
  example?: string | null;
}

export interface ConceptHit {
  id: string;
  name: string;
  category: string;
  level: 'beginner' | 'intermediate';
  explanation: string;
  whyHere: string;
  /** 단순 대화 언급과 실제 파일·명령 등의 기록을 구분한다. AI 추가 개념은 생략 가능. */
  contextKind?: 'activity' | 'mention';
  score: number;
  evidence: Evidence[];
  links?: ConceptLink[];
  llm?: ConceptLlmNote;
}

export interface UserMessageItem {
  index: number;
  timestamp?: string;
  kind: 'human' | 'slash-command';
  text: string;
  chars: number;
  openedFiles?: string[];
  commandName?: string;
  interruptedNext?: boolean;
  turnDurationSec?: number;
  viaLocalCommand?: boolean;
}

export interface UserMessagesStats {
  human: number;
  slashCommands: number;
  totalChars: number;
  avgChars: number;
  firstAt?: string;
  lastAt?: string;
}

export interface UserMessagesResult {
  items: UserMessageItem[];
  stats: UserMessagesStats;
}
