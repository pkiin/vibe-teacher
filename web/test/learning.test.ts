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
  it('makes practice outcomes and the original session visible without claiming mastery', () => {
    const profile = reduceProfile([{ id: 'r1', at: '2026-10-24T00:00:00Z', kind: 'response', projectId: 'p1', sessionKey: 's1', profileRevision: 0, responseId: 'response1', attemptId: 'attempt1', questionId: 'q1', questionVersion: 1, conceptIds: ['auth'], target: 'concept_knowledge', questionKind: 'application', format: 'single_choice', questionReview: 'candidate', status: 'answered', assistance: 'unknown', explanationSeen: false, firstAttempt: true, grade: 'correct' }], 'l1');
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(LearningHistory, { state: profile.concepts.auth })));
    expect(html).toContain('연습 정답 1');
    expect(html).toContain('/sessions/s1?tab=understand');
    expect(html).toContain('숙련 인증은 아닙니다');
    expect(profile.concepts.auth?.state).toBe('unknown');
  });
});
