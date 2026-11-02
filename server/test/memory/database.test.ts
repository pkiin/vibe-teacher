import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDatabase, MemoryDatabaseError, databaseIdentifier, memoryDatabaseError, memoryDatabaseSettings } from '../../src/memory/database';

const state = vi.hoisted(() => ({ exposed: false, calls: [] as string[] }));
vi.mock('pg', () => ({ Client: class {
  async connect() {}
  async end() {}
  async query(sql: string) {
    state.calls.push(sql);
    if (sql.includes('pg_extension')) return { rows: [{ schema: 'extensions' }] };
    if (sql.includes("current_setting('search_path')")) return { rows: [{ path: 'vibe_teacher,extensions,public' }] };
    if (sql.includes(' AS exposed')) return { rows: [{ exposed: state.exposed }] };
    if (sql.includes('current_schema()')) return { rows: [{ name: 'vibe_teacher' }] };
    if (sql.includes('to_regtype')) return { rows: [{ vector: 'vector' }] };
    return { rows: [] };
  }
} }));
beforeEach(() => { state.exposed = false; state.calls = []; });
const remote = 'postgresql://postgres.project_a:private-password@aws-0-region.pooler.supabase.com:5432/postgres';

describe('Supabase memory database configuration', () => {
  it('prioritizes the explicitly named Supabase URL over the old local URL and ignores API keys as DB credentials', () => {
    expect(memoryDatabaseSettings({ VIBE_TEACHER_SUPABASE_DATABASE_URL: remote, VIBE_TEACHER_MEMORY_DATABASE_URL: 'postgresql://local/db' })).toEqual({ url: remote, source: 'supabase' });
    expect(memoryDatabaseSettings({ VIBE_TEACHER_MEMORY_DATABASE_URL: 'postgresql://local/db' })).toEqual({ url: 'postgresql://local/db', source: 'postgres' });
    expect(memoryDatabaseSettings({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'private-secret' })).toBeNull();
  });
  it('uses verified TLS and the private schema while retaining explicit certificate configuration', () => {
    const database = new MemoryDatabase({ url: remote, source: 'supabase' });
    const url = new URL(database.connectionString);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('sslrootcert')).toMatch(/supabase-ca\.crt$/);
    expect(url.searchParams.get('options')).toContain('--search_path=vibe_teacher,extensions,public');
    expect(database.schema).toBe('vibe_teacher');
    expect(new URL(new MemoryDatabase({ url: `${remote}?sslrootcert=/custom/ca.crt`, source: 'supabase' }).connectionString).searchParams.get('sslrootcert')).toBe('/custom/ca.crt');
    expect(() => new MemoryDatabase({ url: `${remote}?sslmode=disable`, source: 'supabase' })).toThrow('TLS');
  });
  it('isolates projects on a shared pooler without putting passwords into persistent identities', () => {
    const database = new MemoryDatabase({ url: remote, source: 'supabase' });
    expect(new MemoryDatabase({ url: remote.replace('project_a', 'project_b'), source: 'supabase' }).identity).not.toEqual(database.identity);
    expect(new MemoryDatabase({ url: remote.replace('private-password', 'rotated-secret'), source: 'supabase' }).identity).toEqual(database.identity);
    expect(JSON.stringify(database.identity)).not.toContain('private-password');
  });
  it('retains the existing local PostgreSQL destination identity and rejects a transaction pooler early', () => {
    const local = new MemoryDatabase({ url: 'postgresql://alice:private-password@127.0.0.1:55432/memory', source: 'postgres' });
    expect(local.identity).toEqual(['127.0.0.1', '55432', '/memory']);
    expect(local.schema).toBe('public');
    expect(() => new MemoryDatabase({ url: remote.replace(':5432/', ':6543/'), source: 'supabase' })).toThrow('Session pooler');
    expect(() => new MemoryDatabase({ url: 'https://user:private-password@example.com/db', source: 'supabase' })).toThrow('PostgreSQL');
    expect(() => databaseIdentifier('public; DROP TABLE x')).toThrow();
  });
  it('prepares a private schema without changing existing object permissions', async () => {
    const database = new MemoryDatabase({ url: remote, source: 'supabase' });
    await database.prepare();
    expect(state.calls.some((sql) => sql.includes('CREATE SCHEMA IF NOT EXISTS "vibe_teacher"'))).toBe(true);
    expect(state.calls).toContain('COMMIT');
    expect(state.calls.some((sql) => /\b(?:REVOKE|GRANT)\b|ALTER DEFAULT PRIVILEGES/i.test(sql))).toBe(false);
  });
  it('fails closed on an exposed schema and permits a later retry without altering its permissions', async () => {
    const database = new MemoryDatabase({ url: remote, source: 'supabase' });
    state.exposed = true;
    await expect(database.prepare()).rejects.toThrow('공개 역할');
    expect(state.calls).toContain('ROLLBACK');
    expect(state.calls).not.toContain('COMMIT');
    expect(state.calls.some((sql) => /\b(?:REVOKE|GRANT)\b/i.test(sql))).toBe(false);
    state.exposed = false;
    await database.prepare();
    expect(state.calls).toContain('COMMIT');
  });
  it('reports useful causes without provider text, passwords or connection strings', () => {
    expect(memoryDatabaseError({ code: 'ENETUNREACH', message: remote })).toContain('Session pooler');
    expect(memoryDatabaseError({ code: '28P01', message: remote })).toContain('비밀번호');
    expect(memoryDatabaseError({ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: remote })).toContain('인증서');
    expect(memoryDatabaseError(new Error(remote))).not.toContain('private-password');
    expect(memoryDatabaseError(new MemoryDatabaseError('설정을 확인해 주세요.'))).toBe('설정을 확인해 주세요.');
  });
});
