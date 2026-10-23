import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssessmentResult, AssessmentStartResponse, LearnerProfile, Project, SessionSummary, UnderstandingResponse, WikiResponse } from '@vibe-teacher/shared';
import { allAdapters } from '../../src/adapters/registry';
import { AnalysisService } from '../../src/analyzers/index';
import { createApp } from '../../src/app';
import { AuthService } from '../../src/auth/service';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { SessionIndex } from '../../src/index/session-index';
import { EnrichService } from '../../src/llm/service';
import { createWikiServices } from '../../src/wiki/service';

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

async function writeToken(home: string, token: string) {
  await fs.mkdir(path.join(home, '.vibe-teacher'), { recursive: true });
  const f = path.join(home, '.vibe-teacher', 'login-token');
  await fs.writeFile(f, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}

describe('wiki / understanding / assessment API', () => {
  let tmp: string;
  let app: ReturnType<typeof createApp>;
  const ALICE = 'alice-token-0123456789abcdef';
  const BOB = 'bob-token-0123456789abcdef';
  const MASTER = { authorization: 'Bearer master' };
  const json = { 'content-type': 'application/json' };

  const login = async (username: string, token: string) => {
    const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, token }), headers: json });
    return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  };
  const sessionOf = async (username: string) => {
    const projects = (await (await app.request('/api/projects', { headers: MASTER })).json()) as Project[];
    const accounts = (await (await app.request('/api/accounts', { headers: MASTER })).json()) as { id: string; username: string }[];
    const acc = accounts.find((a) => a.username === username)!;
    const project = projects.find((p) => p.accountId === acc.id)!;
    const sessions = (await (await app.request(`/api/projects/${project.id}/sessions`, { headers: MASTER })).json()) as SessionSummary[];
    return { project, session: sessions[0]!, key: encodeURIComponent(sessions[0]!.key) };
  };
  const post = (url: string, headers: Record<string, string>, body: unknown) => app.request(url, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) });

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-wiki-api-'));
    const homes = path.join(tmp, 'home');
    await copyDir(path.join(FIX, 'claude'), path.join(homes, 'alice', '.claude', 'projects', '-home-tester-myapp'));
    await copyDir(path.join(FIX, 'codex'), path.join(homes, 'bob', '.codex'));
    await fs.mkdir(path.join(homes, 'svc'), { recursive: true });
    await writeToken(path.join(homes, 'alice'), ALICE);
    await writeToken(path.join(homes, 'bob'), BOB);
    const paths = resolvePaths(path.join(tmp, 'state'));
    const store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => {
      c.scan = { mode: 'all', homes: [], homeRoots: [homes] };
      c.auth = { mode: 'home-token', admins: ['bob'], sessionTtlHours: 1, enrichFor: 'admins' };
    });
    const index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: path.join(homes, 'svc'), env: {} });
    const auth = new AuthService({ store, paths, index, serviceUser: 'svc', bearerToken: 'master', isLoopback: true });
    await auth.init();
    const enrich = new EnrichService({ store, paths, providerOverride: null });
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService('/home/tester'), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
    await index.rescan();
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('builds and reads a session wiki in the browser flow (T29)', async () => {
    const h = await login('alice', ALICE);
    const { key, session } = await sessionOf('alice');
    const missing = await app.request(`/api/sessions/${key}/wiki`, { headers: h });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('wiki_not_built');
    expect((await app.request(`/api/sessions/${key}/wiki/build`, { method: 'POST', headers: h })).status).toBe(415);
    const built = await post(`/api/sessions/${key}/wiki/build`, h, {});
    expect(built.status).toBe(200);
    const wiki = (await built.json()) as WikiResponse;
    expect(wiki.snapshot.sessionKey).toBe(session.key);
    expect(wiki.plan.personalized).toBe(true);
    expect(wiki.snapshot.generator.kind).toBe('rule-based');
    const again = (await (await app.request(`/api/sessions/${key}/wiki`, { headers: h })).json()) as WikiResponse;
    expect(again.stale).toBe(false);
    expect(again.snapshot.revision).toBe(wiki.snapshot.revision);
    // 기존 세션 API 는 그대로 동작한다
    expect((await app.request(`/api/sessions/${key}/user-messages`, { headers: h })).status).toBe(200);
  });

  it('refuses other accounts\' sessions and projects (T32)', async () => {
    const h = await login('alice', ALICE);
    const bob = await sessionOf('bob');
    const alice = await sessionOf('alice');
    expect((await post(`/api/sessions/${bob.key}/wiki/build`, h, {})).status).toBe(404);
    expect((await app.request(`/api/projects/${bob.project.id}/understanding`, { headers: h })).status).toBe(404);
    expect((await app.request(`/api/projects/${bob.project.id}/repo-wiki/source?path=README.md`, { headers: h })).status).toBe(404);
    expect((await post(`/api/projects/${alice.project.id}/assessments`, h, { sessionKey: bob.session.key, conceptId: 'auth' })).status).toBe(404);
  });

  it('hides answers until submission, grades on the server and keeps candidates as practice (T37, T38)', async () => {
    const h = await login('alice', ALICE);
    const { project, session } = await sessionOf('alice');
    const startRes = await post(`/api/projects/${project.id}/assessments`, h, { sessionKey: session.key, conceptId: 'authorization', learnerId: 'l_someone_else' });
    expect(startRes.status).toBe(200);
    const raw = await startRes.text();
    expect(raw).not.toContain('correctOptionIds');
    const start = JSON.parse(raw) as AssessmentStartResponse;
    expect(start.question.options.length).toBeGreaterThanOrEqual(2);

    const stale = await post(`/api/projects/${project.id}/assessments/${start.assessmentId}/responses`, h, { baseRevision: 99, status: 'answered', selectedOptionId: 'x' });
    expect(stale.status).toBe(409);
    const ok = await post(`/api/projects/${project.id}/assessments/${start.assessmentId}/responses`, h, { baseRevision: start.profileRevision, status: 'answered', selectedOptionId: start.question.options[1]!.id });
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as AssessmentResult;
    expect(result.correctOptionIds).toHaveLength(1);
    expect(result.explanation.length).toBeGreaterThan(5);
    expect(result.counted).toBe(false);
    expect(result.scopeNote).toContain('검토 전 문항');
    expect(result.profile.concepts.authorization?.state ?? 'unknown').toBe('unknown');
    // 같은 응답 재전송은 한 번만 기록된다
    const retry = (await (await post(`/api/projects/${project.id}/assessments/${start.assessmentId}/responses`, h, { baseRevision: start.profileRevision, status: 'answered', selectedOptionId: 'o' })).json()) as AssessmentResult;
    expect(retry.profile.revision).toBe(result.profile.revision);
    const u = (await (await app.request(`/api/projects/${project.id}/understanding`, { headers: h })).json()) as UnderstandingResponse;
    expect(u.events.filter((e) => e.kind === 'response')).toHaveLength(1);
  });

  it('applies feedback with revision checks and rejects malformed input (T25)', async () => {
    const h = await login('alice', ALICE);
    const { project } = await sessionOf('alice');
    const cur = ((await (await app.request(`/api/projects/${project.id}/understanding`, { headers: h })).json()) as UnderstandingResponse).profile;
    const first = await post(`/api/projects/${project.id}/understanding/feedback`, h, { baseRevision: cur.revision, requestId: 'req-00000001', event: { kind: 'self_report', conceptId: 'auth', value: 'unsure' } });
    expect(first.status).toBe(200);
    const after = ((await first.json()) as { profile: LearnerProfile }).profile;
    expect(after.revision).toBe(cur.revision + 1);
    expect(after.concepts.auth?.selfReport).toBe('unsure');
    expect((await post(`/api/projects/${project.id}/understanding/feedback`, h, { baseRevision: cur.revision, event: { kind: 'self_report', conceptId: 'auth', value: 'known' } })).status).toBe(409);
    expect((await post(`/api/projects/${project.id}/understanding/feedback`, h, { baseRevision: after.revision, event: { kind: 'self_report', conceptId: '../x', value: 'known' } })).status).toBe(422);
    const exposure = await post(`/api/projects/${project.id}/understanding/feedback`, h, { baseRevision: 0, event: { kind: 'exposure', action: 'deeper', conceptId: 'auth' } });
    expect(exposure.status).toBe(200);
  });

  it('keeps each person\'s understanding private even for admins', async () => {
    const bob = await login('bob', BOB);
    const { project, key } = await sessionOf('alice');
    expect((await app.request(`/api/sessions/${key}/wiki`, { headers: bob })).status).toBe(200);
    const u = (await (await app.request(`/api/projects/${project.id}/understanding`, { headers: bob })).json()) as UnderstandingResponse;
    expect(u.profile.revision).toBe(0);
    expect(u.events).toEqual([]);
  });
});
