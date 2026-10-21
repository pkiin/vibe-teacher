/**
 * 선택형 이해 확인(객관식·OX). 정답·해설·루브릭은 서버 전용이며 제출 전에는 브라우저로 보내지 않는다.
 * 문항 풀이는 선택 사항이고, 건너뛰기·모르겠어요는 오답이 아니다.
 */
import { z } from 'zod';
import type { Grade, LearnerProfile, ResponseStatus } from './learner';

export type QuestionFormat = 'single_choice' | 'true_false';
export type QuestionTarget = 'concept_knowledge' | 'project_awareness';
/** distinction: 개념 구분, application: 새 상황 적용, project_check: 현재 프로젝트 확인 */
export type QuestionKind = 'distinction' | 'application' | 'project_check';
export type QuestionReview = 'reviewed' | 'candidate';

export interface QuestionOption {
  id: string;
  text: string;
}

/** 브라우저로 보내는 문항. correctOptionIds·해설은 포함하지 않는다. */
export interface PublicQuestion {
  questionId: string;
  version: number;
  conceptIds: string[];
  target: QuestionTarget;
  kind: QuestionKind;
  format: QuestionFormat;
  prompt: string;
  options: QuestionOption[];
  snapshotId?: string;
  claimIds: string[];
  rubricVersion: string;
  reviewStatus: QuestionReview;
}

export interface AssessmentStartResponse {
  assessmentId: string;
  attemptId: string;
  question: PublicQuestion;
  /** 이 학습자가 이미 해설을 본 문항이면 false — 연습으로만 기록된다 */
  firstAttempt: boolean;
  profileRevision: number;
}

export interface AssessmentResult {
  status: ResponseStatus;
  grade: Grade;
  /** 제출 후에만 공개 */
  correctOptionIds: string[];
  explanation: string;
  optionFeedback?: string;
  /** 이 결과를 어디까지 해석할 수 있는지 (예: "이 문항의 정답 증거일 뿐, 개념 전체의 숙련 인증이 아닙니다") */
  scopeNote: string;
  /** 개인 상태 추정에 반영되었는지 */
  counted: boolean;
  relatedConceptIds: string[];
  profile: LearnerProfile;
}

// ---- 요청 본문 ----

export const AssessmentRequestSchema = z
  .object({
    /** 세션 화면에서 풀면 그 세션 (전체 지식 위키에서는 없음) */
    sessionKey: z.string().max(2048).optional(),
    conceptId: z.string().regex(/^[a-z0-9-]+$/).max(64).optional(),
    itemId: z.string().max(80).optional(),
    /** 계획기가 제안한 특정 문항 */
    questionId: z.string().max(80).optional(),
    excludeQuestionIds: z.array(z.string().max(80)).max(100).optional(),
  })
  .refine((v) => v.conceptId || v.itemId || v.questionId, { message: 'conceptId, itemId, questionId 중 하나가 필요합니다' });

export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>;

export const AssessmentResponseRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  status: z.enum(['answered', 'dont_know', 'skipped']),
  selectedOptionId: z.string().max(40).optional(),
  reason: z.string().max(1000).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  explanationSeen: z.boolean().default(false),
  helpUsed: z.boolean().default(false),
});

export type AssessmentResponseRequest = z.infer<typeof AssessmentResponseRequestSchema>;
