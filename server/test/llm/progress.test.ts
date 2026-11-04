import { describe, expect, it } from 'vitest';
import type { WorkProgress } from '@vibe-teacher/shared';
import { beginActivity, artifactSaved } from '../../src/lib/progress';
import { JobQueue } from '../../src/llm/jobs';

function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }

describe('실제 작업 단계 진행률', () => {
  it('병렬 읽기·AI·저장을 구분하고 저장 완료 전에는 100%가 되지 않는다', async () => {
    const queue = new JobQueue<void>(), states: WorkProgress[] = [];
    queue.on('update', (job) => { if (job.progress) states.push(structuredClone(job.progress)); });
    const ai = gate(), save = gate(), writing = gate();
    const job = queue.enqueue('one', async () => {
      const read1 = beginActivity('reading', 'supabase'), read2 = beginActivity('reading', 'supabase');
      read1(); read2();
      const endAi = beginActivity('ai'); await ai.promise; endAi();
      const endWrite = beginActivity('writing', 'supabase'); writing.release(); await save.promise; endWrite(); artifactSaved();
    });
    expect(job.progress?.phase).toBe('ai');
    ai.release(); await writing.promise;
    expect(job.progress?.phase).toBe('writing');
    expect(job.state).toBe('running'); expect(job.progress!.percent).toBeLessThan(100);
    const done = new Promise<void>((resolve) => queue.on('update', (value) => { if (value.state === 'done') resolve(); }));
    save.release(); await done;
    expect(job.progress).toMatchObject({ phase: 'done', percent: 100, aiCalls: 1, active: { reading: 0, writing: 0, ai: 0 } });
    expect(states.some((state) => state.active.reading === 2)).toBe(true);
    expect(states.every((state, n) => !n || state.percent >= states[n - 1]!.percent)).toBe(true);
  });

  it('취소·저장 실패는 완료로 표시하지 않고 사용자 작업끼리 상태가 섞이지 않는다', async () => {
    const first = new JobQueue<void>(), second = new JobQueue<void>();
    const waiting = gate();
    const a = first.enqueue('a', async (signal) => { const end = beginActivity('ai'); await waiting.promise; end(); signal.throwIfAborted(); });
    const b = second.enqueue('b', async () => { const end = beginActivity('writing', 'supabase'); await waiting.promise; end(); throw new Error('합성 저장 오류'); });
    expect(a.progress?.phase).toBe('ai'); expect(b.progress?.phase).toBe('writing');
    first.cancel(a.id);
    const done = Promise.all([first, second].map((queue) => new Promise<void>((resolve) => queue.on('update', (job) => { if (job.state === 'error' || job.state === 'cancelled') resolve(); }))));
    waiting.release(); await done;
    expect(a.state).toBe('cancelled'); expect(b.state).toBe('error');
    expect(a.progress!.percent).toBeLessThan(100); expect(b.progress!.percent).toBeLessThan(100);
  });
});
