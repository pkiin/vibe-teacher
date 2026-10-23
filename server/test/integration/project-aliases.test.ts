import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIKI_AI_PROMPT_VERSION, type Project, type RepoWikiResponse, type WikiAiLayer } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { codexAdapter } from '../../src/adapters/codex/index';
import { AnalysisService } from '../../src/analyzers/index';
import { createApp } from '../../src/app';
import { AuthService } from '../../src/auth/service';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { accountIdFor } from '../../src/index/accounts';
import { normalizeRoot, projectIdFor } from '../../src/index/project-id';
import { SessionIndex } from '../../src/index/session-index';
import { learnerIdFor } from '../../src/learner/service';
import { EnrichService } from '../../src/llm/service';
import { scanRepo } from '../../src/repo/scan';
import { buildRepoWiki } from '../../src/repo/wiki';
import { WikiStorage } from '../../src/storage/store';
import { createWikiServices } from '../../src/wiki/service';
import { fakeAi } from '../wiki/helpers';

describe('같은 실제 폴더의 프로젝트 통합', () => {
  let tmp: string;
  let root: string;
  let alias: string;
  let alice: string;
  let home: string;
  let canonicalId: string;
  let legacyId: string;
  let index: SessionIndex;
  let app: ReturnType<typeof createApp>;
  let store: ConfigStore;
  let enrich: EnrichService;
  let services: ReturnType<typeof createWikiServices>;
  let legacy: ReturnType<typeof createWikiServices>;
  const analysis = new AnalysisService();
  const claude = { ...claudeCodeAdapter, scan: vi.fn(claudeCodeAdapter.scan) };

  async function write(file: string, data: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  async function claudeSession(owner: string, id: string, cwd: string) {
    await write(path.join(owner, '.claude', 'projects', 'demo', `${id}.jsonl`), JSON.stringify({
      type: 'user', uuid: id, sessionId: id, cwd, timestamp: '2026-09-01T10:00:00.000Z',
      message: { role: 'user', content: 'React 앱의 환경 변수를 설명해 줘' },
    }) + '\n');
  }

  const project = () => index.getProject(canonicalId)!;
  const session = () => index.loadSession(index.getSessions(canonicalId).find((s) => s.provider === 'claude-code')!.key);

  beforeEach(async () => {
    claude.scan.mockClear();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-project-alias-'));
    root = path.join(tmp, 'repos', 'demo');
    await write(path.join(root, 'README.md'), '# Demo\n\n프로젝트 통합 테스트 앱입니다.\n');
    await fs.symlink(path.join(tmp, 'repos'), path.join(tmp, 'linked-repos'), 'dir');
    alias = path.join(tmp, 'linked-repos', 'demo');
    alice = path.join(tmp, 'accounts', 'alice');
    await claudeSession(alice, 'claude-1', alias);
    await write(path.join(alice, '.codex', 'sessions', 'rollout-codex-1.jsonl'), [
      { type: 'session_meta', payload: { id: 'codex-1', cwd: root, timestamp: '2026-09-01T11:00:00.000Z', source: 'cli' } },
      { type: 'event_msg', timestamp: '2026-09-01T11:00:01.000Z', payload: { type: 'user_message', message: '환경 변수를 설명해 줘' } },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
    await claudeSession(path.join(tmp, 'accounts', 'bob'), 'bob-1', root);
    home = path.join(tmp, 'state');
    const paths = resolvePaths(home);
    store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => { c.scan = { mode: 'all', homes: [], homeRoots: [path.join(tmp, 'accounts')] }; });
    index = new SessionIndex({ adapters: [claude, codexAdapter], store, cacheDir: paths.indexCacheDir, hiddenRoot: home, currentHome: alice, env: {} });
    await index.rescan();
    canonicalId = projectIdFor(accountIdFor(alice), root);
    legacyId = projectIdFor(accountIdFor(alice), alias);
    enrich = new EnrichService({ store, paths, providerOverride: fakeAi });
    services = createWikiServices(home, store, () => enrich.resolveProvider(), (id) => index.getProjectIds(id));
    legacy = createWikiServices(home, store, () => enrich.resolveProvider());
    const auth = new AuthService({ store, paths, index, serviceUser: 'alice', bearerToken: null, isLoopback: true });
    app = createApp({ deps: { store, paths, index, analysis, enrich, auth, ...services, version: 'test' }, quiet: true });
  });

  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('도구가 달라도 한 프로젝트로 집계하고 예전 링크·세션 상세에서 대표 ID를 쓴다', async () => {
    expect(index.getProjects(accountIdFor(alice))).toEqual([expect.objectContaining({ id: canonicalId, rootPath: root, sessionCount: 2 })]);
    expect(project().providers.sort()).toEqual(['claude-code', 'codex']);
    expect(index.getAccount(accountIdFor(alice))?.projectCount).toBe(1);
    expect(index.getProject(legacyId)).toBe(project());
    expect(index.getProjectIds(legacyId)).toEqual([canonicalId, legacyId]);
    expect((await session())?.projectRoot).toBe(root);
    expect((await session())?.projectId).toBe(canonicalId);
    const res = await app.request(`/api/projects/${legacyId}`);
    expect(res.status).toBe(200);
    expect((await res.json() as Project).id).toBe(canonicalId);
    const sessions = await (await app.request(`/api/projects/${legacyId}/sessions`)).json() as { projectId: string }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.projectId === canonicalId)).toBe(true);
  });

  it('캐시를 다시 읽고 서버를 새로 만들어도 경로 별칭을 보존한다', async () => {
    const scans = claude.scan.mock.calls.length;
    const restarted = new SessionIndex({ adapters: [claude, codexAdapter], store, cacheDir: resolvePaths(home).indexCacheDir, hiddenRoot: home, currentHome: alice, env: {} });
    await restarted.rescan();
    expect(claude.scan).toHaveBeenCalledTimes(scans);
    expect(restarted.getProject(legacyId)?.id).toBe(canonicalId);
    expect(restarted.getSessions(canonicalId)).toHaveLength(2);
  });

  it('이름만 같은 다른 폴더와 다른 계정은 합치지 않고 알 수 없는 경로도 유지한다', async () => {
    const other = path.join(tmp, 'other', 'demo');
    await fs.mkdir(other, { recursive: true });
    await claudeSession(alice, 'different', other);
    await claudeSession(alice, 'missing', path.join(tmp, 'missing', 'demo'));
    await claudeSession(alice, 'unknown', '(unknown)');
    await index.rescan();
    expect(index.getProjects(accountIdFor(alice))).toHaveLength(4);
    expect(index.getProjects(accountIdFor(path.join(tmp, 'accounts', 'bob')))).toHaveLength(1);
    expect(index.getSessions(canonicalId)).toHaveLength(2);
    expect(normalizeRoot('(unknown)')).toBe('(unknown)');
    expect(index.getProject(projectIdFor(accountIdFor(alice), '(unknown)'))?.exists).toBe(false);
    const auth = new AuthService({ store, paths: resolvePaths(home), index, serviceUser: 'svc', bearerToken: null, isLoopback: true });
    expect(auth.canAccessAccount({ username: 'bob', isAdmin: false, via: 'cookie' }, index.getProject(legacyId)!.accountId)).toBe(false);
  });

  it('기록 파일이 그대로여도 심볼릭 링크의 대상 변경을 재스캔에 반영한다', async () => {
    await session();
    const other = path.join(tmp, 'other', 'demo');
    await fs.mkdir(other, { recursive: true });
    await fs.unlink(path.join(tmp, 'linked-repos'));
    await fs.symlink(path.dirname(other), path.join(tmp, 'linked-repos'), 'dir');
    await index.rescan();
    const movedId = projectIdFor(accountIdFor(alice), other);
    expect(index.getProject(legacyId)?.id).toBe(movedId);
    const moved = index.getSessions(movedId)[0]!;
    expect((await index.loadSession(moved.key))?.projectId).toBe(movedId);
    expect(index.getSessions(canonicalId)).toHaveLength(1);
  });

  it('양쪽 세션 위키·AI 설명·판 이력을 보존하며 새 쓰기는 대표 폴더에 저장한다', async () => {
    const s = (await session())!;
    const oldSession = { ...s, projectId: legacyId, projectRoot: alias };
    const parts = await analysis.analyze(s);
    const old = await legacy.wiki.build(oldSession, parts);
    const ai: WikiAiLayer = { schemaVersion: 1, snapshotRevision: old.revision, rulesVersion: old.generator.rulesVersion, promptVersion: WIKI_AI_PROMPT_VERSION, provider: 'openai', createdAt: old.builtAt, durationMs: 1, narratives: [], claims: [], evidence: [], items: [], proposedConcepts: [], rejected: [] };
    const storage = new WikiStorage(home);
    await storage.writeJson(path.join(storage.projectDir(legacyId), 'ai', `${old.revision}.non-dev.json`), ai);
    expect((await services.wiki.current(canonicalId, s.key))?.projectId).toBe(canonicalId);
    expect(await services.wikiAi.layer(canonicalId, old.revision)).toEqual(ai);
    const next = await services.wiki.build({ ...s, fileMtime: s.fileMtime + 1 }, parts);
    expect((await services.wiki.history(canonicalId, s.key)).map((h) => h.revision)).toEqual([old.revision, next.revision]);
    expect((await services.wiki.current(canonicalId, s.key))?.revision).toBe(next.revision);
    expect((await legacy.wiki.current(legacyId, s.key))?.revision).toBe(old.revision);
    const codex = index.getSessions(canonicalId).find((x) => x.provider === 'codex')!;
    const cs = (await index.loadSession(codex.key))!;
    await legacy.wiki.build(cs, await analysis.analyze(cs));
    expect(await services.wiki.current(canonicalId, cs.key)).not.toBeNull();
    const response = await app.request(`/api/me/knowledge?projectId=${legacyId}`);
    expect(response.status).toBe(200);
    expect((await response.json() as { totalSessions: number }).totalSessions).toBe(2);
  });

  it('예전 질문을 조회·재시도하고 대표 폴더의 후속 기록을 우선한다', async () => {
    const s = (await session())!;
    const { built, concepts: hits } = await analysis.analyze(s);
    const learnerId = learnerIdFor('alice');
    const req = { sessionKey: s.key, requestId: 'request_123', question: '환경 변수는 무엇인가요?', focus: { kind: 'session' as const } };
    const old = await legacy.help.ask({ learnerId, projectId: legacyId, session: s, built, hits, req, allowed: { ok: false } });
    expect(await services.help.messages(learnerId, canonicalId, s.key)).toEqual([old]);
    expect((await services.help.ask({ learnerId, projectId: canonicalId, session: s, built, hits, req, allowed: { ok: false } })).id).toBe(old.id);
    const storage = new WikiStorage(home);
    await storage.appendJsonl(path.join(storage.learnerProjectDir(learnerId, canonicalId), 'help.jsonl'), { ...old, question: '후속 상태' });
    expect((await services.help.messages(learnerId, canonicalId, s.key))[0]?.question).toBe('후속 상태');
    expect(await services.help.messages(learnerIdFor('bob'), canonicalId, s.key)).toEqual([]);
  });

  it('최신 레포 위키와 양쪽 갱신 이력을 읽고 새 판에 통합 세션을 반영한다', async () => {
    const scan = await scanRepo(root);
    const draft = buildRepoWiki({ project: { id: legacyId, name: 'demo', rootPath: alias }, scan, sessions: [], previous: null });
    const storage = new WikiStorage(home);
    for (const [id, revision, builtAt] of [[canonicalId, 'older', '2026-09-01T10:00:00Z'], [legacyId, 'newer', '2026-09-02T10:00:00Z']]) {
      const dir = path.join(storage.projectDir(id!), 'repo');
      await storage.writeJson(path.join(dir, 'current.json'), { ...draft, projectId: id, revision, builtAt });
      await storage.writeJson(path.join(dir, 'history.json'), [{ revision, builtAt, changes: ['이전 기록'], sessions: 0 }]);
    }
    const get = async () => await (await app.request(`/api/projects/${legacyId}/repo-wiki`)).json() as RepoWikiResponse;
    const before = await get();
    expect(before.wiki).toMatchObject({ revision: 'newer', projectId: canonicalId, rootPath: root });
    expect(before.history.map((h) => h.revision)).toEqual(['newer', 'older']);
    expect(before.stale).toBe(true);
    const res = await app.request(`/api/projects/${legacyId}/repo-wiki/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(202);
    const started = await res.json() as { jobId: string };
    for (let i = 0; i < 100; i++) {
      const job = await (await app.request(`/api/projects/${canonicalId}/repo-wiki/jobs/${started.jobId}`)).json() as { state: string };
      if (job.state === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const after = await get();
    expect(after.wiki?.inputs.sessions).toHaveLength(2);
    expect(after.history.map((h) => h.revision)).toEqual([after.wiki!.revision, 'newer', 'older']);
    expect(after.stale).toBe(false);
    const old = await storage.readJson<{ revision: string }>(path.join(storage.projectDir(legacyId), 'repo', 'current.json'));
    expect(old?.revision).toBe('newer');
  });
});
