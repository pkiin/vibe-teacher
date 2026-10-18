import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account, AccountSummaryResponse, BuiltSummary, ConceptHit, Project, SessionSummary, SourceStatus, UserMessagesResult } from '@vibe-teacher/shared';
import { allAdapters } from '../../src/adapters/registry';
import { AnalysisService } from '../../src/analyzers/index';
import { createApp } from '../../src/app';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { SessionIndex } from '../../src/index/session-index';
import { EnrichService } from '../../src/llm/service';
import { createWikiServices } from '../../src/wiki/service';
import { AuthService } from '../../src/auth/service';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures');

async function copyDir(src: string, dst: string) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

describe('multi-account discovery through the HTTP app', () => {
  let tmp: string;
  let app: ReturnType<typeof createApp>;
  let index: SessionIndex;
  const headers = { authorization: 'Bearer secret' };

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-int-'));
    const homes = path.join(tmp, 'home');
    // alice: Claude Code, bob: Codex + Copilot CLI, carol: 권한 없음, dave: VS Code Copilot
    await copyDir(path.join(FIX, 'claude'), path.join(homes, 'alice', '.claude', 'projects', '-home-tester-myapp'));
    await fs.rename(path.join(homes, 'alice', '.claude', 'projects', '-home-tester-myapp', 'dot-claude.json'), path.join(homes, 'alice', '.claude.json'));
    await copyDir(path.join(FIX, 'codex'), path.join(homes, 'bob', '.codex'));
    await copyDir(path.join(FIX, 'copilot-cli'), path.join(homes, 'bob', '.copilot'));
    await fs.mkdir(path.join(homes, 'carol', '.claude', 'projects'), { recursive: true });
    await fs.chmod(path.join(homes, 'carol'), 0o000);
    await copyDir(path.join(FIX, 'copilot-vscode'), path.join(homes, 'dave', '.config', 'Code', 'User', 'workspaceStorage'));

    const paths = resolvePaths(path.join(tmp, 'state'));
    const store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => {
      c.scan = { mode: 'all', homes: [], homeRoots: [homes] };
    });
    index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: path.join(homes, 'alice'), env: {} });
    const enrich = new EnrichService({ store, paths, providerOverride: null });
    const auth = new AuthService({ store, paths, index, serviceUser: 'svc', bearerToken: 'secret', isLoopback: false });
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService('/home/tester'), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
  });

  afterAll(async () => {
    if (process.getuid?.() !== 0) await fs.chmod(path.join(tmp, 'home', 'carol'), 0o755).catch(() => {});
  });

  it('rejects requests without the token when one is configured', async () => {
    const res = await app.request('/api/accounts');
    expect(res.status).toBe(401);
  });

  it('lists accounts with readability and never writes into scanned homes', async () => {
    const res = await app.request('/api/accounts', { headers });
    const accounts = (await res.json()) as Account[];
    const byName = Object.fromEntries(accounts.map((a) => [a.username, a]));
    expect(Object.keys(byName).sort()).toEqual(['alice', 'bob', 'carol', 'dave']);
    expect(byName.alice?.isCurrent).toBe(true);
    if (process.getuid?.() !== 0) expect(byName.carol?.readable).toBe('denied');
    expect(byName.alice?.sessionCount).toBe(1);
    expect(byName.bob?.sessionCount).toBe(2);
    expect(byName.dave?.sessionCount).toBe(1);
    const stateFiles = await fs.readdir(path.join(tmp, 'state', 'cache', 'index'));
    expect(stateFiles.length).toBeGreaterThan(0);
    const aliceFiles = await fs.readdir(path.join(tmp, 'home', 'alice'));
    expect(aliceFiles.sort()).toEqual(['.claude', '.claude.json']);
  });

  it('reports sources per provider with status notes', async () => {
    const res = await app.request('/api/sources', { headers });
    const sources = (await res.json()) as SourceStatus[];
    const claude = sources.find((s) => s.provider === 'claude-code' && s.sessionCount > 0);
    expect(claude?.exists).toBe(true);
    const codex = sources.find((s) => s.provider === 'codex' && s.exists);
    expect(codex?.sessionCount).toBe(1);
    expect(sources.some((s) => s.note === '없음')).toBe(true);
  });

  it('walks account → projects → sessions → analyses', async () => {
    const accounts = (await (await app.request('/api/accounts', { headers })).json()) as Account[];
    const alice = accounts.find((a) => a.username === 'alice')!;
    const projects = (await (await app.request(`/api/accounts/${alice.id}/projects`, { headers })).json()) as Project[];
    expect(projects).toHaveLength(1);
    expect(projects[0]?.rootPath).toBe('/home/tester/myapp');
    const sessions = (await (await app.request(`/api/projects/${projects[0]!.id}/sessions`, { headers })).json()) as SessionSummary[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe('마지막 제목');
    expect(sessions[0]?.counts.human).toBe(4);
    const key = encodeURIComponent(sessions[0]!.key);
    const um = (await (await app.request(`/api/sessions/${key}/user-messages`, { headers })).json()) as UserMessagesResult;
    expect(um.items).toHaveLength(5);
    const built = (await (await app.request(`/api/sessions/${key}/built`, { headers })).json()) as BuiltSummary;
    expect(built.filesCreated.map((f) => f.relPath)).toContain('web/.env.sample');
    const concepts = (await (await app.request(`/api/sessions/${key}/concepts`, { headers })).json()) as ConceptHit[];
    expect(concepts.map((c) => c.id)).toContain('env-variables');
    const summary = (await (await app.request(`/api/accounts/${alice.id}/summary`, { headers })).json()) as AccountSummaryResponse;
    expect(summary.totals.sessions).toBe(1);
    expect(summary.projects[0]?.commits).toBe(1);
    const enrich = await app.request(`/api/sessions/${key}/enrich`, { method: 'POST', headers });
    expect(enrich.status).toBe(409);
    const bad = await app.request(`/api/sessions/${encodeURIComponent(Buffer.from('claude-code\0/etc/passwd').toString('base64url'))}`, { headers });
    expect(bad.status).toBe(404);
  });

  it('reuses the index cache on rescan', async () => {
    const first = await index.rescan();
    const second = await index.rescan();
    expect(second.sessions).toBe(first.sessions);
    const res = await app.request('/api/rescan', { method: 'POST', headers });
    expect(res.status).toBe(200);
  });
});
