/**
 * 프로젝트 지식 위키 — 프로젝트 평면(같은 snapshot 을 보는 모든 사용자에게 공통) 타입.
 * 사실(claim)·위험(finding)·지식 항목(item)은 근거(evidence) ID 로만 서로를 참조한다.
 * 개인 이해 상태는 learner.ts, 출제·채점은 assessment.ts 에 따로 둔다.
 */
import type { BaseJobStatus, LlmProviderId, LlmStatus } from './api';
import type { ConceptLink } from './domain';

export const WIKI_SCHEMA_VERSION = 1;

/** rule: 규칙 기반 원장, llm: AI 가 제안하고 코드 검사를 통과한 후보 */
export type ContentOrigin = 'rule' | 'llm';

/** 관찰(observed_artifact) / 에이전트 주장(agent_reported) / 해석(inference) / 일반 배경(background) */
export type ClaimKind = 'observed_artifact' | 'agent_reported' | 'inference' | 'background';
export type SupportStatus = 'supported' | 'insufficient_context' | 'conflicting' | 'retracted';

export type EvidenceSourceKind = 'human_message' | 'assistant_message' | 'tool_call' | 'tool_result';

export interface EvidenceRef {
  id: string;
  sessionKey: string;
  sourceKind: EvidenceSourceKind;
  messageIndex?: number;
  toolCallId?: string;
  /** 사람이 읽는 위치 표시 (예: "메시지 #12 · Bash") */
  locator: string;
  /** 비밀값을 마스킹하고 자른 발췌 */
  excerpt: string;
  /** 마스킹 전 원문 해시 — 같은 원문의 중복 근거를 가려내는 데 쓴다 */
  contentHash: string;
  timestamp?: string;
}

export interface ProjectClaim {
  id: string;
  statement: string;
  kind: ClaimKind;
  support: SupportStatus;
  evidenceIds: string[];
  /** 이 주장이 적용되는 snapshot(revision) */
  validAt: string;
  /** 관찰 범위의 한계 (예: "세션 기록 안에서만 확인") */
  limits: string[];
  origin?: ContentOrigin;
}

export type FindingCategory = 'security' | 'data' | 'verification' | 'change' | 'operation';
export type FindingEvidenceStatus = 'observed_in_scope' | 'supported_concern' | 'needs_check' | 'insufficient_context';
export type FindingImpact = 'high' | 'medium' | 'low' | 'undetermined';
export type FindingLifecycle = 'open' | 'recheck_required' | 'resolved_in_scope' | 'dismissed_with_reason';

/** 위험 또는 재확인할 사항. 근거 상태·영향·생명주기를 하나의 점수로 합치지 않는다. */
export interface RiskFinding {
  id: string;
  ruleId: string;
  ruleVersion: number;
  category: FindingCategory;
  title: string;
  /** 관찰 범위와 불확실성을 포함한 공통 문장 — 사용자 숙련도와 무관하게 동일 */
  statement: string;
  evidenceStatus: FindingEvidenceStatus;
  impact: FindingImpact;
  lifecycle: FindingLifecycle;
  claimIds: string[];
  checks: string[];
  relatedConceptIds: string[];
  missingContext: string[];
}

export type KnowledgeRelevance = 'direct' | 'background';

/** 이번 프로젝트에서 이해할 내용 하나. 프로젝트 근거와 개념·확인 행동을 잇는다. */
export interface KnowledgeItem {
  id: string;
  /** 현재 판단과 연결된 제목 (렌더링 속성일 뿐 식별자가 아님) */
  title: string;
  /** 사용자가 이 항목으로 답하게 될 질문 */
  question: string;
  /** 왜 지금 필요한지 (프로젝트 근거 기반) */
  why: string;
  relevance: KnowledgeRelevance;
  conceptIds: string[];
  claimIds: string[];
  findingIds: string[];
  actions: string[];
  unverified: string[];
  origin?: ContentOrigin;
}

export type CoverageLevel = 'available' | 'partial' | 'unavailable';

/** 무엇을 읽었고 무엇을 못 읽었는지. "없음"과 "확인 안 됨"을 구분하는 데 쓴다. */
export interface WikiCoverage {
  /** 제공된 기록 내부의 완결성만 뜻한다 (전체 개발 과정이 아님) */
  chat: 'complete_for_export' | 'partial';
  /** 도구 기록에 남은 파일 변경 */
  diff: CoverageLevel;
  /** 저장소 전체 코드 — P0 에서는 읽지 않는다 */
  repository: CoverageLevel;
  /** 명령 실행 결과 */
  runtimeLogs: CoverageLevel;
  deploymentConfig: CoverageLevel;
  notes: string[];
}

export type RunStatus = 'success' | 'partial' | 'failed';

