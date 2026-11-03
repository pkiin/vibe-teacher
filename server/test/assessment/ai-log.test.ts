import { describe, expect, it } from 'vitest';
import type { WikiConcept } from '@vibe-teacher/shared';
import { buildQuestionBank } from '../../src/assessment/bank';
import { AssessmentService } from '../../src/assessment/service';
import { LearnerService } from '../../src/learner/service';
import type { AiCallRecord, AiRunRecord } from '../../src/llm/log';
import type { LlmProvider } from '../../src/llm/types';
import { WikiStorage, type StorageBackend } from '../../src/storage/store';

/** 회원 모드처럼 기록 대상이 있는 합성 저장소 (메모리) */
function memoryBackend() {
  const docs = new Map<string, unknown>();
  const events = new Map<string, unknown[]>();
  const runs: AiRunRecord[] = [];
  const calls: AiCallRecord[] = [];
  const backend: StorageBackend = {
    aiLog: { call: async (r) => { calls.push(r); }, run: async (r) => { runs.push(r); } },
    readJson: async <T>(f: string) => (docs.get(f) as T) ?? null,
    writeJson: async (f, v) => { docs.set(f, v); },
    appendJsonl: async (f, v) => { events.set(f, [...(events.get(f) ?? []), v]); },
    readJsonl: async <T>(f: string) => ({ items: (events.get(f) ?? []) as T[], warnings: [] }),
    lock: (_k, fn) => fn(),
  };
  return { backend, runs, calls };
}

describe('AI 연습 문항 기록', () => {
  it('생성한 문항을 정답·해설까지 실행 기록의 결과물로 남기고 화면 응답에는 정답을 내보내지 않는다', async () => {
    const m = memoryBackend();
    const storage = new WikiStorage('/synthetic/home', undefined, m.backend);
    const provider: LlmProvider = {
      id: 'openrouter',
      availability: async () => ({ ok: true }),
      complete: async (req) => {
        expect(req.trace).toMatchObject({ feature: 'practice_question', projectId: 'p1', sessionKey: 's1', readerLevel: 'junior' });
        return { data: req.schema.parse({ prompt: '합성 개념을 이 상황에 적용할 수 있나요?', format: 'true_false', kind: 'application',
          options: [{ id: 'o', text: '예' }, { id: 'x', text: '아니오' }], correctOptionId: 'o', explanation: '합성 해설입니다.' }), provider: 'openrouter', durationMs: 1 };
      },
    };
    const svc = new AssessmentService(new LearnerService(storage), () => buildQuestionBank({ version: 'ai-generated', rubricVersion: 'ai-practice-1', questions: [] }),
      { resolveProvider: async () => ({ provider, status: { resolvedProvider: 'openrouter', available: true } }), timeoutMs: () => 5000, storage });
    const concept = { id: 'c1', name: '합성 개념', explanation: '설명', example: null } as unknown as WikiConcept;
    const started = await svc.start('l_synthetic', 'p1', { conceptId: 'c1', sessionKey: 's1' }, null, new Map([['c1', concept]]), 'junior');

    expect(JSON.stringify(started.question)).not.toContain('correctOptionIds');
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0]).toMatchObject({ status: 'done', trace: { feature: 'practice_question', projectId: 'p1' }, result: { questionId: started.question.questionId, correctOptionIds: ['o'], explanation: '합성 해설입니다.' } });
  });
});
