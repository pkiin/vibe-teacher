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
import { fakeAi } from '../wiki/helpers';

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

describe('AI-only generation over the API', () => {
  let tmp: string, project: Project;
  let app: ReturnType<typeof createApp>;
  let store: ConfigStore;
  let sessionKey: string;
  const calls: LlmRequest<unknown>[] = [];
  let fail = false;
  const provider: LlmProvider = {
    id: 'claude-cli', availability: async () => ({ ok: true }),
    complete: async <T,>(req: LlmRequest<T>) => {
      calls.push(req as LlmRequest<unknown>);
      if (fail) throw new LlmError('network', '연결이 끊겼습니다');
      if (req.schemaName === 'concept_documentation') {
        const inputs = JSON.parse(req.user) as { id: string }[];
        return { data: req.schema.parse({ concepts: inputs.map((c) => ({ id: c.id, summary: '공식 문서에서 확인한 정의입니다.', explanation: '공식 문서의 내용을 바탕으로 작성한 일반 개념 설명입니다.', links: [{ title: '공식 문서', url: 'https://docs.example.test/concepts' }, { title: '확인되지 않은 주소', url: 'https://invented.example.test' }] })) }),
          provider: 'openrouter', model: 'openai/gpt-5-mini', durationMs: 1, sources: [{ title: '공식 문서', url: 'https://docs.example.test/concepts', excerpt: '검색으로 가져온 문서 발췌입니다.' }] };
      }
      return fakeAi.complete(req);
    },
  };
  const json = { 'content-type': 'application/json' };
  const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const waitJob = async (url: string) => {
    for (let i = 0; i < 100; i++) {
      const job = await (await app.request(url)).json() as BaseJobStatus<unknown>;
      if (job.state !== 'queued' && job.state !== 'running') return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('작업이 완료되지 않았습니다');
  };
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-ai-only-'));
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = path.join(tmp, 'homes', os.userInfo().username), dir = path.join(home, '.claude', 'projects', '-home-tester-myapp');
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(here, '../fixtures/claude/sess-1.jsonl'), path.join(dir, 'sess-1.jsonl'));
    const paths = resolvePaths(path.join(tmp, 'state'));
    store = new ConfigStore(paths); await store.load();
    await store.update((c) => { c.scan = { mode: 'all', homes: [], homeRoots: [path.join(tmp, 'homes')] }; });
    const index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: home, env: {} });
    const auth = new AuthService({ store, paths, index, serviceUser: os.userInfo().username, bearerToken: null, isLoopback: true });
    await auth.init();
    const enrich = new EnrichService({ store, paths, providerOverride: provider });
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService(), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
    await index.rescan();
    project = (await (await app.request('/api/projects')).json() as Project[])[0]!;
    sessionKey = (await (await app.request(`/api/projects/${project.id}/sessions`)).json() as { key: string }[])[0]!.key;
  });
  afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

  it('GET never starts generation; the build button starts AI and publishes dynamic concepts', async () => {
    const enc = encodeURIComponent(sessionKey);
    expect((await app.request(`/api/sessions/${enc}/wiki`)).status).toBe(404);
    expect(calls).toEqual([]);
    const response = await post(`/api/sessions/${enc}/wiki/build`);
    const start = await response.json() as { generation: { jobId: string } };
    const job = await waitJob(`/api/sessions/${enc}/wiki/ai/jobs/${start.generation.jobId}`);
    expect(job.state).toBe('done');
    const wiki = await (await app.request(`/api/sessions/${enc}/wiki`)).json() as import('@vibe-teacher/shared').WikiResponse;
    expect(wiki.snapshot.generator.kind).toBe('llm');
    expect(wiki.concepts.authorization).toBeDefined();
    expect(wiki.concepts.authorization?.links).toEqual([{ title: '공식 문서', url: 'https://docs.example.test/concepts' }]);
    expect(wiki.concepts.authorization?.documentation?.sources[0]?.excerpt).toContain('문서 발췌');
    expect(calls.some((r) => r.schemaName === 'concept_documentation' && r.task === 'research')).toBe(true);
    const research = calls.find((r) => r.schemaName === 'concept_documentation')!;
    expect(research.user).not.toContain('/home/');
    expect(research.user).not.toContain('ev_');
    const concepts = await (await app.request(`/api/sessions/${enc}/concepts`)).json() as { id: string }[];
    expect(concepts.some((c) => c.id === 'authorization')).toBe(true);
  });
  it('rewrites another reader level without changing common project facts or refetching documents', async () => {
    const enc = encodeURIComponent(sessionKey);
    const before = await (await app.request(`/api/sessions/${enc}/wiki`)).json() as import('@vibe-teacher/shared').WikiResponse;
    await app.request('/api/me/prefs', { method: 'PUT', headers: json, body: JSON.stringify({ readerLevel: 'senior' }) });
    const researched = calls.filter((c) => c.schemaName === 'concept_documentation').length;
    const started = await (await post(`/api/sessions/${enc}/wiki/ai`, {})).json() as { jobId: string };
    expect((await waitJob(`/api/sessions/${enc}/wiki/ai/jobs/${started.jobId}`)).state).toBe('done');
    const after = await (await app.request(`/api/sessions/${enc}/wiki`)).json() as import('@vibe-teacher/shared').WikiResponse;
    expect(after.snapshot.generationId).toBe(before.snapshot.generationId);
    expect(after.snapshot.claims).toEqual(before.snapshot.claims);
    expect(after.snapshot.findings).toEqual(before.snapshot.findings);
    expect(after.snapshot.items).toEqual(before.snapshot.items);
    expect(calls.filter((c) => c.schemaName === 'concept_documentation')).toHaveLength(researched);
    expect(calls.find((c) => c.schemaName === 'wiki_ai_texts')?.system).toContain('읽는 사람: 숙련 개발자');
  });
  it('writes repository sections with AI and never serves template prose while generating', async () => {
    const url = `/api/projects/${project.id}/repo-wiki`;
    const start = await (await post(`${url}/build`)).json() as Exclude<RepoWikiBuildResponse, { status: 'done' }>;
    expect((await waitJob(`${url}/jobs/${start.jobId}`)).state).toBe('done');
    const view = await (await app.request(url)).json() as RepoWikiResponse;
    expect(view.wiki?.generator.kind).toBe('llm');
    expect(view.wiki?.user[0]?.origin).toBe('llm');
    expect(view.wiki?.system.every((s) => s.origin === 'llm')).toBe(true);
  });
  it('shows a generation failure and preserves no canned fallback; manual retry succeeds', async () => {
    const url = `/api/projects/${project.id}/repo-wiki`;
    await app.request('/api/me/prefs', { method: 'PUT', headers: json, body: JSON.stringify({ readerLevel: 'junior' }) });
    fail = true;
    const start = await (await post(`${url}/text`)).json() as { jobId: string };
    expect((await waitJob(`${url}/jobs/${start.jobId}`)).state).toBe('error');
    const view = await (await app.request(url)).json() as RepoWikiResponse;
    expect(view.wiki?.generator.kind).toBe('unavailable');
    expect(view.wiki?.user).toEqual([]);
    expect(view.wiki?.system).toEqual([]);
    expect(view.text?.canGenerate).toBe(false);
    fail = false;
    const retry = await (await post(`${url}/text`, { force: true })).json() as { jobId: string };
    expect((await waitJob(`${url}/jobs/${retry.jobId}`)).state).toBe('done');
  });
  it('builds personal knowledge from generated concepts and writes reasons with AI', async () => {
    const first = await (await app.request('/api/me/knowledge')).json() as KnowledgeWikiResponse;
    expect(first.entries.length).toBeGreaterThan(0);
    expect(first.entries.every((e) => !e.reason)).toBe(true);
    expect(first.concepts?.authorization).toBeDefined();
    const started = await (await post('/api/me/knowledge/text')).json() as { jobId: string };
    expect((await waitJob(`/api/me/knowledge/text/jobs/${started.jobId}`)).state).toBe('done');
    const after = await (await app.request('/api/me/knowledge')).json() as KnowledgeWikiResponse;
    expect(after.entries.every((e) => e.reasonOrigin === 'llm')).toBe(true);
    expect(after.entries.every((e) => e.state.state === 'unknown')).toBe(true);
  });
});
