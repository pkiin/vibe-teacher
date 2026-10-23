import { describe, expect, it } from 'vitest';
import { buildQuestionBank, gradeChoice, toPublicQuestion } from '../../src/assessment/bank';

const TF = [{ id: 'o', text: 'O' }, { id: 'x', text: 'X' }];
const base = { version: 1, conceptIds: ['auth'], target: 'concept_knowledge', kind: 'distinction', explanation: '해설입니다.', reviewStatus: 'reviewed' };
const file = (questions: unknown[]) => ({ version: 't', rubricVersion: 'r', questions });

const fixtureBank = () => buildQuestionBank(file([{ ...base, questionId: 'q-fixture', format: 'true_false', prompt: '명제 하나입니다', options: TF, correctOptionIds: ['x'] }]));

describe('question bank', () => {
  it('rejects questions without a single best answer or with malformed OX options (T37)', () => {
    const bank = buildQuestionBank(
      file([
        { ...base, questionId: 'q-a', format: 'true_false', prompt: '명제 하나입니다', options: TF, correctOptionIds: [] },
        { ...base, questionId: 'q-b', format: 'true_false', prompt: '명제 하나입니다', options: [{ id: 'y', text: 'Y' }, { id: 'n', text: 'N' }], correctOptionIds: ['y'] },
        { ...base, questionId: 'q-c', format: 'single_choice', prompt: '고르세요 하나', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'c', text: '3' }], correctOptionIds: ['a', 'b'] },
        { ...base, questionId: 'q-d', format: 'true_false', prompt: '명제 하나입니다', options: TF, correctOptionIds: ['x'], conceptIds: ['ghost'] },
        { ...base, questionId: 'q-ok', format: 'true_false', prompt: '명제 하나입니다', options: TF, correctOptionIds: ['x'] },
      ]),
      new Set(['auth']),
    );
    expect([...bank.questions.keys()]).toEqual(['q-ok']);
    expect(bank.rejected.map((r) => r.questionId)).toEqual(['q-a', 'q-b', 'q-c', 'q-d']);
  });

  it('never sends answers or explanations to the browser before submission (T38)', () => {
    const bank = fixtureBank();
    for (const q of bank.questions.values()) {
      const json = JSON.stringify(toPublicQuestion(q));
      expect(json).not.toContain('correctOptionIds');
      expect(json).not.toContain(q.explanation);
    }
  });

  it('grades on the server and treats skip / dont-know as unscorable, not wrong (T30)', () => {
    const q = [...fixtureBank().questions.values()].find((x) => x.format === 'true_false')!;
    const right = q.correctOptionIds[0]!;
    const wrong = q.options.find((o) => o.id !== right)!.id;
    expect(gradeChoice(q, 'answered', right).grade).toBe('correct');
    expect(gradeChoice(q, 'answered', wrong).grade).toBe('incorrect');
    expect(gradeChoice(q, 'skipped').grade).toBe('unscorable');
    expect(gradeChoice(q, 'dont_know').grade).toBe('unscorable');
    expect(gradeChoice(q, 'answered', 'zzz').grade).toBe('unscorable');
  });
});
