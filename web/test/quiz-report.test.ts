import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionReport, reportReady } from '../src/components/QuizCard';
import type { LearnerActions } from '../src/hooks/useLearner';

describe('문제 신고', () => {
  it('처음에는 신고 버튼만 보이고, 누르기 전에는 신고 창을 그리지 않는다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const html = renderToStaticMarkup(createElement(QuestionReport, { questionId: 'q1', version: 1, prompt: '토큰은 어디에 두나요?', learner }));
    expect(html).toMatch(/<button[^>]*class="btn btn-small quiz-report-trigger"[^>]*aria-haspopup="dialog"[^>]*aria-label="이 문제 신고하기"/);
    expect(html).toContain('신고</button>');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('어떤 점이 이상했나요');
  });

  it('사유를 골라야 제출할 수 있고, 기타는 이유를 적어야 한다', () => {
    expect(reportReady(null, '이상해요')).toBe(false);
    expect(reportReady('ambiguous', '')).toBe(true);
    expect(reportReady('other', '   ')).toBe(false);
    expect(reportReady('other', '보기가 두 개 다 맞아요')).toBe(true);
  });
});
