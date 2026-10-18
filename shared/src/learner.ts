/**
 * 개인 평면 — 사용자 이해 증거와 개념별 상태 추정.
 * 프로젝트 사실·위험(wiki.ts)을 바꾸지 않고 설명 계획에만 반영한다.
 * 자기보고·노출·정답은 서로 다른 증거로 기록하며, 노출이나 건너뛰기를 이해/오답으로 바꾸지 않는다.
 */
import { z } from 'zod';

export const LEARNER_SCHEMA_VERSION = 1;

/** 판단할 증거 부족(unknown)이 기본값이다. 미숙지(unfamiliar)는 자기보고로만 들어온다. */
export type ConceptState = 'unknown' | 'partial' | 'demonstrated' | 'conflicting';
export type SelfReport = 'known' | 'unsure' | 'unfamiliar';
/** none: 앱 안 도움 미사용이 관찰됨, assisted: 도움 패널 사용, unknown: 관찰할 수 없음 */
export type Assistance = 'none' | 'assisted' | 'unknown';
export type ReviewStatus = 'auto_scored' | 'model_assessed' | 'human_reviewed' | 'disputed';

export type ExposureAction = 'open_item' | 'whats_this' | 'deeper' | 'simpler' | 'example' | 'evidence';
export type ResponseStatus = 'answered' | 'dont_know' | 'skipped';
export type Grade = 'correct' | 'incorrect' | 'unscorable';

interface LearnerEventBase {
  id: string;
  at: string;
  projectId: string;
  sessionKey?: string;
  /** 이 이벤트를 쓰기 직전 profile revision */
  profileRevision: number;
}

export interface SelfReportEvent extends LearnerEventBase {
  kind: 'self_report';
  conceptId: string;
  value: SelfReport;
}

export interface ExposureEvent extends LearnerEventBase {
  kind: 'exposure';
  action: ExposureAction;
  conceptId?: string;
  itemId?: string;
}

export interface CorrectionEvent extends LearnerEventBase {
  kind: 'correction';
  conceptId: string;
  note?: string;
}

export interface ResponseEvent extends LearnerEventBase {
  kind: 'response';
  responseId: string;
  attemptId: string;
  questionId: string;
  questionVersion: number;
  conceptIds: string[];
  target: 'concept_knowledge' | 'project_awareness';
  questionKind: 'distinction' | 'application' | 'project_check';
  format: 'single_choice' | 'true_false';
  questionReview: 'reviewed' | 'candidate';
  snapshotId?: string;
  status: ResponseStatus;
  selectedOptionId?: string;
  reason?: string;
  confidence?: 'low' | 'medium' | 'high';
  assistance: Assistance;
  /** 응답 전에 관련 위키 설명을 펼쳐 봤는지 (클라이언트 보고) */
  explanationSeen: boolean;
  /** 같은 문항의 해설을 이미 본 뒤의 재시도면 false — 연습 이력으로만 남는다 */
  firstAttempt: boolean;
  grade: Grade;
  gradeNote?: string;
}

export type LearnerEvent = SelfReportEvent | ExposureEvent | CorrectionEvent | ResponseEvent;

export interface ConceptEvidenceCounts {
  correct: number;
  incorrect: number;
  dontKnow: number;
  skipped: number;
  practice: number;
  exposure: number;
}

export interface LearnerConceptState {
  conceptId: string;
  state: ConceptState;
  selfReport?: SelfReport;
  /** 상태를 뒷받침하는 이벤트 ID */
  evidenceIds: string[];
  /** 상태가 성립하는 범위 (예: "문항 2개에서 · 자동 채점") — "완전히 이해함"이라고 쓰지 않는다 */
  assessmentScope?: string;
  assistance?: Assistance;
  reviewStatus?: ReviewStatus;
  lastObservedAt?: string;
  counts: ConceptEvidenceCounts;
  /** 사용자가 이 추정에 이의를 제기함 */
  disputed: boolean;
}

export interface LearnerProfile {
  schemaVersion: number;
  /** 인증된 사용자에서 만든 불투명 ID (사용자명 그대로가 아님) */
  learnerId: string;
  projectId: string;
  revision: number;
  updatedAt?: string;
  policyVersion: string;
  concepts: Record<string, LearnerConceptState>;
}

export interface UnderstandingResponse {
  profile: LearnerProfile;
  /** 최근 이벤트 (본인 것만) */
  events: LearnerEvent[];
  conceptNames: Record<string, string>;
}

// ---- 요청 본문 (서버가 zod 로 검사) ----

const ConceptIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(64);

export const FeedbackEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self_report'), conceptId: ConceptIdSchema, value: z.enum(['known', 'unsure', 'unfamiliar']) }),
  z.object({ kind: z.literal('correction'), conceptId: ConceptIdSchema, note: z.string().max(500).optional() }),
  z.object({
    kind: z.literal('exposure'),
    action: z.enum(['open_item', 'whats_this', 'deeper', 'simpler', 'example', 'evidence']),
    conceptId: ConceptIdSchema.optional(),
    itemId: z.string().max(80).optional(),
  }),
]);

export const FeedbackRequestSchema = z.object({
  /** 상태를 바꾸는 이벤트(self_report, correction)는 이 값이 현재 revision 과 같아야 한다 */
  baseRevision: z.number().int().nonnegative(),
  sessionKey: z.string().max(2048).optional(),
  /** 재시도해도 한 번만 기록되도록 클라이언트가 붙이는 요청 ID */
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  event: FeedbackEventSchema,
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
