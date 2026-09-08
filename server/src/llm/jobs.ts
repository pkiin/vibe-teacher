import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { EnrichmentRecord, JobStatus } from '@vibe-teacher/shared';

interface JobInternal {
  status: JobStatus;
  run: (signal: AbortSignal) => Promise<EnrichmentRecord>;
  controller: AbortController;
}

/** 동시성 1 짜리 작업 큐. 이후 SSE 를 붙일 수 있도록 EventEmitter 를 노출한다. */
export class JobQueue extends EventEmitter {
  private jobs = new Map<string, JobInternal>();
  private queue: string[] = [];
  private running: string | null = null;

  enqueue(sessionKey: string, run: (signal: AbortSignal) => Promise<EnrichmentRecord>): JobStatus {
    const existing = this.findActive(sessionKey);
    if (existing) return existing;
    const id = randomUUID();
    const status: JobStatus = { id, sessionKey, state: 'queued', createdAt: new Date().toISOString() };
    this.jobs.set(id, { status, run, controller: new AbortController() });
    this.queue.push(id);
    this.prune();
    void this.pump();
    return status;
  }

  findActive(sessionKey: string): JobStatus | undefined {
    for (const j of this.jobs.values()) {
      if (j.status.sessionKey === sessionKey && (j.status.state === 'queued' || j.status.state === 'running')) return j.status;
    }
    return undefined;
  }

  get(id: string): JobStatus | undefined {
    return this.jobs.get(id)?.status;
  }

  cancel(id: string): JobStatus | undefined {
    const j = this.jobs.get(id);
    if (!j) return undefined;
    if (j.status.state === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      j.status.state = 'cancelled';
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
      const result = await j.run(j.controller.signal);
      j.status.state = 'done';
      j.status.result = result;
    } catch (err) {
      const e = err as { kind?: string; message?: string; detail?: string };
      j.status.state = j.controller.signal.aborted ? 'cancelled' : 'error';
      j.status.error = { kind: e.kind ?? 'unknown', message: e.message ?? String(err), detail: e.detail };
    } finally {
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
