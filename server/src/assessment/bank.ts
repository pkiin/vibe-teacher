import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Grade, PublicQuestion, ResponseStatus } from '@vibe-teacher/shared';

/**
 * 선택형 문항 은행. 정답(correctOptionIds)·해설은 서버에만 있고 toPublicQuestion() 이 걷어 낸다.
 * 채점은 서버 코드가 하며, 건너뛰기·모르겠어요는 오답이 아니라 채점 불가(unscorable)로 남긴다.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_QUESTIONS_PATH = path.resolve(here, '../../data/questions.json');

export const QuestionSchema = z.object({
  questionId: z.string().regex(/^q-[a-z0-9-]+$/),
  version: z.number().int().positive(),
  conceptIds: z.array(z.string()).min(1),
  target: z.enum(['concept_knowledge', 'project_awareness']),
  kind: z.enum(['distinction', 'application', 'project_check']),
  format: z.enum(['single_choice', 'true_false']),
  prompt: z.string().min(5),
  options: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().min(1) })).min(2),
  correctOptionIds: z.array(z.string()),
  explanation: z.string().min(5),
  optionFeedback: z.record(z.string(), z.string()).optional(),
  reviewStatus: z.enum(['reviewed', 'candidate']),
  snapshotId: z.string().optional(),
  claimIds: z.array(z.string()).default([]),
});

export type BankQuestion = z.infer<typeof QuestionSchema> & { rubricVersion: string };

export const QuestionFileSchema = z.object({
  version: z.string(),
  rubricVersion: z.string(),
  note: z.string().optional(),
  questions: z.array(z.unknown()),
});

export interface QuestionBank {
  version: string;
  rubricVersion: string;
  questions: Map<string, BankQuestion>;
  /** 검사에 걸려 제외한 문항과 이유 */
  rejected: { questionId: string; issues: string[] }[];
}

/** 단일 최선 답, 명확한 OX, 존재하는 개념 ID 인지 검사한다. 문제가 없으면 빈 배열. */
export function questionIssues(q: z.infer<typeof QuestionSchema>, conceptIds?: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const optionIds = q.options.map((o) => o.id);
  if (new Set(optionIds).size !== optionIds.length) issues.push('선택지 ID 중복');
  if (q.correctOptionIds.length !== 1) issues.push('정답이 정확히 하나가 아님');
  for (const id of q.correctOptionIds) if (!optionIds.includes(id)) issues.push(`없는 선택지가 정답: ${id}`);
  if (q.format === 'true_false' && optionIds.join(',') !== 'o,x') issues.push('OX 문항의 선택지는 o, x 여야 함');
  if (q.format === 'single_choice' && optionIds.length < 3) issues.push('객관식 선택지가 3개 미만');
  if (q.target === 'project_awareness' && !q.snapshotId) issues.push('프로젝트 확인 문항에 snapshotId 없음');
  if (conceptIds) for (const c of q.conceptIds) if (!conceptIds.has(c)) issues.push(`카탈로그에 없는 개념: ${c}`);
  return issues;
}

export function buildQuestionBank(raw: unknown, conceptIds?: ReadonlySet<string>): QuestionBank {
  const file = QuestionFileSchema.parse(raw);
  const questions = new Map<string, BankQuestion>();
  const rejected: QuestionBank['rejected'] = [];
  for (const item of file.questions) {
    const parsed = QuestionSchema.safeParse(item);
    const id = (item as { questionId?: unknown })?.questionId;
    const questionId = typeof id === 'string' ? id : '(id 없음)';
    if (!parsed.success) {
      rejected.push({ questionId, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      continue;
    }
    const issues = questionIssues(parsed.data, conceptIds);
    if (questions.has(parsed.data.questionId)) issues.push('문항 ID 중복');
    if (issues.length) {
      rejected.push({ questionId, issues });
      continue;
    }
    questions.set(parsed.data.questionId, { ...parsed.data, rubricVersion: file.rubricVersion });
  }
  return { version: file.version, rubricVersion: file.rubricVersion, questions, rejected };
}

let cached: QuestionBank | null = null;

export function loadQuestionBank(conceptIds?: ReadonlySet<string>): QuestionBank {
  if (cached) return cached;
  cached = buildQuestionBank(JSON.parse(fs.readFileSync(DEFAULT_QUESTIONS_PATH, 'utf8')), conceptIds);
  if (cached.rejected.length) console.warn(`[assessment] 검사에 걸린 문항 ${cached.rejected.length}개를 제외했습니다: ${cached.rejected.map((r) => r.questionId).join(', ')}`);
  return cached;
}

export function toPublicQuestion(q: BankQuestion): PublicQuestion {
  return {
    questionId: q.questionId,
    version: q.version,
    conceptIds: q.conceptIds,
    target: q.target,
    kind: q.kind,
    format: q.format,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    ...(q.snapshotId ? { snapshotId: q.snapshotId } : {}),
    claimIds: q.claimIds,
    rubricVersion: q.rubricVersion,
    reviewStatus: q.reviewStatus,
  };
}

export function gradeChoice(q: BankQuestion, status: ResponseStatus, selectedOptionId?: string): { grade: Grade; note?: string } {
  if (status === 'skipped') return { grade: 'unscorable', note: '건너뛰기 — 오답이 아님' };
  if (status === 'dont_know') return { grade: 'unscorable', note: '모르겠어요 — 오답이 아님' };
  if (!selectedOptionId || !q.options.some((o) => o.id === selectedOptionId)) return { grade: 'unscorable', note: '없는 선택지' };
  return { grade: q.correctOptionIds.includes(selectedOptionId) ? 'correct' : 'incorrect' };
}
