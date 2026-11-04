import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BaseJobStatus, EnrichmentRecord } from '@vibe-teacher/shared';
import { withProgress } from '../lib/progress';

interface JobInternal<R> {
  status: BaseJobStatus<R>;
  run: (signal: AbortSignal) => Promise<R>;
  controller: AbortController;
}

/** 동시성 1 짜리 작업 큐 (작업 종류마다 하나씩). 이후 SSE 를 붙일 수 있도록 EventEmitter 를 노출한다. */
export class JobQueue<R = EnrichmentRecord> extends EventEmitter {
  private jobs = new Map<string, JobInternal<R>>();
  private queue: string[] = [];
  private running: string | null = null;

  enqueue(sessionKey: string, run: (signal: AbortSignal) => Promise<R>): BaseJobStatus<R> {
    const existing = this.findActive(sessionKey);
    if (existing) return existing;
    const id = randomUUID();
    const status: BaseJobStatus<R> = { id, sessionKey, state: 'queued', createdAt: new Date().toISOString(), progress: { phase: 'queued', percent: 0, aiCalls: 0, active: { reading: 0, writing: 0, ai: 0 } } };
    this.jobs.set(id, { status, run, controller: new AbortController() });
    this.queue.push(id);
    this.prune();
    void this.pump();
    return status;
  }

  findActive(sessionKey: string): BaseJobStatus<R> | undefined {
    for (const j of this.jobs.values()) {
      if (j.status.sessionKey === sessionKey && (j.status.state === 'queued' || j.status.state === 'running')) return j.status;
    }
    return undefined;
  }

  get(id: string): BaseJobStatus<R> | undefined {
    return this.jobs.get(id)?.status;
  }

  cancel(id: string): BaseJobStatus<R> | undefined {
    const j = this.jobs.get(id);
    if (!j) return undefined;
    if (j.status.state === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      j.status.state = 'cancelled';
      if (j.status.progress) j.status.progress.phase = 'cancelled';
      j.status.finishedAt = new Date().toISOString();
      this.emit('update', j.status);
    } else if (j.status.state === 'running') {
      j.controller.abort();
    }
    return j.status;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    const j = this.jobs.get(id);
    if (!j) return void this.pump();
    this.running = id;
    j.status.state = 'running';
    j.status.startedAt = new Date().toISOString();
    this.emit('update', j.status);
    const started = Date.now();
    try {
      const result = await withProgress((progress) => {
        if (j.status.state !== 'running') return;
        j.status.progress = progress;
        this.emit('update', j.status);
      }, () => j.run(j.controller.signal));
      j.controller.signal.throwIfAborted();
      j.status.state = 'done';
      j.status.result = result;
    } catch (err) {
      const e = err as { kind?: string; message?: string; detail?: string };
      j.status.state = j.controller.signal.aborted ? 'cancelled' : 'error';
      j.status.error = { kind: e.kind ?? 'unknown', message: e.message ?? String(err), detail: e.detail };
    } finally {
      if (j.status.progress) {
        j.status.progress.phase = j.status.state === 'done' ? 'done' : j.status.state === 'cancelled' ? 'cancelled' : 'error';
        if (j.status.state === 'done') j.status.progress.percent = 100;
        j.status.progress.active = { reading: 0, writing: 0, ai: 0 };
      }
      j.status.finishedAt = new Date().toISOString();
      j.status.durationMs = Date.now() - started;
      this.running = null;
      this.emit('update', j.status);
      void this.pump();
    }
  }

  private prune(): void {
    const finished = Array.from(this.jobs.values()).filter((j) => j.status.state !== 'queued' && j.status.state !== 'running');
    if (finished.length <= 50) return;
    finished
      .sort((a, b) => (a.status.finishedAt ?? '').localeCompare(b.status.finishedAt ?? ''))
      .slice(0, finished.length - 50)
      .forEach((j) => this.jobs.delete(j.status.id));
  }
}
