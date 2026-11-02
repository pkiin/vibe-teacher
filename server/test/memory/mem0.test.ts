import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Mem0Backend } from '../../src/memory/mem0';
import { MemoryService } from '../../src/memory/service';
import { LearnerService } from '../../src/learner/service';
import { WikiStorage } from '../../src/storage/store';
import type { MemoryBackend } from '../../src/memory/supermemory';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-mem0-')); directories.push(directory);
  const storage = new WikiStorage(directory);
  return { directory, storage, learner: new LearnerService(storage) };
}
describe('mem0 OSS with PostgreSQL and OpenRouter', () => {
  it('separates destinations, users and embedding models without putting credentials into identities', async () => {
    const { storage } = await fixture();
    const options = { key: 'test-key', model: 'openai/gpt-5-mini', databaseUrl: 'postgresql://alice:private-password@127.0.0.1:55432/memory' };
    const backend = new Mem0Backend(storage, options);
    expect(backend.collectionName('vt-l_alice')).not.toBe(backend.collectionName('vt-l_bob'));
    expect(backend.collectionName('vt-l_alice')).toMatch(/^[a-z_0-9]{1,54}$/);
    expect(() => backend.collectionName('../outside')).toThrow();
    expect(new Mem0Backend(storage, { ...options, databaseUrl: 'postgresql://bob:rotated@127.0.0.1:55432/memory' }).indexKey).toBe(backend.indexKey);
    expect(new Mem0Backend(storage, { ...options, databaseUrl: 'postgresql://alice:private-password@127.0.0.1:55432/other' }).indexKey).not.toBe(backend.indexKey);
    expect(backend.indexKey).not.toContain('private-password');
    expect(new Mem0Backend(storage, { ...options, model: 'other/model' }).indexKey).not.toBe(backend.indexKey);
    expect(new Mem0Backend(storage, { ...options, dimensions: 16 }).indexKey).not.toBe(backend.indexKey);
    expect(() => new Mem0Backend(storage, { ...options, databaseUrl: 'https://user:private-password@example.com/memory' })).toThrow('PostgreSQL');
  });

  it('does not construct SDK clients, call AI or write memory DBs on GET-style reads', async () => {
    const { storage, learner } = await fixture();
    const memory = new MemoryService(storage, learner, { env: { OPENROUTER_API_KEY: 'test-key', VIBE_TEACHER_MEMORY_DATABASE_URL: 'postgresql://alice:private-password@127.0.0.1:55432/memory' } });
    const result = await memory.search('l_alice', { allowedProjectIds: [] }, { query: '' });
    expect(result).toMatchObject({ backend: 'local', total: 0, canSync: true, databaseProvider: 'postgres' });
    const remote = await new MemoryService(storage, learner, { env: { OPENROUTER_API_KEY: 'test-key', VIBE_TEACHER_SUPABASE_DATABASE_URL: 'postgresql://postgres.project:private-password@region.pooler.supabase.com:5432/postgres', VIBE_TEACHER_MEMORY_DATABASE_URL: 'postgresql://local:password@localhost/local' } }).search('l_alice', { allowedProjectIds: [] }, { query: '' });
    expect(remote).toMatchObject({ backend: 'local', databaseProvider: 'supabase', canSync: true });
    await expect(fs.access(path.join(storage.learnerDir('l_alice'), 'memory'))).rejects.toThrow();
    expect((await new MemoryService(storage, learner, { env: {} }).search('l_alice', { allowedProjectIds: [] }, { query: '' })).notices.join()).toContain('OPENROUTER_API_KEY');
    expect((await new MemoryService(storage, learner, { env: { OPENROUTER_API_KEY: 'test-key' } }).search('l_alice', { allowedProjectIds: [] }, { query: '' })).notices.join()).toContain('VIBE_TEACHER_MEMORY_DATABASE_URL');
    const invalid = await new MemoryService(storage, learner, { env: { OPENROUTER_API_KEY: 'test-key', VIBE_TEACHER_MEMORY_DATABASE_URL: 'not-a-url-private-password' } }).search('l_alice', { allowedProjectIds: [] }, { query: '' });
    expect(invalid.canSync).toBe(false);
    expect(JSON.stringify(invalid)).not.toContain('private-password');
  });

  it('indexes POST activities automatically, survives restart, and only returns authorized original records', async () => {
    const { storage, learner } = await fixture();
    for (const projectId of ['p1', 'p2']) await learner.record('l_alice', null, { id: `exposure_${projectId}`, kind: 'exposure', conceptId: 'auth', action: 'open_item', at: '2026-10-24T00:00:00Z', projectId });
    let writes = 0;
    const backend: MemoryBackend = { kind: 'mem0', indexKey: 'test-mem0', add: async (_ns, r) => { writes++; return `remote_${r.id}`; }, search: async () => ['remote_exposure_p2', 'unknown', 'remote_exposure_p1'] };
    const memory = new MemoryService(storage, learner, { backend });
    memory.scheduleSync('l_alice', { allowedProjectIds: ['p1', 'p2'] });
    memory.scheduleSync('l_alice', { allowedProjectIds: ['p1', 'p2'] });
    await memory.idle();
    expect(writes).toBe(2);
    const restarted = new MemoryService(storage, learner, { backend });
    const result = await restarted.search('l_alice', { projectId: 'p1', allowedProjectIds: ['p1', 'p2'] }, { query: 'unmatched semantic query', remote: true });
    expect(result.backend).toBe('mem0');
    expect(result.records.map((r) => r.id)).toEqual(['exposure_p1']);
    await restarted.idle();
    expect(writes).toBe(2);
    expect((await learner.profile('l_alice')).concepts.auth?.state).toBe('unknown');
  });

  it('persists safe background failures for display and keeps the local ledger usable', async () => {
    const { storage, learner } = await fixture();
    await learner.record('l_alice', null, { id: 'view', kind: 'exposure', conceptId: 'auth', action: 'open_item', at: '2026-10-24T00:00:00Z' });
    const backend: MemoryBackend = { kind: 'mem0', add: async () => { throw new Error('private-provider-detail'); }, search: async () => [] };
    const memory = new MemoryService(storage, learner, { backend });
    memory.scheduleSync('l_alice', { allowedProjectIds: [] });
    await memory.idle();
    const result = await new MemoryService(storage, learner, { backend }).search('l_alice', { allowedProjectIds: [] }, { query: '' });
    expect(result.records).toHaveLength(1);
    expect(result.notices.join()).toContain('기억 인덱스 갱신에 실패');
    expect(JSON.stringify(result)).not.toContain('private-provider-detail');
  });
});
