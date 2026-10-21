import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BaseJobStatus, KnowledgeEntry, KnowledgeWikiResponse, Project, ReaderPrefs, RepoWikiBuildResponse, RepoWikiResponse } from '@vibe-teacher/shared';
import { allAdapters } from '../../src/adapters/registry';
import { AnalysisService } from '../../src/analyzers/index';
import { createApp } from '../../src/app';
import { AuthService } from '../../src/auth/service';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { SessionIndex } from '../../src/index/session-index';
import { acceptKnowledgeText, entryFingerprint } from '../../src/learner/knowledge-text';
import { unknownConcept } from '../../src/learner/reducer';
import { textGate } from '../../src/llm/gate';
import { withReader } from '../../src/llm/reader';
import { EnrichService } from '../../src/llm/service';
import type { LlmProvider, LlmRequest, LlmResult } from '../../src/llm/types';
import { LlmError } from '../../src/llm/types';
import { createWikiServices } from '../../src/wiki/service';

/** 요청 종류(schemaName)에 따라 그럴듯한 결과를 돌려주는 가짜 제공자. 실제 AI 는 부르지 않는다 */
function fakeProvider() {
  const state = { calls: [] as string[], systems: [] as string[], fail: false };
  const provider: LlmProvider = {
    id: 'anthropic-sdk',
    availability: async () => ({ ok: true }),
    complete: async <T,>(req: LlmRequest<T>): Promise<LlmResult<T>> => {
      state.calls.push(req.schemaName);
      state.systems.push(req.system);
      if (state.fail) throw new LlmError('network', '연결이 끊겼습니다');
      let data: unknown;
      if (req.schemaName === 'repo_wiki_text') {
        data = {
          sections: [
            { id: 'overview', paragraphs: ['이 저장소는 관리자 화면을 만드는 작업을 기록한 프로젝트입니다. 키 sk-abcdefghijklmnopqrstuvwxyz1234 는 숨겨야 합니다.'], items: [] },
            { id: 'history', paragraphs: [], items: [{ text: '관리자 화면을 추가했습니다', detail: '', sources: ['S1', 'F:does/not/exist.ts'] }] },
          ],
        };
      } else if (req.schemaName === 'knowledge_texts') {
        const ids = [...req.user.matchAll(/--- (K\d+) ---/g)].map((m) => m[1]!);
        data = { texts: ids.map((id, i) => ({ id, text: i === 0 ? '이 개념은 모르십니다.' : `${id} 작업에서 이 개념이 함께 쓰였습니다. 아직 확인할 응답은 없습니다.` })) };
      } else {
        throw new Error(`unexpected ${req.schemaName}`);
      }
      return { data: data as T, provider: 'anthropic-sdk', model: 'fake-model', durationMs: 5 };
    },
  };
  return { provider, state };
}

describe('textGate', () => {
  const resolved = (provider: LlmProvider | null) => async () => ({ provider, status: { resolvedProvider: provider?.id ?? ('none' as const), available: !!provider, ...(provider ? {} : { reason: '제공자 없음' }) } });
  const store = (autoText: boolean) => ({ get: () => ({ llm: { autoText } }) }) as unknown as ConfigStore;
  const { provider } = fakeProvider();

  it('uses AI unless it is turned off, not permitted or unavailable — and says why', async () => {
    expect(await textGate({ store: store(true), resolveProvider: resolved(provider), allowed: { ok: true } })).toMatchObject({ ok: true });
    expect(await textGate({ store: store(false), resolveProvider: resolved(provider), allowed: { ok: true } })).toEqual({ ok: false, reason: '설정에서 AI 문장 만들기를 꺼 두었습니다' });
    expect(await textGate({ store: store(true), resolveProvider: resolved(provider), allowed: { ok: false, reason: '관리자만' } })).toEqual({ ok: false, reason: '관리자만' });
    expect(await textGate({ store: store(true), resolveProvider: resolved(null), allowed: { ok: true } })).toEqual({ ok: false, reason: '제공자 없음' });
  });
});

