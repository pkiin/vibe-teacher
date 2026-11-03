import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CloudClient } from './client';
import { CloudError } from './client';
import type { StorageBackend } from '../storage/store';

/** 모든 키는 wiki 루트의 상대 경로다. user_id는 검증한 인증 주체에서만 받는다. */
export class CloudStorage implements StorageBackend {
  constructor(readonly client: CloudClient, readonly userId: string, private readonly root: string) {}

  private key(file: string): string {
    const key = path.relative(this.root, file).split(path.sep).join('/');
    if (!key || key.startsWith('../') || path.isAbsolute(key)) throw new Error('저장소 범위를 벗어난 경로입니다');
    return key;
  }

  async readJson<T>(file: string): Promise<T | null> {
    const query = new URLSearchParams({ select: 'value', user_id: `eq.${this.userId}`, key: `eq.${this.key(file)}` });
    const rows = await this.client.call<{ value: T }[]>(`/rest/v1/vt_documents?${query}`);
    return rows[0]?.value ?? null;
  }

  async writeJson(file: string, value: unknown): Promise<void> {
    await this.client.call('/rest/v1/vt_documents?on_conflict=user_id,key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: this.userId, key: this.key(file), value }),
    });
  }

  async appendJsonl(file: string, value: unknown): Promise<void> {
    await this.client.call('/rest/v1/vt_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: this.userId, key: this.key(file), value }) });
  }

  async readJsonl<T>(file: string): Promise<{ items: T[]; warnings: string[] }> {
    const items: T[] = [];
    let after = '0';
    for (;;) {
      const query = new URLSearchParams({ select: 'seq,value', user_id: `eq.${this.userId}`, key: `eq.${this.key(file)}`, seq: `gt.${after}`, order: 'seq.asc', limit: '500' });
      const rows = await this.client.call<{ seq: string | number; value: T }[]>(`/rest/v1/vt_events?${query}`);
      items.push(...rows.map((r) => r.value));
      if (rows.length < 500) break;
      after = String(rows.at(-1)!.seq);
    }
    return { items, warnings: [] };
  }

  async lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const acquired = await this.client.rpc<boolean>('vt_lock', { lock_key: key, lock_token: token });
    if (!acquired) throw new CloudError(409, 'revision_conflict', '다른 기기에서 저장 중입니다. 잠시 후 다시 시도하세요');
    try { return await fn(); }
    finally { await this.client.rpc('vt_unlock', { lock_key: key, lock_token: token }); }
  }
}
