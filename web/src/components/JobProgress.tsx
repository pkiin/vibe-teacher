import { useRef, type ReactNode } from 'react';
import type { BaseJobStatus, WorkProgress } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

type Job = Pick<BaseJobStatus<unknown>, 'id' | 'state' | 'progress'>;

export function combineProgress(jobs: Job[]): WorkProgress {
  const active = { reading: 0, writing: 0, ai: 0 };
  let aiCalls = 0, percent = 0;
  for (const job of jobs) {
    const progress = job.progress;
    percent += job.state === 'done' ? 100 : progress?.percent ?? 0;
    aiCalls += progress?.aiCalls ?? 0;
    for (const kind of ['reading', 'writing', 'ai'] as const) active[kind] += progress?.active[kind] ?? 0;
  }
  const error = jobs.some((job) => job.state === 'error');
  const cancelled = jobs.some((job) => job.state === 'cancelled');
  const done = !!jobs.length && jobs.every((job) => job.state === 'done');
  const phase = done ? 'done' : active.writing ? 'writing' : active.ai ? 'ai' : active.reading ? 'reading'
    : jobs.some((job) => job.state === 'running') ? 'preparing' : jobs.some((job) => job.state === 'queued') ? 'queued' : error ? 'error' : cancelled ? 'cancelled' : 'preparing';
  return { phase, percent: jobs.length ? Math.floor(percent / jobs.length) : 0, aiCalls, active, storage: jobs.find((job) => job.progress?.storage)?.progress?.storage };
}

/** 같은 흐름의 병렬 작업을 합치고, 완료 표시를 다음 작업 전까지 보존한다. */
export function JobProgress({ job, jobs = job ? [job] : [], busy = false, preparing = false, label, children }: { job?: Job | null; jobs?: (Job | null)[]; busy?: boolean; preparing?: boolean; label?: string; children?: ReactNode }) {
  const history = useRef(new Map<string, Job>());
  const previousBusy = useRef(false);
  const shownPercent = useRef(0);
  if (busy && !previousBusy.current) { history.current.clear(); shownPercent.current = 0; }
  previousBusy.current = busy;
  for (const value of jobs) if (value) history.current.set(value.id, value);
  if (!busy && !history.current.size) return null;
  if (!busy && [...history.current.values()].some((value) => value.state === 'queued' || value.state === 'running')) return null;
  const progress = combineProgress([...history.current.values()]);
  if (preparing) { progress.phase = 'preparing'; progress.percent = Math.min(95, progress.percent); }
  // 두 번째 병렬 작업이 뒤늦게 접수되어도 표시가 뒤로 가지 않는다.
  shownPercent.current = Math.max(shownPercent.current, progress.percent);
  const percent = progress.phase === 'done' ? 100 : Math.min(99, shownPercent.current);
  const failed = progress.phase === 'error' || progress.phase === 'cancelled';
  const text = progress.phase === 'reading' && progress.storage ? progress.storage === 'supabase' ? ko.work.cloudRead : ko.work.localRead
    : progress.phase === 'writing' && progress.storage ? progress.storage === 'supabase' ? ko.work.cloudWrite : ko.work.localWrite : ko.work.phases[progress.phase];
  const step = progress.phase === 'done' ? 3 : progress.phase === 'writing' && percent >= 90 ? 2 : progress.aiCalls || progress.phase === 'ai' ? 1 : 0;
  return <div className={`work-progress${failed ? ' work-failed' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="work-heading"><strong>{progress.phase === 'done' ? ko.work.phases.done : label ?? ko.work.title}</strong><span className="work-percent">{percent}%</span></div>
    <p>{text}</p>
    <progress max={100} value={percent} aria-label={label ?? ko.work.title} />
    <ol className="work-steps" aria-hidden="true">{ko.work.steps.map((name, index) => <li key={name} className={index <= step ? 'work-step-reached' : ''}>{name}</li>)}</ol>
    <div className="work-footer"><span className="small muted">{progress.phase === 'done' || failed ? text : ko.work.cheer}{progress.aiCalls > 0 ? ` · ${ko.work.calls(progress.aiCalls)}` : ''}</span>{children}</div>
    {busy && !failed && progress.phase !== 'done' && <p className="small muted work-estimate">{ko.work.estimate}</p>}
  </div>;
}