describe('knowledge text checks', () => {
  const entry = (over: Partial<KnowledgeEntry['state']> = {}): KnowledgeEntry => ({
    conceptId: 'authorization',
    name: '권한 검사 (인가)',
    category: '보안',
    summary: '누가 무엇을 할 수 있는지 서버가 확인하는 것',
    state: { ...unknownConcept('authorization'), ...over },
    reason: '',
    sources: [{ sessionKey: 's', sessionTitle: '회원가입 기능 구현', projectId: 'p', projectName: 'app', via: 'finding', refTitle: '접근 권한 검사 위치 미확인', request: '로그인 기능 만들어 줘' }],
    mentions: [],
    priority: 'check',
  });

  it('rejects sentences that overstate what the record shows', () => {
    expect(acceptKnowledgeText(entry(), '로그인 기능을 만들면서 권한 검사가 함께 바뀌었습니다. 아직 확인할 응답은 없습니다.')).toContain('권한 검사');
    expect(acceptKnowledgeText(entry(), '권한 검사를 모르십니다.')).toBeNull();
    expect(acceptKnowledgeText(entry(), '권한 검사를 잘 알고 계십니다.')).toBeNull();
    expect(acceptKnowledgeText(entry({ state: 'demonstrated' }), '문항 범위에서 이해하고 계십니다.')).not.toBeNull();
    expect(acceptKnowledgeText(entry(), '짧음')).toBeNull();
  });

  it('changes the fingerprint when the facts or the reader level change, so the sentence is rewritten', () => {
    expect(entryFingerprint(entry())).toBe(entryFingerprint(entry()));
    expect(entryFingerprint(entry({ selfReport: 'known' }))).not.toBe(entryFingerprint(entry()));
    expect(entryFingerprint(entry(), 'senior')).not.toBe(entryFingerprint(entry()));
    expect(entryFingerprint(entry(), 'non-dev')).toBe(entryFingerprint(entry()));
  });
});

describe('reader guide', () => {
  it('appends level-specific wording rules below the task rules, defaulting to a non-developer', () => {
    expect(withReader('규칙')).toContain('읽는 사람: 개발을 전혀 모르는 사람(비개발자)');
    expect(withReader('규칙', 'beginner')).toContain('입문 개발자');
    expect(withReader('규칙', 'senior').startsWith('규칙')).toBe(true);
    expect(withReader('규칙', 'junior')).toContain('이 문체 지침보다 우선합니다');
  });
});

