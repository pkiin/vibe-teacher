import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HelpMessage } from '@vibe-teacher/shared';
import { LearnerService } from '../../src/learner/service';
import { MemoryService } from '../../src/memory/service';
import { SupermemoryBackend, type MemoryBackend } from '../../src/memory/supermemory';
import { WikiStorage } from '../../src/storage/store';
import { KnowledgeService } from '../../src/learner/knowledge-service';
import { AnalysisService } from '../../src/analyzers/index';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import type { SessionIndex } from '../../src/index/session-index';
import type { WikiService } from '../../src/wiki/service';
import { caseA, snapshotOf } from '../wiki/helpers';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-memory-')); dirs.push(dir);
  const storage = new WikiStorage(dir), learner = new LearnerService(storage);
  await learner.record('l_alice', 0, { id: 'preference1', at: '2026-10-01T00:00:00Z', kind: 'preference', conceptId: 'auth', depth: 'D2', examples: true });
  for (const projectId of ['p1', 'p2']) {
    const message: HelpMessage = { id: `h_${projectId}`, threadId: `t_${projectId}`, requestId: `req_${projectId}`, sessionKey: `s_${projectId}`, focus: { kind: 'concept', id: 'auth' }, question: `${projectId} 권한 검사와 로그인 차이를 알려 주세요.`, askedAt: '2026-10-02T00:00:00Z', status: 'done', notices: [], answer: { answer: '당시 AI 설명', projectConnection: '', claimIds: [], generalNote: '', unverified: [], followUps: [], conceptIds: ['auth'] } };
    await storage.appendJsonl(path.join(storage.learnerProjectDir('l_alice', projectId), 'help.jsonl'), message);
  }
  return { dir, storage, learner };
}
describe('source-linked long-term memory', () => {
  it('recalls across sessions after restart, isolates users and projects and retains explicit preferences', async () => {
    const { dir } = await fixture();
    const storage = new WikiStorage(dir), learner = new LearnerService(storage), memory = new MemoryService(storage, learner, { env: {} });
    const result = await memory.search('l_alice', { projectId: 'p1', allowedProjectIds: ['p1', 'p2'] }, { query: '로그인', conceptIds: ['auth'], sessionKey: 'new-session' });
    expect(result.records.map((r) => r.id)).toEqual(expect.arrayContaining(['h_p1', 'preference1']));
    expect(result.records.some((r) => r.projectId === 'p2')).toBe(false);
    expect((await memory.search('l_bob', { allowedProjectIds: ['p1', 'p2'] }, { query: '' })).records).toEqual([]);
    expect((await learner.profile('l_alice')).concepts.auth?.teaching).toMatchObject({ depth: 'D2', reason: 'preference' });
  });

  it('has no recent-session limit and masks secrets in stored conversation excerpts', async () => {
    const { storage, learner } = await fixture();
    for (let i = 0; i < 55; i++) {
      await storage.appendJsonl(path.join(storage.learnerProjectDir('l_alice', 'p1'), 'help.jsonl'), { id: `old_${i}`, question: `찾을내용${i} sk-abcdefghijklmnopqrstuvwxyz123456`, askedAt: '2025-01-01T00:00:00Z', sessionKey: `old_${i}`, focus: { kind: 'session' }, status: 'error', notices: [] });
    }
    const result = await new MemoryService(storage, learner, { env: {} }).search('l_alice', { allowedProjectIds: ['p1'] }, { query: '찾을내용0', limit: 60 });
    expect(result.total).toBe(57);
    expect(result.records.some((r) => r.id === 'old_0')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('prefers the canonical conversation over an older copy under a project alias', async () => {
    const { storage, learner } = await fixture();
    await storage.appendJsonl(path.join(storage.learnerProjectDir('l_alice', 'p_legacy'), 'help.jsonl'), { id: 'h_p1', question: '이전 질문 사본', askedAt: '2026-10-01T00:00:00Z', sessionKey: 's_p1', focus: { kind: 'concept', id: 'auth' }, status: 'error', notices: [] });
    const memory = new MemoryService(storage, learner, { env: {}, projectIds: (id) => id === 'p1' ? ['p1', 'p_legacy'] : [id] });
    const result = await memory.search('l_alice', { projectId: 'p1', allowedProjectIds: ['p1'] }, { query: '로그인' });
    expect(result.records.find((r) => r.id === 'h_p1')?.text).toContain('당시 AI 설명');
    expect(result.records.find((r) => r.id === 'h_p1')?.projectId).toBe('p1');
  });

  it('persists remote document mappings, dedupes indexing and rejects remote results outside the local scope', async () => {
    const { storage, learner } = await fixture();
    let writes = 0;
    const backend: MemoryBackend = { add: async (_ns, record) => { writes++; return `remote_${record.id}`; }, search: async () => ['foreign_doc', 'remote_h_p2', 'remote_h_p1'] };
    const memory = new MemoryService(storage, learner, { backend });
    expect((await memory.sync('l_alice', { allowedProjectIds: ['p1', 'p2'] })).indexed).toBe(3);
    const restarted = new MemoryService(storage, learner, { backend });
    expect((await restarted.sync('l_alice', { allowedProjectIds: ['p1', 'p2'] })).indexed).toBe(0);
    expect(writes).toBe(3);
    const recalled = await restarted.search('l_alice', { projectId: 'p1', allowedProjectIds: ['p1', 'p2'] }, { query: '권한', remote: true });
    expect(recalled.backend).toBe('supermemory');
    expect(recalled.records.map((r) => r.id)).toEqual(['h_p1']);
    expect(recalled.records.every((r) => r.projectId !== 'p2')).toBe(true);
  });

  it('makes remote outages visible while continuing to use durable local memory', async () => {
    const { storage, learner } = await fixture();
    const backend: MemoryBackend = { add: async () => { throw new Error('secret provider error'); }, search: async () => { throw new Error('secret provider error'); } };
    const memory = new MemoryService(storage, learner, { backend });
    const result = await memory.search('l_alice', { allowedProjectIds: ['p1'] }, { query: '로그인', remote: true });
    expect(result.backend).toBe('local');
    expect(result.records[0]?.id).toBe('h_p1');
    expect(result.notices[0]).toContain('로컬');
    expect(JSON.stringify(result)).not.toContain('secret provider error');
    expect((await memory.sync('l_alice', { allowedProjectIds: ['p1'] })).remaining).toBe(2);
  });

  it('keeps interacted concepts beyond 40 sessions and reports session activity separately from global knowledge', async () => {
    const { learner } = await fixture();
    const base = caseA(), concept = snapshotOf(base).concepts!.find((c) => c.id === 'authorization')!;
    const sessions = Array.from({ length: 45 }, (_, i) => ({ ...base, key: `session${i}`, endedAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString() }));
    await learner.rememberConcepts('l_alice', [concept], { projectId: base.projectId, sessionKey: 'session0' });
    await learner.record('l_alice', 1, { id: 'self-old', kind: 'self_report', conceptId: concept.id, value: 'known', at: '2026-09-01T00:00:00Z', projectId: base.projectId, sessionKey: 'session0' });
    await learner.record('l_alice', 2, { id: 'self-recent', kind: 'self_report', conceptId: concept.id, value: 'unsure', at: '2026-10-20T00:00:00Z', projectId: base.projectId, sessionKey: 'session44' });
    const project = { id: base.projectId, accountId: base.accountId, name: '프로젝트' };
    const index = { getAccounts: () => [{ id: base.accountId, username: 'alice' }], getProjects: () => [project], getProject: () => project, getSessions: () => sessions, loadSession: async (key: string) => sessions.find((s) => s.key === key) } as unknown as SessionIndex;
    const wiki = { current: async () => null, catalog: () => loadWikiCatalog() } as unknown as WikiService;
    const service = new KnowledgeService({ index, wiki, learner, analysis: new AnalysisService() });
    const all = await service.wiki({ username: 'alice', learnerId: 'l_alice' });
    expect(all.scannedSessions).toBe(40);
    expect(all.entries.find((e) => e.conceptId === concept.id)?.sources[0]?.sessionKey).toBe('session0');
    const scoped = await service.wiki({ username: 'alice', learnerId: 'l_alice', session: sessions[0]! });
    expect(scoped.entries.find((e) => e.conceptId === concept.id)?.scope?.state.selfReport).toBe('known');
    expect(scoped.entries.find((e) => e.conceptId === concept.id)?.state.selfReport).toBe('unsure');
    // 원래 위키에서 개념이 빠져도 개인 기록의 정의와 출처로 다시 연결한다.
    expect(scoped.entries.some((e) => e.conceptId === concept.id)).toBe(true);
  });
});

describe('Supermemory HTTP contract', () => {
  it('uses documented document endpoints with a user namespace and returns IDs rather than generated evaluations', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const request: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify(String(input).endsWith('/v3/search') ? { results: [{ documentId: 'doc1', content: 'untrusted inferred mastery' }] } : { id: 'doc1' }), { status: 200 });
    };
    const backend = new SupermemoryBackend('test-key', request);
    await backend.add('vt-l_alice', { id: 'h1', sourceId: 'h1', at: '2026-10-24T00:00:00Z', kind: 'question', text: '로그인 질문', conceptIds: ['auth'] });
    expect(await backend.search('vt-l_alice', '로그인', 5)).toEqual(['doc1']);
    expect(calls[0]).toMatchObject({ url: 'https://api.supermemory.ai/v3/documents', auth: 'Bearer test-key', body: { containerTag: 'vt-l_alice', metadata: { sourceId: 'h1' } } });
    expect(calls[1]).toMatchObject({ url: 'https://api.supermemory.ai/v3/search', body: { q: '로그인', containerTags: ['vt-l_alice'] } });
  });
});
