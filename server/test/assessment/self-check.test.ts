import { describe, expect, it } from 'vitest';
import type { WikiConcept } from '@vibe-teacher/shared';
import { buildQuestionBank } from '../../src/assessment/bank';
import { AssessmentService } from '../../src/assessment/service';
import { LearnerService } from '../../src/learner/service';
import type { LlmProvider, LlmRequest } from '../../src/llm/types';
import { WikiStorage, type StorageBackend } from '../../src/storage/store';

/** 합성 메모리 저장소 */
function memoryStorage() {
  const docs = new Map<string, unknown>();
  const events = new Map<string, unknown[]>();
  const backend: StorageBackend = {
    readJson: async <T>(f: string) => (docs.get(f) as T) ?? null,
    writeJson: async (f, v) => { docs.set(f, v); },
    appendJsonl: async (f, v) => { events.set(f, [...(events.get(f) ?? []), v]); },
    readJsonl: async <T>(f: string) => ({ items: (events.get(f) ?? []) as T[], warnings: [] }),
    lock: (_k, fn) => fn(),
  };
  return new WikiStorage('/synthetic/home', undefined, backend);
}

/** 요청마다 다른 OX 문항을 돌려주는 합성 제공자 (정답은 항상 o) */
function oxProvider(seen: LlmRequest<unknown>[]): LlmProvider {
  return {
    id: 'openrouter',
    availability: async () => ({ ok: true }),
    complete: async (req) => {
      seen.push(req);
      return { data: req.schema.parse({ prompt: `합성 개념에 대한 문장 ${seen.length}번은 맞나요?`, format: 'true_false', kind: 'distinction',
        options: [{ id: 'o', text: 'O' }, { id: 'x', text: 'X' }], correctOptionId: 'o', explanation: '합성 해설입니다.' }), provider: 'openrouter', durationMs: 1 };
    },
  };
}

function setup() {
  const seen: LlmRequest<unknown>[] = [];
  const learner = new LearnerService(memoryStorage());
  const provider = oxProvider(seen);
  const svc = new AssessmentService(learner, () => buildQuestionBank({ version: 'ai-generated', rubricVersion: 'ai-practice-1', questions: [] }),
    { resolveProvider: async () => ({ provider, status: { resolvedProvider: 'openrouter', available: true } }), timeoutMs: () => 5000 });
  const concepts = new Map([['c1', { id: 'c1', name: '합성 개념', explanation: '설명', example: null } as unknown as WikiConcept]]);
  const answer = async (learnerId: string, choice: 'o' | 'x' | null) => {
    const started = await svc.start(learnerId, undefined, { conceptId: 'c1', purpose: 'self_check' }, null, concepts);
    return svc.respond(learnerId, undefined, started.assessmentId, choice
      ? { baseRevision: started.profileRevision, status: 'answered', selectedOptionId: choice, explanationSeen: false, helpUsed: false }
      : { baseRevision: started.profileRevision, status: 'skipped', explanationSeen: false, helpUsed: false });
  };
  return { seen, answer, svc, learner, concepts };
}

describe("'알고 있어요' OX 확인", () => {
  it('OX 문항만 요청하고, 맞혔을 때만 알고 있어요를 기록해 익히는 중으로 올린다', async () => {
    const { seen, answer } = setup();
    const ok = await answer('l_ok', 'o');
    expect(seen[0]?.system).toContain('OX(true_false)');
    expect(() => seen[0]?.schema.parse({ prompt: 'p', format: 'single_choice', kind: 'distinction', options: [], correctOptionId: 'a', explanation: 'e' })).toThrow();
    expect(ok.grade).toBe('correct');
    expect(ok.profile.concepts.c1?.selfReport).toBe('known');
    expect(ok.profile.concepts.c1?.state).toBe('partial');
    expect(ok.scopeNote).toContain('‘알고 있어요’로 기록했어요');
  });

  it('틀리거나 건너뛰면 알고 있어요를 기록하지 않는다', async () => {
    const { answer } = setup();
    const wrong = await answer('l_wrong', 'x');
    expect(wrong.grade).toBe('incorrect');
    expect(wrong.profile.concepts.c1?.selfReport).toBeUndefined();
    expect(wrong.scopeNote).toContain('맞혔을 때 기록돼요');
    const skipped = await answer('l_skip', null);
    expect(skipped.profile.concepts.c1?.selfReport).toBeUndefined();
  });
});

describe('문제 은행과 문제가 이상해요', () => {
  it('정답이 공개된 문제만 은행에 남기고, 건너뛴 문제는 남기지 않는다', async () => {
    const { answer, learner } = setup();
    await answer('l_bank', 'x');
    await answer('l_bank', null);
    const bank = await learner.questionBank('l_bank');
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({ prompt: '합성 개념에 대한 문장 1번은 맞나요?', correctOptionIds: ['o'], explanation: '합성 해설입니다.', grade: 'incorrect', status: 'answered', purpose: 'self_check' });
  });

  it('이상하다고 알린 문제는 상태에서 빠지고, 다음 문제를 만들 때 이전 문제와 사유를 보낸다', async () => {
    const { seen, answer, svc, learner, concepts } = setup();
    const wrong = await answer('l_flag', 'x');
    const [entry] = await learner.questionBank('l_flag');
    await expect(svc.feedback('l_flag', { baseRevision: wrong.profile.revision, questionId: 'q-unknown', questionVersion: 1, reason: 'other' })).rejects.toMatchObject({ status: 404 });
    const profile = await svc.feedback('l_flag', { baseRevision: wrong.profile.revision, questionId: entry!.questionId, questionVersion: entry!.version, reason: 'wrong_answer', note: '정답이 반대입니다' });
    expect(profile.concepts.c1?.counts.incorrect).toBe(0);
    const again = await svc.feedback('l_flag', { baseRevision: profile.revision, questionId: entry!.questionId, questionVersion: entry!.version, reason: 'ambiguous' });
    expect(again.revision).toBe(profile.revision);
    await svc.start('l_flag', undefined, { conceptId: 'c1' }, null, concepts);
    const input = JSON.parse(seen.at(-1)!.user) as { previousQuestions: { prompt: string; userFeedback?: string }[] };
    expect(input.previousQuestions).toEqual([{ prompt: entry!.prompt, userFeedback: '정답이 틀린 것 같음: 정답이 반대입니다' }]);
  });
});
