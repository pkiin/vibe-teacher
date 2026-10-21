/**
 * 레포 위키 — 프로젝트(저장소) 단위로 "이 레포가 무엇이고 어떻게 동작하는지"를 정리한다.
 * 저장소를 읽기 전용으로 살펴본 결과와 그 프로젝트의 세션들에서 모은 사실을 합쳐 만들고,
 * 새 세션이나 저장소 변경이 생기면 갱신하며 이전 판과 달라진 점을 남긴다.
 */
import type { LlmProviderId, LlmStatus } from './api';
import type { ReaderLevel } from './reader';
import type { Readable } from './domain';

export type RepoSource = { kind: 'file'; path: string } | { kind: 'session'; key: string; title: string };

export interface RepoListItem {
  text: string;
  detail?: string;
  sources?: RepoSource[];
}

export type RepoBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: RepoListItem[] }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface RepoSection {
  id: string;
  title: string;
  blocks: RepoBlock[];
  sources: RepoSource[];
  /** 이 절의 한계 (예: "코드를 정적으로 읽어 추정함") */
  note?: string;
  /** llm: AI 가 쓴 문장 (표·코드는 저장소에서 그대로), rule: 규칙 기반 문장 */
  origin?: 'llm' | 'rule';
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
  /** llm: AI 가 문장을 씀, rule: AI 를 쓸 수 없어 규칙 기반 (reason 에 사유) */
  generator: {
    kind: 'llm' | 'rule';
    version: string;
    provider?: LlmProviderId;
    model?: string;
    /** 규칙 기반으로 만든 사유 (제공자 없음, 권한 없음, 호출 실패, 설정에서 끔) */
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
  /** AI 를 쓸 수 없는 사유 (이 경우 규칙 기반으로 만든다) */
  fallbackReason?: string;
  chars: number;
  system: string;
  user: string;
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
