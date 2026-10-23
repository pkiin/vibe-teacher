import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssessmentResult, AssessmentStartResponse, KnowledgeWikiResponse, LearnerProfile, Project, SessionSummary } from '@vibe-teacher/shared';
import { allAdapters } from '../../src/adapters/registry';
import { AnalysisService } from '../../src/analyzers/index';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { detectConcepts } from '../../src/analyzers/concepts/index';
import { loadConceptDictionary } from '../../src/analyzers/concepts/dictionary';
import { createApp } from '../../src/app';
import { AuthService } from '../../src/auth/service';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { SessionIndex } from '../../src/index/session-index';
import { buildKnowledgeEntries, extractOccurrences, mentionPatterns, ownWords, reasonFor, shortName } from '../../src/learner/knowledge';
import { emptyConceptCounts, unknownConcept } from '../../src/learner/reducer';
import { EnrichService } from '../../src/llm/service';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import { createWikiServices } from '../../src/wiki/service';
import { caseA, fakeSession, profileWith, snapshotOf } from '../wiki/helpers';

const catalog = loadWikiCatalog();
const patterns = mentionPatterns(loadConceptDictionary());
const known = new Set(catalog.concepts.keys());

function occurrencesOf(session = caseA(), withSnapshot = true) {
  const built = summarizeBuilt(session, '/home/tester');
  return extractOccurrences({ session, projectName: 'app', hits: detectConcepts(session, built), snapshot: withSnapshot ? snapshotOf(session) : null, patterns, knownConceptIds: known });
}

describe('knowledge occurrences', () => {
  it('records where a concept came up: risk items, wiki items and detected concepts', () => {
    const occ = occurrencesOf();
    const authz = occ.concepts.filter((c) => c.conceptId === 'authorization');
    expect(authz.map((c) => c.via)).toEqual(expect.arrayContaining(['finding', 'item']));
    expect(authz.find((c) => c.via === 'finding')?.refTitle).toBe('접근 권한 검사 위치 미확인');
    expect(occ.request).toBe('관리자 화면을 추가해 줘. 회원 목록을 볼 수 있게.');
  });

  it('uses the request of the turn where the evidence appeared, not just the first message', () => {
    const occ = occurrencesOf(fakeSession([{ human: '처음엔 README 만 정리해 줘' }, { write: 'README.md', edit: true }, { human: '이제 관리자 화면을 추가해 줘' }, { write: 'src/routes/admin.ts' }]));
    expect(occ.request).toBe('처음엔 README 만 정리해 줘');
    expect(occ.concepts.find((c) => c.conceptId === 'authorization' && c.via === 'finding')?.request).toBe('이제 관리자 화면을 추가해 줘');
  });

  it('ignores pasted text and IDE tags when looking for mentions', () => {
    expect(ownWords('이거 봐 <pasted_content id="1">권한 검사 — 이해 미확인</pasted_content id="1"> 어때?')).toBe('이거 봐 어때?');
    const occ = occurrencesOf(fakeSession([{ human: '관리자 화면 <pasted_content id="9">권한 검사 미확인</pasted_content id="9">' }, { write: 'src/routes/admin.ts' }]));
    expect(occ.mentions.find((m) => m.conceptId === 'authorization')).toBeUndefined();
  });

  it('notes user mentions as context only', () => {
    const occ = occurrencesOf(fakeSession([{ human: '관리자 화면 추가해 줘. 권한 검사도 필요한가요?' }, { write: 'src/routes/admin.ts' }]));
    expect(occ.mentions.find((m) => m.conceptId === 'authorization')?.snippet).toContain('권한 검사');
  });
});

describe('knowledge reason text', () => {
  const top = { sessionKey: 's', sessionTitle: '회원가입 기능 구현', projectId: 'p', projectName: 'app', via: 'finding' as const, refTitle: '접근 권한 검사 위치 미확인', request: '로그인 기능 만들어 줘' };
  const s = (over: Partial<ReturnType<typeof unknownConcept>> = {}) => ({ ...unknownConcept('authorization'), ...over });

  it('says no evidence was seen without concluding the user does not know', () => {
    expect(reasonFor({ name: '권한 검사 (인가)', state: s(), top })).toBe('"로그인 기능 만들어 줘" 작업에서 "접근 권한 검사 위치 미확인" 확인이 필요했습니다. 이 개념은 아직 문제로 이해를 확인하지 않았습니다.');
    expect(shortName('권한 검사 (인가)')).toBe('권한 검사');
  });

  it('reflects mentions, self-reports, partial evidence and disputes', () => {
    expect(reasonFor({ name: '권한 검사 (인가)', state: s(), top, mention: { sessionKey: 's', sessionTitle: 't', messageIndex: 0, snippet: '권한도 봐야 하나요' } })).toContain('"권한도 봐야 하나요"처럼 언급하셨습니다');
    expect(reasonFor({ name: '권한 검사 (인가)', state: s({ selfReport: 'known' }), top })).toContain("'알고 있어요'라고 답하셨지만, 문제로 확인된 것은 아닙니다");
    expect(reasonFor({ name: '권한 검사 (인가)', state: s({ state: 'partial', assessmentScope: '서로 다른 문항 1개' }), top })).toContain('일부 문제에서 맞혔지만');
    expect(reasonFor({ name: '권한 검사 (인가)', state: s({ disputed: true }), top })).toContain('판단을 보류');
    expect(reasonFor({ name: '권한 검사 (인가)', state: s({ counts: { ...emptyConceptCounts(), incorrect: 1 } }), top })).toContain('오답 한 번으로 모른다고 판단하지 않습니다');
  });
});

