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
  return { seen, answer };
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
