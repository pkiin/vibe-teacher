/**
 * 도움 패널의 질문·답변 (plan §13.3). 질문은 개인 기록으로만 남고, 질문했다는 사실로 이해 상태를 바꾸지 않는다.
 * 프로젝트에 관한 답은 검증된 주장(claim)을 인용해야 하며, 일반 배경 설명과 구분한다.
 */
import { z } from 'zod';
import type { BaseJobStatus, LlmProviderId } from './api';

export type HelpFocusKind = 'session' | 'concept' | 'item' | 'finding' | 'file';

/** 질문 대상: 세션 전체, 개념, 위키 항목, 위험 항목, 파일 */
export interface HelpFocus {
  kind: HelpFocusKind;
  /** concept: 개념 ID, item·finding: 위키 ID, file: 경로 */
  id?: string;
}

export interface HelpAnswer {
  /** 질문에 대한 직접적인 답 */
  answer: string;
  /** 이번 프로젝트와의 연결 — claimIds 의 주장에 근거한다. 근거를 확인하지 못하면 비운다 */
  projectConnection: string;
  claimIds: string[];
  /** 일반 배경 지식 (프로젝트 사실이 아님) */
  generalNote: string;
  /** 기록으로 확인되지 않아 답할 수 없는 부분 */
  unverified: string[];
  followUps: string[];
  conceptIds: string[];
}

export type HelpMode = 'llm' | 'fallback';
export type HelpStatus = 'pending' | 'done' | 'error' | 'cancelled';

export interface HelpMessage {
  id: string;
  threadId: string;
  requestId: string;
  sessionKey: string;
  /** 답할 때 본 위키 snapshot (없으면 위키를 만들기 전) */
  snapshotRevision?: string;
  focus: HelpFocus;
  question: string;
  selectedText?: string;
  askedAt: string;
  status: HelpStatus;
  mode?: HelpMode;
  answer?: HelpAnswer;
  answeredAt?: string;
  provider?: LlmProviderId;
  model?: string;
  durationMs?: number;
  costUsd?: number;
  /** 사용자에게 알릴 제한 (예: AI 없이 카탈로그로 답함, 인용을 확인하지 못해 일부를 숨김) */
  notices: string[];
  error?: { kind: string; message: string };
  jobId?: string;
}

export interface HelpThreadsResponse {
  messages: HelpMessage[];
  /** 이 사용자가 지금 AI 로 질문할 수 있는지 */
  llm: { available: boolean; reason?: string; provider?: string };
}

export type HelpJobStatus = BaseJobStatus<HelpMessage>;

const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const HelpRequestSchema = z.object({
  sessionKey: z.string().max(2048),
  /** 재시도해도 한 번만 기록되도록 클라이언트가 붙이는 요청 ID */
  requestId: IdSchema,
  threadId: IdSchema.optional(),
  question: z.string().trim().min(1).max(2000),
  selectedText: z.string().max(2000).optional(),
  focus: z.object({
    kind: z.enum(['session', 'concept', 'item', 'finding', 'file']),
    id: z.string().max(500).optional(),
  }),
});

export type HelpRequest = z.infer<typeof HelpRequestSchema>;
