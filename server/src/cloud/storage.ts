import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CloudClient } from './client';
import { CloudError } from './client';
import type { StorageBackend } from '../storage/store';
import { CloudAiLog } from './ai-log';
import type { StorageActivityResponse } from '@vibe-teacher/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mapConcurrent } from '../lib/concurrent';
import { beginActivity } from '../lib/progress';

interface Read { key: string; promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }
interface Cached { value: unknown; until: number; bytes: number }
const CACHE_TTL = 5_000;
const CACHE_BYTES = 8 * 1024 * 1024;
// PostgREST의 문자열 값: 따옴표와 역슬래시를 반드시 이스케이프한다.
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** 모든 키는 wiki 루트의 상대 경로다. user_id는 검증한 인증 주체에서만 받는다. */
export class CloudStorage implements StorageBackend {
  /** 같은 클라이언트를 써서 토큰 갱신이 기록에도 반영된다. */
  readonly aiLog: CloudAiLog;
  private readonly cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private readonly pending = new Map<string, Read>();
  private reads: Read[] = [];
  private scheduled = false;
  private readonly locked = new AsyncLocalStorage<boolean>();
  private readonly counters = { hits: 0, coalesced: 0, batches: 0 };
  private readonly eventReads = new Map<string, Promise<{ items: unknown[]; warnings: string[] }>>();

  constructor(readonly client: CloudClient, readonly userId: string, private readonly root: string) {
    this.aiLog = new CloudAiLog(client, userId);
  }

  private key(file: string): string {
    const key = path.relative(this.root, file).split(path.sep).join('/');
    if (!key || key === '..' || key.startsWith('../') || path.isAbsolute(key)) throw new Error('저장소 범위를 벗어난 경로입니다');
    return key;
  }

  private forget(key: string): void {
    const old = this.cache.get(key);
    if (old) this.cacheBytes -= old.bytes;
    this.cache.delete(key);
    this.pending.delete(key);
  }