describe('knowledge entries', () => {
  it('puts concepts tied to risks and wiki items first and lists the focus session first', () => {
    const a = occurrencesOf();
    const b = { ...occurrencesOf(caseA()), sessionKey: 'other-session', sessionTitle: '다른 세션' };
    const entries = buildKnowledgeEntries({ sessions: [b, a], profile: profileWith({}, 0), catalog: catalog.concepts, focusSessionKey: a.sessionKey, includeProfileOnly: false });
    const authz = entries.find((e) => e.conceptId === 'authorization')!;
    expect(authz.priority).toBe('check');
    expect(authz.sources[0]?.sessionKey).toBe(a.sessionKey);
    expect(authz.sources).toHaveLength(2);
    expect(authz.reason).toContain('이 개념은 아직 문제로 이해를 확인하지 않았습니다');
    expect(entries[0]?.priority).toBe('check');
  });

  it('includes concepts known only from the learner ledger on the global page', () => {
    const profile: LearnerProfile = profileWith({ rollback: { selfReport: 'known' } });
    const entries = buildKnowledgeEntries({ sessions: [], profile, catalog: catalog.concepts, includeProfileOnly: true });
    expect(entries.map((e) => e.conceptId)).toEqual(['rollback']);
    expect(entries[0]?.sources).toEqual([]);
  });
});

describe('/api/me knowledge flow', () => {
  let tmp: string;
  let app: ReturnType<typeof createApp>;
  let session: SessionSummary;
  let project: Project;
  const json = { 'content-type': 'application/json' };

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-knowledge-'));
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = path.join(tmp, 'home', os.userInfo().username);
    const dir = path.join(home, '.claude', 'projects', '-home-tester-myapp');
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(here, '../fixtures/claude/sess-1.jsonl'), path.join(dir, 'sess-1.jsonl'));
    const paths = resolvePaths(path.join(tmp, 'state'));
    const store = new ConfigStore(paths);
    await store.load();
    await store.update((c) => {
      c.scan = { mode: 'all', homes: [], homeRoots: [path.join(tmp, 'home')] };
    });
    const index = new SessionIndex({ adapters: allAdapters(), store, cacheDir: paths.indexCacheDir, hiddenRoot: paths.home, currentHome: home, env: {} });
    const auth = new AuthService({ store, paths, index, serviceUser: os.userInfo().username, bearerToken: null, isLoopback: true });
    await auth.init();
    const enrich = new EnrichService({ store, paths, providerOverride: null });
    app = createApp({ deps: { store, index, paths, analysis: new AnalysisService('/home/tester'), enrich, auth, ...createWikiServices(paths.home, store, () => enrich.resolveProvider()), version: 'test' }, quiet: true });
    await index.rescan();
    project = ((await (await app.request('/api/projects')).json()) as Project[])[0]!;
    session = ((await (await app.request(`/api/projects/${project.id}/sessions`)).json()) as SessionSummary[])[0]!;
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('builds the global knowledge wiki from the user\'s own sessions and updates reasons from feedback', async () => {
    const k = encodeURIComponent(session.key);
    await app.request(`/api/sessions/${k}/wiki/build`, { method: 'POST', headers: json, body: '{}' });
    const wiki = (await (await app.request('/api/me/knowledge')).json()) as KnowledgeWikiResponse;
    expect(wiki.scannedSessions).toBe(1);
    expect(wiki.entries.length).toBeGreaterThan(0);
    expect(wiki.projects.map((p) => p.id)).toEqual([project.id]);
    const first = wiki.entries[0]!;
    expect(first.sources[0]?.sessionKey).toBe(session.key);

    const fb = await app.request('/api/me/feedback', { method: 'POST', headers: json, body: JSON.stringify({ baseRevision: 0, sessionKey: session.key, event: { kind: 'self_report', conceptId: first.conceptId, value: 'known' } }) });
    expect(fb.status).toBe(200);
    const after = (await (await app.request(`/api/me/knowledge?sessionKey=${k}`)).json()) as KnowledgeWikiResponse;
    const same = after.entries.find((e) => e.conceptId === first.conceptId)!;
    expect(same.state.selfReport).toBe('known');
    expect(same.reason).toContain("'알고 있어요'라고 답하셨지만");
    expect(after.profile.revision).toBe(1);
  });

  it('runs a quiz without a session from the global page', async () => {
    const start = (await (await app.request('/api/me/assessments', { method: 'POST', headers: json, body: JSON.stringify({ conceptId: 'testing' }) })).json()) as AssessmentStartResponse;
    expect(start.question.conceptIds).toContain('testing');
    const res = await app.request(`/api/me/assessments/${start.assessmentId}/responses`, { method: 'POST', headers: json, body: JSON.stringify({ baseRevision: start.profileRevision, status: 'dont_know' }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AssessmentResult).grade).toBe('unscorable');
  });
});
