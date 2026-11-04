import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { combineProgress, JobProgress } from '../src/components/JobProgress';

describe('진행 표시', () => {
  it('AI와 Supabase 저장을 구분하고 실패에 100%를 표시하지 않는다', () => {
    const html = (phase: 'ai' | 'writing' | 'error') => renderToStaticMarkup(createElement(JobProgress, { busy: true, job: { id: 'a', state: phase === 'error' ? 'error' : 'running', progress: { phase, percent: 55, aiCalls: 1, active: { ai: phase === 'ai' ? 1 : 0, writing: phase === 'writing' ? 1 : 0, reading: 0 }, storage: 'supabase' } } }));
    expect(html('ai')).toContain('AI가 내용을 살펴보고 작성 중');
    expect(html('writing')).toContain('Supabase에 결과와 기록을 저장 중');
    expect(html('error')).toContain('작업을 마치지 못했어요');
    expect(html('error')).not.toContain('100%');
    expect(html('ai')).toContain('aria-live="polite"');
  });

  it('병렬 작업을 하나의 진행률로 합치고 모두 완료된 뒤 100%를 표시한다', () => {
    const done = { id: 'done', state: 'done' as const };
    const running = { id: 'run', state: 'running' as const, progress: { phase: 'ai' as const, percent: 40, aiCalls: 0, active: { ai: 1, reading: 0, writing: 0 } } };
    expect(combineProgress([done, running])).toMatchObject({ percent: 70, phase: 'ai' });
    expect(combineProgress([done, { id: 'other', state: 'done' }])).toMatchObject({ percent: 100, phase: 'done' });
    const html = renderToStaticMarkup(createElement(JobProgress, { job: done }));
    expect(html).toContain('100%'); expect(html).toContain('준비가 끝났어요');
  });
});