  private remember(key: string, value: unknown): void {
    this.forget(key);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > CACHE_BYTES) return;
    this.cache.set(key, { value: structuredClone(value), until: Date.now() + CACHE_TTL, bytes });
    this.cacheBytes += bytes;
    while (this.cache.size > 256 || this.cacheBytes > CACHE_BYTES) this.forget(this.cache.keys().next().value!);
  }

  private invalidate(): void {
    // 추가 전용 원장의 과거 prefix는 재사용하되 이후 행은 반드시 서버에서 확인한다.
    for (const [key, entry] of this.cache) {
      if (key.startsWith('events\0')) entry.until = 0;
      else this.forget(key);
    }
    this.pending.clear();
    this.eventReads.clear();
  }

  async readJson<T>(file: string): Promise<T | null> {
    const key = this.key(file);
    const cached = this.cache.get(key);
    if (!this.locked.getStore() && cached && cached.until > Date.now()) {
      this.counters.hits++;
      return structuredClone(cached.value) as T | null;
    }
    let pending = this.locked.getStore() ? undefined : this.pending.get(key);
    if (pending) this.counters.coalesced++;
    else {
      const entry = { key } as Read;
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      pending = entry;
      this.pending.set(key, entry);
      this.reads.push(entry);
      if (!this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => { void this.flushReads(); });
      }
    }
    const end = beginActivity('reading', 'supabase');
    try { return structuredClone(await pending.promise) as T | null; }
    finally { end(); }
  }

  private async flushReads(): Promise<void> {
    this.scheduled = false;
    const entries = this.reads.splice(0);
    // URL 길이를 제한한다. 서로 다른 키의 동시 읽기는 한 SELECT로 모은다.
    const batches: Read[][] = [];
    let batch: Read[] = [];
    let length = 0;
    for (const entry of entries) {
      const size = encodeURIComponent(quoted(entry.key)).length;
      if (batch.length && (batch.length >= 40 || length + size > 6000)) { batches.push(batch); batch = []; length = 0; }
      batch.push(entry); length += size;
    }
    if (batch.length) batches.push(batch);
    await mapConcurrent(batches, 4, async (items) => {
      try {
        const keys = [...new Set(items.map((item) => item.key))];
        const query = new URLSearchParams({ select: keys.length === 1 ? 'value' : 'key,value', user_id: `eq.${this.userId}`,
          key: keys.length === 1 ? `eq.${keys[0]}` : `in.(${keys.map(quoted).join(',')})` });
        this.counters.batches++;
        const rows = await this.client.call<{ key?: string; value: unknown }[]>(`/rest/v1/vt_documents?${query}`);
        const byKey = new Map(rows.map((row) => [row.key ?? keys[0]!, row.value]));
        for (const entry of items) {
          const value = byKey.get(entry.key) ?? null;
          if (this.pending.get(entry.key) === entry) this.remember(entry.key, value);
          entry.resolve(value);
        }
      } catch (error) {
        for (const entry of items) { if (this.pending.get(entry.key) === entry) this.pending.delete(entry.key); entry.reject(error); }
      }
    });
  }

  writeJson(file: string, value: unknown): Promise<void> { return this.writeJsonBatch([{ file, value }]); }

  async writeJsonBatch(entries: { file: string; value: unknown }[]): Promise<void> {
    if (!entries.length) return;
    const rows = entries.map(({ file, value }) => ({ user_id: this.userId, key: this.key(file), value }));
    // 쓰는 도중의 읽기가 이전 응답을 캐시에 되살리지 못하게 전후로 비운다.
    for (const row of rows) this.forget(row.key);
    try {
      await this.client.call('/rest/v1/vt_documents?on_conflict=user_id,key', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.length === 1 ? rows[0] : rows),
      });
    } finally { for (const row of rows) this.forget(row.key); }
  }

  activity(): StorageActivityResponse {
    return { mode: 'supabase', since: this.client.since, tables: this.client.stats(), cache: { ...this.counters, entries: this.cache.size } };
  }

  async appendJsonl(file: string, value: unknown): Promise<void> {
    const key = this.key(file);
    const expire = () => {
      const cached = this.cache.get(`events\0${key}`);
      if (cached) cached.until = 0;
      this.eventReads.delete(key);
    };
    expire();
    try { await this.client.call('/rest/v1/vt_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: this.userId, key, value }) }); }
    finally { expire(); }
  }

  async readJsonl<T>(file: string): Promise<{ items: T[]; warnings: string[] }> {
    const key = this.key(file);
    const cached = this.cache.get(`events\0${key}`);
    if (!this.locked.getStore() && cached && cached.until > Date.now()) {
      this.counters.hits++;
      const { items } = structuredClone(cached.value) as { items: T[] };
      return { items, warnings: [] };
    }
    let pending = this.locked.getStore() ? undefined : this.eventReads.get(key);
    if (pending) this.counters.coalesced++;
    else {
      const previous = cached?.value as { items: unknown[]; after: string } | undefined;
      const request = this.loadEvents(key, previous).then((result) => {
        if (this.eventReads.get(key) === request) this.remember(`events\0${key}`, result);
        return { items: result.items, warnings: [] };
      }).finally(() => { if (this.eventReads.get(key) === request) this.eventReads.delete(key); });
      pending = request;
      this.eventReads.set(key, request);
    }
    return structuredClone(await pending) as { items: T[]; warnings: string[] };
  }

  private async loadEvents(key: string, previous?: { items: unknown[]; after: string }): Promise<{ items: unknown[]; after: string }> {
    const items = [...(previous?.items ?? [])];
    let after = previous?.after ?? '0';
    for (;;) {
      const query = new URLSearchParams({ select: 'seq,value', user_id: `eq.${this.userId}`, key: `eq.${key}`, seq: `gt.${after}`, order: 'seq.asc', limit: '500' });
      const rows = await this.client.call<{ seq: string | number; value: unknown }[]>(`/rest/v1/vt_events?${query}`);
      items.push(...rows.map((r) => r.value));
      if (rows.length) after = String(rows.at(-1)!.seq);
      if (rows.length < 500) break;
    }
    return { items, after };
  }

  async lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const acquired = await this.client.rpc<boolean>('vt_lock', { lock_key: key, lock_token: token });
    if (!acquired) throw new CloudError(409, 'revision_conflict', '다른 기기에서 저장 중입니다. 잠시 후 다시 시도하세요');
    // 다른 기기가 갱신했을 수 있으므로 수정용 읽기는 TTL·진행 중 읽기를 재사용하지 않는다.
    this.invalidate();
    try { return await this.locked.run(true, fn); }
    finally { this.invalidate(); await this.client.rpc('vt_unlock', { lock_key: key, lock_token: token }); }
  }
}
