import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkProgress } from '@vibe-teacher/shared';

type Activity = keyof WorkProgress['active'];
interface Scope { value: WorkProgress; publish: (progress: WorkProgress) => void; pending: Map<symbol, { kind: Activity; storage?: WorkProgress['storage'] }> }
const current = new AsyncLocalStorage<Scope>();

export function withProgress<T>(publish: Scope['publish'], fn: () => Promise<T>): Promise<T> {
  const value: WorkProgress = { phase: 'preparing', percent: 5, aiCalls: 0, active: { reading: 0, writing: 0, ai: 0 } };
  return current.run({ value, publish, pending: new Map() }, async () => { publish(structuredClone(value)); return fn(); });
}

function publish(scope: Scope) { scope.publish(structuredClone(scope.value)); }

/** IO가 실제 시작·종료될 때만 상태를 바꾼다. 병렬 작업의 개수도 보존한다. */
export function beginActivity(kind: Activity, storage?: WorkProgress['storage']): () => void {
  const scope = current.getStore();
  if (!scope) return () => {};
  const id = Symbol();
  scope.pending.set(id, { kind, storage });
  scope.value.active[kind]++;
  scope.value.phase = kind;
  if (storage) scope.value.storage = storage;
  const estimate = kind === 'ai' ? Math.min(80, 35 + scope.value.aiCalls * 8) : kind === 'reading' ? 15 : 20;
  scope.value.percent = Math.max(scope.value.percent, estimate);
  publish(scope);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    scope.pending.delete(id);
    scope.value.active[kind]--;
    if (kind === 'ai') scope.value.aiCalls++;
    const last = [...scope.pending.values()].at(-1);
    scope.value.phase = last?.kind ?? 'preparing';
    if (last?.storage) scope.value.storage = last.storage;
    publish(scope);
  };
}

export function artifactSaved(): void {
  const scope = current.getStore();
  if (!scope) return;
  scope.value.percent = Math.max(scope.value.percent, 95);
  publish(scope);
}
