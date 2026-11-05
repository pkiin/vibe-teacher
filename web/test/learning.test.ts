import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QuestionExamples } from '../src/components/QuestionExamples';
import { LearningHistory } from '../src/components/LearningHistory';
import { reduceProfile } from '../../server/src/learner/reducer';

describe('learning controls', () => {
  it('shows directly actionable questions about the selected file and disables them during a request', () => {
    const html = renderToStaticMarkup(createElement(QuestionExamples, { label: 'src/auth.ts', kind: 'file', disabled: true, onAsk: () => {} }));
    expect(html).toContain('누르면 바로 질문합니다');
    expect(html).toContain('src/auth.ts');
    expect(html).toContain('수정하려면 먼저 어떤 개념');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
  it('makes solved questions and the original session visible, counting a first-try AI choice question', () => {
    const profile = reduceProfile([{ id: 'r1', at: '2026-10-24T00:00:00Z', kind: 'response', projectId: 'p1', sessionKey: 's1', profileRevision: 0, responseId: 'response1', attemptId: 'attempt1', questionId: 'q1', questionVersion: 1, conceptIds: ['auth'], target: 'concept_knowledge', questionKind: 'application', format: 'single_choice', questionReview: 'candidate', status: 'answered', assistance: 'unknown', explanationSeen: false, firstAttempt: true, grade: 'correct' }], 'l1');
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(LearningHistory, { state: profile.concepts.auth })));
    expect(html).toContain('정답 1번');
    expect(html).toContain('/sessions/s1?tab=understand');
    expect(profile.concepts.auth?.state).toBe('partial');
  });
  it('shows only solved counts, hiding wrong answers and question counts, and nudges to a quiz when nothing is solved', () => {
    const ev = (id: string, grade: 'correct' | 'incorrect', questionId: string) => ({ id, at: '2026-10-24T00:00:00Z', kind: 'response' as const, projectId: 'p1', sessionKey: 's1', profileRevision: 0, responseId: `rs_${id}`, attemptId: `at_${id}`, questionId, questionVersion: 1, conceptIds: ['auth'], target: 'concept_knowledge' as const, questionKind: 'application' as const, format: 'single_choice' as const, questionReview: 'candidate' as const, status: 'answered' as const, assistance: 'unknown' as const, explanationSeen: false, firstAttempt: true, grade });
    const render = (state: Parameters<typeof LearningHistory>[0]['state'], nudge?: string) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(LearningHistory, { state, nudge })));
    const mixed = reduceProfile([ev('r1', 'incorrect', 'q1'), ev('r2', 'correct', 'q2'), { id: 'h1', at: '2026-10-24T00:00:01Z', kind: 'question', projectId: 'p1', profileRevision: 0, conceptIds: ['auth'], messageId: 'm1' }], 'l1');
    const html = render(mixed.concepts.auth);
    expect(html).toContain('정답 1번');
    expect(html).not.toMatch(/오답|질문 \d|숙련 인증/);
    const wrongOnly = reduceProfile([ev('r1', 'incorrect', 'q1')], 'l1');
    expect(render(wrongOnly.concepts.auth, '간단히 확인하기를 눌러 보세요')).toContain('간단히 확인하기를 눌러 보세요');
    expect(render(wrongOnly.concepts.auth)).not.toContain('정답');
  });
});
