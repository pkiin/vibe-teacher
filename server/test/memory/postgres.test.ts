import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryRecord } from '@vibe-teacher/shared';
import { Mem0Backend } from '../../src/memory/mem0';
import { MemoryService } from '../../src/memory/service';
import { LearnerService } from '../../src/learner/service';
import { WikiStorage } from '../../src/storage/store';
import { MemoryDatabase, checkMemoryDatabase, databaseIdentifier } from '../../src/memory/database';

// 명시한 검사 DB에만 접속한다. OpenRouter 요청은 합성 응답이며 실제 AI 호출은 없다.
const databaseUrl = process.env.VIBE_TEACHER_TEST_DATABASE_URL;
const directories: string[] = [];
const backends: Mem0Backend[] = [];
const collections = new Set<string>();
afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  if (databaseUrl && collections.size) {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      for (const key of collections) {
        const [schema, collection] = key.split(':') as [string, string];
        if (!['public', 'vibe_teacher'].includes(schema)) throw new Error('검사 스키마 이름 오류');
        // 이 검사에서 임의 생성한 이름만 삭제한다.
        if (!/^vt_[a-f0-9]{16}_[a-f0-9]{16}$/.test(collection)) throw new Error('검사 테이블 이름 오류');
        await client.query(`DROP TABLE IF EXISTS ${databaseIdentifier(schema)}."${collection}_entities", ${databaseIdentifier(schema)}."${collection}"`);
      }
    } finally { await client.end(); collections.clear(); }
  }
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-postgres-')); directories.push(directory);
  const storage = new WikiStorage(directory);
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const request: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/embeddings')) {
      return new Response(JSON.stringify({ data: (body.input as string[]).map((_text, index) => ({ index, embedding: [1, 0, 0, 0, 0, 0, 0, 0] })) }));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: ['사용자가 로그인과 권한 검사의 차이를 질문함.'] }) }, finish_reason: 'stop' }] }));
  };
  const createBackend = (databaseSource: 'postgres' | 'supabase' = 'postgres') => {
    const backend = new Mem0Backend(storage, { key: 'test-key', model: 'openai/gpt-5-mini', databaseUrl: databaseUrl!, databaseSource, dimensions: 8, request });
    backends.push(backend);
    for (const user of ['vt-l_alice', 'vt-l_bob']) collections.add(`${backend.schema}:${backend.collectionName(user)}`);
    return backend;
  };
  return { directory, storage, calls, createBackend };
}

describe.skipIf(!databaseUrl)('real PostgreSQL + pgvector persistence', () => {
  it('uses a private schema in Supabase mode and rolls back synthetic connection checks', async () => {
    const { createBackend } = await fixture();
    const backend = createBackend('supabase');
    const id = await backend.add('vt-l_alice', { id: 'private-question', sourceId: 'private-question', kind: 'question', at: '2026-11-03T00:00:00Z', text: '합성 권한 검사 질문', conceptIds: ['auth'] });
    expect(await backend.search('vt-l_alice', '인가', 3)).toContain(id);
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const name = backend.collectionName('vt-l_alice');
      const tables = await client.query<{ private_exists: boolean; public_missing: boolean }>('SELECT to_regclass($1) IS NOT NULL AS private_exists, to_regclass($2) IS NULL AS public_missing', [`vibe_teacher.${name}`, `public.${name}`]);
      expect(tables.rows[0]).toEqual({ private_exists: true, public_missing: true });
    } finally { await client.end(); }
    const result = await checkMemoryDatabase(new MemoryDatabase({ url: databaseUrl!, source: 'supabase' }));
    expect(result).toMatchObject({ source: 'supabase', schema: 'vibe_teacher', vector: true, writeAndSearch: true, apiRolesBlocked: true });
  });

  it('stores without SQLite, restores and deduplicates across restart, isolates users and filters old source versions', async () => {
    const { directory, storage, calls, createBackend } = await fixture();
    const record: MemoryRecord = { id: 'h1', sourceId: 'h1', kind: 'question', at: '2026-10-24T00:00:00Z', text: '사용자의 질문: 로그인과 권한 검사는 어떻게 달라요? sk-abcdefghijklmnopqrstuvwxyz123456', conceptIds: ['auth'] };
    const backend = createBackend();
    const id = await backend.add('vt-l_alice', record);
    expect(calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(calls.every((c) => c.url.startsWith('https://openrouter.ai/api/v1/'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(process.env.MEM0_TELEMETRY).toBe('false');
    expect(process.env.MEM0_DIR).toBe(path.join(storage.root, 'memory-runtime'));
    await backend.close();

    const restarted = createBackend();
    expect(await restarted.add('vt-l_alice', record)).toBe(id);
    expect(calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(await restarted.search('vt-l_alice', '인증과 인가를 구분해 주세요', 5)).toContain(id);
    expect(await restarted.search('vt-l_bob', '인증과 인가를 구분해 주세요', 5)).toEqual([]);
    const changed = { ...record, text: '질문 후 답변이 저장됨' };
    const changedId = await restarted.add('vt-l_alice', changed);
    expect(changedId).not.toBe(id);
    expect(await restarted.search('vt-l_alice', '로그인', 5, [changed])).toEqual([changedId]);
    expect(await restarted.search('vt-l_alice', '로그인', 5, [])).toEqual([]);
    expect((await fs.readdir(directory, { recursive: true })).some((name) => name.endsWith('.db'))).toBe(false);
  });

  it('links PostgreSQL recall to authorized original ledger events after service restart', async () => {
    const { storage, createBackend } = await fixture(), learner = new LearnerService(storage);
    for (const projectId of ['p1', 'p2']) await learner.record('l_alice', null, { id: `view_${projectId}`, kind: 'exposure', conceptId: 'auth', action: 'open_item', at: '2026-10-24T00:00:00Z', projectId });
    const first = new MemoryService(storage, learner, { backend: createBackend() });
    expect((await first.sync('l_alice', { allowedProjectIds: ['p1', 'p2'] })).indexed).toBe(2);
    const restarted = new MemoryService(storage, learner, { backend: createBackend() });
    const result = await restarted.search('l_alice', { projectId: 'p1', allowedProjectIds: ['p1', 'p2'] }, { query: '찾기 위한 전혀 다른 표현', remote: true });
    await restarted.idle();
    expect(result.backend).toBe('mem0');
    expect(result.records.map((r) => r.id)).toEqual(['view_p1']);
    expect((await restarted.sync('l_alice', { allowedProjectIds: ['p1', 'p2'] })).indexed).toBe(0);
    expect((await learner.profile('l_alice')).concepts.auth?.state).toBe('unknown');
  });
});
