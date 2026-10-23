/**
 * 레포 위키 — 프로젝트(저장소) 단위로 "이 레포가 무엇이고 어떻게 동작하는지"를 정리한다.
 * 저장소를 읽기 전용으로 살펴본 결과와 그 프로젝트의 세션들에서 모은 사실을 합쳐 만들고,
 * 새 세션이나 저장소 변경이 생기면 갱신하며 이전 판과 달라진 점을 남긴다.
 */
import type { LlmProviderId, LlmStatus } from './api';
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
  | { kind: 'table'; head: string[]; rows: string[][] };

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
