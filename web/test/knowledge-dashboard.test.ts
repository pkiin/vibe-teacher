import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry, MyQuestion, SolvedQuestion } from '@vibe-teacher/shared';
import { KnowledgeDashboard, knowledgeStats } from '../src/components/KnowledgeDashboard';
import { MyQuestionList, SolvedList } from '../src/components/MemoryPanel';
import { unknownConcept } from '../../server/src/learner/reducer';

/** 합성 개념 항목 */
function entry(id: string, state: Partial<KnowledgeEntry['state']> = {}, counts: Partial<KnowledgeEntry['state']['counts']> = {}): KnowledgeEntry {
  const base = unknownConcept(id);
  return { conceptId: id, name: id, category: '보안', summary: '합성 요약', state: { ...base, ...state, counts: { ...base.counts, ...counts } }, reason: '', reasonOrigin: 'llm', sources: [], mentions: [], priority: 'background' };
}

const entries = [
  entry('a', { state: 'demonstrated' }, { correct: 2 }),
  entry('b', { state: 'partial' }, { correct: 1, practiceCorrect: 1 }),
  entry('c', { state: 'partial', disputed: true }, { correct: 1 }),
  entry('d', { state: 'conflicting' }, { correct: 1, incorrect: 2 }),
  entry('e'),
  entry('f'),
];

describe('내 지식 대시보드', () => {
  it('알게 된 개념·맞힌 문제·아직 안 풀어 본 개념을 카드 배지와 같은 기준으로 센다', () => {
    expect(knowledgeStats(entries)).toEqual({ total: 6, learned: 2, demonstrated: 1, partial: 1, solved: 6, untried: 2 });
  });

  it('숫자 타일과 알게 된 개념 막대를 보여 주고 오답 수는 보이지 않는다', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeDashboard, { entries })));
    expect(html).toContain('알게 된 개념');
    expect(html).toContain('문제로 확인 1 · 익히는 중 1');
    expect(html).toContain('전체 6개 개념 중 2개를 알게 됐어요!');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemax="6"[^>]*aria-valuenow="2"/);
    expect(html).not.toContain('오답');
    // 내가 한 질문은 대시보드가 아니라 내 기억 검색에서 본다
    expect(html).not.toContain('내가 한 질문');
    const empty = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeDashboard, { entries: [entry('x')] })));
    expect(empty).toContain('첫 개념부터 익혀 볼까요?');
    expect(empty).not.toContain('meter-fill');
  });

  it('풀어 본 문제는 정답과 해설을 접어 두고, 맞힌 문제만 표시하며 틀린 문제는 따로 표시하지 않는다', () => {
    const solved = (id: string, grade: SolvedQuestion['grade'], feedback?: SolvedQuestion['feedback']): SolvedQuestion => ({ questionId: id, version: 1, conceptIds: ['auth'], conceptNames: ['인증'], kind: 'application', format: 'single_choice',
      prompt: `문제 ${id}`, options: [{ id: 'a', text: '보기 A' }, { id: 'b', text: '보기 B' }], correctOptionIds: ['b'], explanation: '합성 해설', answeredAt: '2026-11-05T00:00:00Z', status: 'answered', grade, ...(feedback ? { feedback } : {}) });
    const html = renderToStaticMarkup(createElement(SolvedList, { questions: [solved('q1', 'correct'), solved('q2', 'incorrect'), solved('q3', 'correct', 'ambiguous')] }));
    expect(html.match(/맞힌 문제/g)).toHaveLength(1);
    expect(html).toContain('이상하다고 알린 문제');
    expect(html).toContain('정답과 해설 보기');
    expect(html).not.toMatch(/오답|틀린/);
  });

  it('최근 질문 5개를 먼저 보여 주고, 개념 질문은 그 개념의 질문 탭으로 다시 연다', () => {
    const q = (i: number, focus: MyQuestion['focus'] = { kind: 'concept', id: 'auth' }): MyQuestion => ({ id: `h${i}`, question: `질문 ${i}`, answer: `답 ${i}`, askedAt: `2026-11-0${i}T00:00:00Z`, projectId: 'p', sessionKey: 's', sessionTitle: '로그인 작업', focus, conceptIds: ['auth'] });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MyQuestionList, { questions: [q(1), q(2), q(3), q(4), q(5), q(6, { kind: 'session' })] })));
    expect(html).toContain('href="/sessions/s/analysis?ask=auth#concept-auth"');
    expect(html).toContain('href="/sessions/s/analysis"');
    expect(html).toContain('1개 더 보기');
    expect(html).toContain('받은 답 다시 보기');
  });
});