/** 프로젝트 평면 원장: 세션 하나(= snapshot 하나)에서 만든 사실·위험·지식 항목 */
export interface WikiSnapshot {
  schemaVersion: number;
  projectId: string;
  sessionKey: string;
  /** 세션 파일 크기·수정 시각으로 정한 snapshot ID. Git commit 이 아니다 */
  revision: string;
  builtAt: string;
  generator: { kind: 'rule-based'; rulesVersion: string; catalogVersion: string };
  status: RunStatus;
  coverage: WikiCoverage;
  evidence: EvidenceRef[];
  claims: ProjectClaim[];
  findings: RiskFinding[];
  items: KnowledgeItem[];
  warnings: string[];
}

// ---- 개념 카탈로그 (일반 배경 지식, 프로젝트 사실과 별도) ----

export interface WikiConcept {
  id: string;
  name: string;
  category: string;
  /** D0: 한 줄 정의 */
  summary: string;
  /** D1: 핵심 설명 */
  explanation: string;
  /** D2: 적용 예시 */
  example?: string;
  /** D2: 흔한 혼동 */
  confusions: string[];
  /** D3: 구현 원리 */
  deep?: string;
  links: ConceptLink[];
}

// ---- 설명 계획 (개인 평면에서 파생, 프로젝트 사실은 바꾸지 않음) ----

export type ExplanationDepth = 'D0' | 'D1' | 'D2' | 'D3';

export interface RenderBundle {
  itemId: string;
  depth: ExplanationDepth;
  /** 먼저 이해하면 좋은 개념. 이미 이해 증거가 있으면 recallOnly(한 줄 상기) */
  prerequisites: { conceptId: string; recallOnly: boolean }[];
  /** 상한 때문에 넣지 못한 선행 개념 — 완전한 설명이라고 표시하지 않는다 */
  prerequisiteUnmet: string[];
  reasonCodes: string[];
  tokens: number;
}

export type BudgetStatus = 'within' | 'trimmed' | 'mandatory_overflow';

export interface RenderPlan {
  projectRevision: string;
  profileRevision: number;
  policyVersion: string;
  /** 사용자 상태를 보기 전에 정한 공통 알림 (finding ID) */
  commonAlertIds: string[];
  bundles: RenderBundle[];
  optionalQuestionIds: string[];
  deferred: { itemId: string; reason: string }[];
  budget: { limit: number; used: number; tokenizer: 'approximate'; status: BudgetStatus };
  missingContext: string[];
  /** 사용자 모델을 못 읽어 개인화 없이 만든 계획이면 false */
  personalized: boolean;
}

export interface WikiResponse {
  /** AI 보강 레이어가 있으면 그 claim·item·evidence 를 합친 것 (origin 으로 구분) */
  snapshot: WikiSnapshot;
  plan: RenderPlan;
  concepts: Record<string, WikiConcept>;
  /** 빌드 이후 세션 파일이 바뀌었으면 true (재빌드 필요) */
  stale: boolean;
  ai: WikiAiLayer | null;
}

// ---- AI 보강 레이어 (규칙 기반 원장과 따로 저장) ----

export const WIKI_AI_PROMPT_VERSION = 1;

/** 기존 지식 항목을 이 프로젝트에 맞춰 풀어 쓴 설명. 근거 주장이 없으면 싣지 않는다 */
export interface WikiNarrative {
  itemId: string;
  text: string;
  claimIds: string[];
}

export interface WikiAiRejection {
  kind: 'narrative' | 'claim' | 'item' | 'concept';
  ref: string;
  reason: string;
}

export interface WikiAiLayer {
  schemaVersion: number;
  snapshotRevision: string;
  rulesVersion: string;
  promptVersion: number;
  provider: LlmProviderId;
  model?: string;
  createdAt: string;
  durationMs: number;
  costUsd?: number;
  usage?: { input: number; output: number };
  narratives: WikiNarrative[];
  /** 검사를 통과한 새 주장 후보 (origin: llm) */
  claims: ProjectClaim[];
  /** 새 주장이 인용한 근거 (규칙 기반 원장에 없던 것) */
  evidence: EvidenceRef[];
  /** 검사를 통과한 새 지식 항목 후보 (origin: llm) */
  items: KnowledgeItem[];
  /** 카탈로그에 없는 개념 제안 — 자동으로 카탈로그에 넣지 않는다 */
  proposedConcepts: { name: string; reason: string }[];
  /** 검사에서 걸러 낸 제안과 이유 */
  rejected: WikiAiRejection[];
}

export interface WikiAiJobResult {
  revision: string;
  accepted: number;
  rejected: number;
}

export type WikiAiJobStatus = BaseJobStatus<WikiAiJobResult>;

export type WikiAiStartResponse = { status: 'done'; cached: true; layer: WikiAiLayer } | { status: 'queued' | 'running'; jobId: string };

/** 보내기 전에 확인하는 AI 전송 내용 */
export interface WikiAiPreview {
  llmStatus: LlmStatus;
  chars: number;
  system: string;
  user: string;
}