describe('AI-first text over the API', () => {
  let tmp: string;
  let app: ReturnType<typeof createApp>;
  let store: ConfigStore;
  let project: Project;
  const fake = fakeProvider();
  const json = { 'content-type': 'application/json' };

  const waitJob = async (url: string) => {
    for (let i = 0; i < 100; i += 1) {
      const job = (await (await app.request(url)).json()) as BaseJobStatus<unknown>;
      if (job.state !== 'queued' && job.state !== 'running') return job;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('job did not finish');
  };
  const repoPost = async (path: string, body: unknown = {}) => {
    const res = await app.request(`/api/projects/${project.id}/repo-wiki/${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    const out = (await res.json()) as RepoWikiBuildResponse;
    if (out.status !== 'done') await waitJob(`/api/projects/${project.id}/repo-wiki/jobs/${out.jobId}`);
    const view = (await (await app.request(`/api/projects/${project.id}/repo-wiki`)).json()) as RepoWikiResponse;
    return { status: res.status, wiki: view.wiki!, text: view.text! };
  };
  const buildRepo = () => repoPost('build');
  const setLevel = (readerLevel: string) => app.request('/api/me/prefs', { method: 'PUT', headers: json, body: JSON.stringify({ readerLevel }) });

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-ai-first-'));
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = path.join(tmp, 'home', os.userInfo().username);
    const dir = path.join(home, '.claude', 'projects', '-home-tester-myapp');
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(here, '../fixtures/claude/sess-1.jsonl'), path.join(dir, 'sess-1.jsonl'));
    const paths = resolvePaths(path.join(tmp, 'state'));
    store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => {
      c.scan = { mode: 'all', homes: [], homeRoots: [path.join(tmp, 'home')] };
    });
    const index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: home, env: {} });
    const auth = new AuthService({ store, paths, index, serviceUser: os.userInfo().username, bearerToken: null, isLoopback: true });
    await auth.init();
    const enrich = new EnrichService({ store, paths, providerOverride: fake.provider });
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService('/home/tester'), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
    await index.rescan();
    project = ((await (await app.request('/api/projects')).json()) as Project[])[0]!;
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('writes the repo wiki with AI, keeps only known sources and masks secrets', async () => {
    const { status, wiki } = await buildRepo();
    expect(status).toBe(202);
    expect(wiki.generator).toMatchObject({ kind: 'llm', provider: 'anthropic-sdk', model: 'fake-model' });
    const overview = wiki.user.find((s) => s.id === 'overview')!;
    expect(overview.origin).toBe('llm');
    expect(JSON.stringify(overview.blocks)).toContain('관리자 화면을 만드는 작업');
    expect(JSON.stringify(wiki)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234');
    const history = wiki.user.find((s) => s.id === 'history')!;
    const item = history.blocks.find((b) => b.kind === 'list');
    expect(item?.kind === 'list' && item.items[0]?.sources).toEqual([expect.objectContaining({ kind: 'session' })]);
    expect(wiki.warnings.join(' ')).toContain('자료에 없는 1개');
    // AI 가 다루지 않은 절은 규칙 문장으로 남고 그렇게 표시된다
    expect(wiki.system.every((s) => s.origin === 'rule')).toBe(true);
  });

  it('does not call AI again for the same input', async () => {
    const before = fake.state.calls.length;
    const { status, wiki } = await buildRepo();
    expect(status).toBe(200);
    expect(fake.state.calls.length).toBe(before);
    expect(wiki.generator.kind).toBe('llm');
  });

  it('writes the text separately for each reader level, using the reader guide', async () => {
    // 기본(비개발자) 지침으로 썼다
    const firstSystem = fake.state.systems[0]!;
    expect(firstSystem).toContain('읽는 사람: 개발을 전혀 모르는 사람');
    expect((await (await app.request('/api/me/prefs')).json()) as ReaderPrefs).toEqual({ readerLevel: 'non-dev', chosen: false });

    expect(((await (await app.request('/api/auth/me')).json()) as { reader: ReaderPrefs }).reader).toEqual({ readerLevel: 'non-dev', chosen: false });
    expect((await setLevel('senior')).status).toBe(200);
    expect(((await (await app.request('/api/auth/me')).json()) as { reader: ReaderPrefs }).reader).toMatchObject({ readerLevel: 'senior', chosen: true });
    const view = (await (await app.request(`/api/projects/${project.id}/repo-wiki`)).json()) as RepoWikiResponse;
    expect(view.text).toEqual({ level: 'senior', canGenerate: true });
    expect(view.wiki!.generator.kind).toBe('rule');
    const before = fake.state.calls.length;
    const senior = await repoPost('text');
    expect(fake.state.calls.length).toBe(before + 1);
    expect(fake.state.systems.at(-1)).toContain('읽는 사람: 숙련 개발자');
    expect(senior.wiki.generator.kind).toBe('llm');
    expect(senior.text.canGenerate).toBe(false);

    // 비개발자 문장은 그대로 남아 있어 다시 부르지 않는다
    await setLevel('non-dev');
    const back = (await (await app.request(`/api/projects/${project.id}/repo-wiki`)).json()) as RepoWikiResponse;
    expect(back.wiki!.generator.kind).toBe('llm');
    expect(back.text).toEqual({ level: 'non-dev', canGenerate: false });
    expect(fake.state.calls.length).toBe(before + 1);
    expect((await setLevel('expert')).status).toBe(422);
  });

  it('falls back to rule text only when AI cannot be used, records why, and does not retry a failure by itself', async () => {
    await setLevel('junior');
    await store.update((c) => {
      c.llm.autoText = false;
    });
    const off = await repoPost('text');
    expect(off.wiki.generator).toEqual(expect.objectContaining({ kind: 'rule', reason: '설정에서 AI 문장 만들기를 꺼 두었습니다' }));
    expect(off.text.canGenerate).toBe(false);
    await store.update((c) => {
      c.llm.autoText = true;
    });
    fake.state.fail = true;
    const failed = await repoPost('text');
    expect(failed.wiki.generator.kind).toBe('rule');
    expect(failed.wiki.generator.reason).toContain('AI 호출이 실패해 규칙 기반 문장을 보여 줍니다');
    expect(failed.text.canGenerate).toBe(false);
    fake.state.fail = false;
    const calls = fake.state.calls.length;
    expect((await repoPost('text')).wiki.generator.kind).toBe('rule');
    expect(fake.state.calls.length).toBe(calls);
    expect((await repoPost('text', { force: true })).wiki.generator.kind).toBe('llm');
    await setLevel('non-dev');
  });

  it('writes knowledge reasons with AI in the background and keeps rule text for rejected ones', async () => {
    const sessions = (await (await app.request(`/api/projects/${project.id}/sessions`)).json()) as { key: string }[];
    await app.request(`/api/sessions/${encodeURIComponent(sessions[0]!.key)}/wiki/build`, { method: 'POST', headers: json, body: '{}' });
    const first = (await (await app.request('/api/me/knowledge')).json()) as KnowledgeWikiResponse;
    expect(first.text.canGenerate).toBe(true);
    expect(first.entries.every((e) => e.reasonOrigin === 'missing')).toBe(true);

    const start = await app.request('/api/me/knowledge/text', { method: 'POST', headers: json, body: '{}' });
    expect(start.status).toBe(202);
    const { jobId } = (await start.json()) as { jobId: string };
    expect((await waitJob(`/api/me/knowledge/text/jobs/${jobId}`)).state).toBe('done');

    const after = (await (await app.request('/api/me/knowledge')).json()) as KnowledgeWikiResponse;
    expect(after.text).toMatchObject({ canGenerate: false, missing: 0, generator: { kind: 'llm' } });
    const origins = after.entries.map((e) => e.reasonOrigin);
    expect(origins.filter((o) => o === 'rule')).toHaveLength(1);
    expect(origins.filter((o) => o === 'llm').length).toBe(after.entries.length - 1);
    expect(after.entries.find((e) => e.reasonOrigin === 'llm')?.reason).toContain('이 개념이 함께 쓰였습니다');
    expect(fake.state.systems.at(-1)).toContain('읽는 사람: 개발을 전혀 모르는 사람');

    // 수준을 바꾸면 그 수준의 문장이 없으므로 다시 써야 한다
    await setLevel('beginner');
    const beginner = (await (await app.request('/api/me/knowledge')).json()) as KnowledgeWikiResponse;
    expect(beginner.text.canGenerate).toBe(true);
    expect(beginner.entries.every((e) => e.reasonOrigin === 'missing')).toBe(true);
    await setLevel('non-dev');

    // 같은 사실이면 다시 부르지 않는다
    const again = await app.request('/api/me/knowledge/text', { method: 'POST', headers: json, body: '{}' });
    expect(await again.json()).toEqual({ status: 'done' });
  });

  it('rejects starting the knowledge text job without a JSON body (CSRF guard)', async () => {
    expect((await app.request('/api/me/knowledge/text', { method: 'POST' })).status).toBe(415);
  });
});
