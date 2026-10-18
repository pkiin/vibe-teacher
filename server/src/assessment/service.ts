import { randomUUID } from 'node:crypto';
import type {
  AssessmentRequest,
  AssessmentResponseRequest,
  AssessmentResult,
  AssessmentStartResponse,
  LearnerProfile,
  ResponseEvent,
  WikiSnapshot,
} from '@vibe-teacher/shared';
import type { LearnerService } from '../learner/service';
import { gradeChoice, toPublicQuestion, type BankQuestion, type QuestionBank } from './bank';

interface Pending {
  assessmentId: string;
  attemptId: string;
  learnerId: string;
  projectId: string;
  sessionKey: string;
  questionId: string;
  questionVersion: number;
  firstAttempt: boolean;
  createdAt: number;
  result?: AssessmentResult;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_PENDING = 500;

/** 출제·채점. 정답은 서버에만 있고, 채점 결과는 학습자 원장에 응답 이벤트로 남는다. */
export class AssessmentService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly learner: LearnerService,
    private readonly bank: () => QuestionBank,
  ) {}

  private prune(): void {
    const now = Date.now();
    for (const [id, p] of this.pending) if (now - p.createdAt > TTL_MS) this.pending.delete(id);
    while (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  /** 해설을 이미 본 문항(정답 제출 또는 모르겠어요) — 다시 풀면 연습으로만 센다 */
  private seenExplanation(events: { kind: string; questionId?: string; status?: string }[], questionId: string): boolean {
    return events.some((e) => e.kind === 'response' && e.questionId === questionId && (e.status === 'answered' || e.status === 'dont_know'));
  }

  async start(learnerId: string, projectId: string, req: AssessmentRequest, snapshot: WikiSnapshot | null): Promise<AssessmentStartResponse> {
    this.prune();
    const requested = req.questionId ? this.bank().questions.get(req.questionId) : undefined;
    if (req.questionId && (!requested || requested.target !== 'concept_knowledge')) throw Object.assign(new Error('문항을 찾을 수 없습니다'), { status: 404, code: 'not_found' });
    let conceptId = req.conceptId ?? requested?.conceptIds[0];
    if (!conceptId && req.itemId) {
      const item = snapshot?.items.find((i) => i.id === req.itemId);
      if (!item) throw Object.assign(new Error('위키 항목을 찾을 수 없습니다'), { status: 404, code: 'not_found' });
      conceptId = item.conceptIds[0];
    }
    const exclude = new Set(req.excludeQuestionIds ?? []);
    const events = await this.learner.events(learnerId, projectId);
    const all = [...this.bank().questions.values()].filter((q) => q.target === 'concept_knowledge' && !exclude.has(q.questionId));
    const pool = all.filter((q) => q.conceptIds[0] === conceptId);
    const candidates = requested ? [requested] : pool.length ? pool : all.filter((q) => conceptId !== undefined && q.conceptIds.includes(conceptId));
    if (!candidates.length) throw Object.assign(new Error('이 개념에 준비된 문항이 없습니다'), { status: 404, code: 'no_question' });

    // 아직 해설을 보지 않은 문항 → OX 먼저 → ID 순
    candidates.sort(
      (a, b) =>
        Number(this.seenExplanation(events, a.questionId)) - Number(this.seenExplanation(events, b.questionId)) ||
        Number(b.format === 'true_false') - Number(a.format === 'true_false') ||
        a.questionId.localeCompare(b.questionId),
    );
    const q = candidates[0]!;
    const profile = await this.learner.profile(learnerId, projectId);
    const p: Pending = {
      assessmentId: `as_${randomUUID()}`,
      attemptId: `at_${randomUUID()}`,
      learnerId,
      projectId,
      sessionKey: req.sessionKey,
      questionId: q.questionId,
      questionVersion: q.version,
      firstAttempt: !this.seenExplanation(events, q.questionId),
      createdAt: Date.now(),
    };
    this.pending.set(p.assessmentId, p);
    return { assessmentId: p.assessmentId, attemptId: p.attemptId, question: toPublicQuestion(q), firstAttempt: p.firstAttempt, profileRevision: profile.revision };
  }

  async respond(learnerId: string, projectId: string, assessmentId: string, body: AssessmentResponseRequest): Promise<AssessmentResult> {
    const p = this.pending.get(assessmentId);
    // 다른 학습자·프로젝트의 문항이면 존재 자체를 숨긴다
    if (!p || p.learnerId !== learnerId || p.projectId !== projectId) throw Object.assign(new Error('문항을 찾을 수 없습니다. 새 문항을 받아 주세요.'), { status: 404, code: 'not_found' });
    if (p.result) return p.result;

    const current = this.bank().questions.get(p.questionId);
    const q: BankQuestion | undefined = current && current.version === p.questionVersion ? current : undefined;
    const graded = q ? gradeChoice(q, body.status, body.selectedOptionId) : { grade: 'unscorable' as const, note: '문항이 바뀌었거나 없어져 채점할 수 없습니다' };

    let before: LearnerProfile | null = null;
    const { profile } = await this.learner.record(learnerId, projectId, body.baseRevision, (cur) => {
      before = cur;
      const event: Omit<ResponseEvent, 'profileRevision'> = {
        id: `r_${p.attemptId}`,
        at: new Date().toISOString(),
        projectId,
        sessionKey: p.sessionKey,
        kind: 'response',
        responseId: `rs_${p.attemptId}`,
        attemptId: p.attemptId,
        questionId: p.questionId,
        questionVersion: p.questionVersion,
        conceptIds: q?.conceptIds ?? [],
        target: q?.target ?? 'concept_knowledge',
        questionKind: q?.kind ?? 'distinction',
        format: q?.format ?? 'true_false',
        questionReview: q?.reviewStatus ?? 'candidate',
        status: body.status,
        ...(body.selectedOptionId ? { selectedOptionId: body.selectedOptionId } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.confidence ? { confidence: body.confidence } : {}),
        assistance: body.helpUsed ? 'assisted' : 'unknown',
        explanationSeen: body.explanationSeen,
        firstAttempt: p.firstAttempt,
        grade: graded.grade,
        ...(graded.note ? { gradeNote: graded.note } : {}),
      };
      return event;
    });

    const scored = (pr: LearnerProfile | null) => (q?.conceptIds ?? []).reduce((n, id) => n + (pr?.concepts[id]?.counts.correct ?? 0) + (pr?.concepts[id]?.counts.incorrect ?? 0), 0);
    const counted = scored(profile) > scored(before);
    const reveal = body.status !== 'skipped' && !!q;
    const result: AssessmentResult = {
      status: body.status,
      grade: graded.grade,
      correctOptionIds: reveal ? q!.correctOptionIds : [],
      explanation: reveal ? q!.explanation : '',
      ...(reveal && body.selectedOptionId && q!.optionFeedback?.[body.selectedOptionId] ? { optionFeedback: q!.optionFeedback[body.selectedOptionId] } : {}),
      scopeNote: scopeNote({ q, status: body.status, grade: graded.grade, counted, firstAttempt: p.firstAttempt, assisted: body.helpUsed }),
      counted,
      relatedConceptIds: q?.conceptIds ?? [],
      profile,
    };
    p.result = result;
    return result;
  }
}

function scopeNote(x: { q?: BankQuestion; status: string; grade: string; counted: boolean; firstAttempt: boolean; assisted: boolean }): string {
  if (x.status === 'skipped') return '건너뛰기는 오답이 아닙니다. 나중에 다시 풀 수 있습니다.';
  if (x.status === 'dont_know') return '모르겠어요는 오답이 아닙니다. 해설을 보고 위키 설명을 이어서 읽어 보세요.';
  if (x.grade === 'unscorable') return '채점할 수 없는 응답이라 내 이해 정보에 반영하지 않았습니다.';
  if (!x.counted) {
    if (x.q?.reviewStatus !== 'reviewed') return '검토 전 문항이라 연습으로만 기록했습니다. 이해 상태 추정에는 반영하지 않습니다.';
    if (!x.firstAttempt) return '해설을 본 뒤의 재시도라 연습으로만 기록했습니다.';
    if (x.assisted) return '도움 패널을 사용한 응답이라 독립적인 이해 증거로 보지 않습니다.';
    return '이미 채점된 문항이라 연습으로만 기록했습니다.';
  }
  if (x.grade === 'incorrect') return '오답 한 번으로 오개념을 확정하지 않습니다. 관련 설명을 조금 더 자세히 보여 드립니다.';
  if (x.q?.format === 'true_false') return '이 문항의 정답 증거일 뿐, 개념 전체의 숙련 인증이 아닙니다 (OX는 추측으로 맞힐 수도 있습니다).';
  return '이 문항에서의 결과입니다. 개념 전체를 이해했다는 인증이 아닙니다.';
}
