import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, RepoFeature } from '@vibe-teacher/shared';
import { AnalysisService } from '../../src/analyzers/index';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import type { SessionIndex } from '../../src/index/session-index';
import { EnrichService } from '../../src/llm/service';
import type { LlmProvider, LlmRequest } from '../../src/llm/types';
import { acceptFeaturePage, collectFeatureMaterials, FeatureAnalysisService, readFeatureExcerpts, resolveFeatureRef, type FeaturePageOutput } from '../../src/repo/feature';
import { RepoWikiService } from '../../src/repo/service';
import { WikiStorage } from '../../src/storage/store';
import type { WikiService } from '../../src/wiki/service';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123';
/** 합성 저장소: 요약 기능이 OpenAI SDK 를 부른다. 줄 번호를 검사에 쓰므로 줄을 바꾸지 않는다. */
const SUMMARIZE = [
  "import OpenAI from 'openai';",
  'export const SUMMARY_SYSTEM = `당신은 요약가입니다.',
  '짧게 요약하세요.`;',
  '',
  'export function buildUser(text: string) {',
  '  return `다음 글을 요약: ${text}`;',
  '}',
  'export async function summarize(text: string) {',
  "  const res = await new OpenAI().chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: buildUser(text) }] });",
  '  return res.choices[0]?.message.content;',
  '}',
  `export const FALLBACK = '${SECRET}';`,
].join('\n');
const MAIN = "import { summarize } from './summarize';\nexport async function handleSummary(body: { text: string }) {\n  return { summary: await summarize(body.text) };\n}\n";

async function repo() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-feature-')); temps.push(tmp);
  const root = path.join(tmp, 'repo');
  await fs.mkdir(path.join(root, 'server', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server/src/main.ts' } }));
  await fs.writeFile(path.join(root, 'server', 'src', 'main.ts'), MAIN);
  await fs.writeFile(path.join(root, 'server', 'src', 'summarize.ts'), SUMMARIZE);
  await fs.writeFile(path.join(root, 'web', 'src', 'App.tsx'), 'export function App() {\n  return <main>요약</main>;\n}\n');
  await fs.writeFile(path.join(root, '.env'), `OPENAI_API_KEY=${SECRET}\n`);
  return { tmp, root };
}

const feature: RepoFeature = { id: 'summary', name: '글 요약', summary: '글을 받아 AI로 요약합니다.', files: [{ kind: 'file', path: 'server/src/summarize.ts' }], sessions: [], sources: [] };

describe('기능 분석 재료와 근거 검사', () => {
  it('기능 파일과 그 파일을 불러오는 파일, AI 호출 단서 줄을 모으고 비밀 파일·비밀값은 넣지 않는다', async () => {
    const { root } = await repo();
    const m = await collectFeatureMaterials({ root, feature, files: ['package.json', 'server/src/main.ts', 'server/src/summarize.ts', 'web/src/App.tsx', '.env'] });
    expect(m.candidates.map((c) => c.path).sort()).toEqual(['server/src/main.ts', 'server/src/summarize.ts']);
    expect(m.candidates.find((c) => c.path === 'server/src/summarize.ts')!.importedBy).toEqual(['server/src/main.ts']);
    expect([...m.excerpts.keys()]).toEqual(expect.arrayContaining(['F:server/src/summarize.ts#L1-L1', 'F:server/src/summarize.ts#L9-L9']));
    expect(m.fileSet.has('.env')).toBe(false);
    const asked = await readFeatureExcerpts(m, [{ path: 'server/src/summarize.ts', line: 1, question: '모델은?' }, { path: '.env', line: 1, question: '키는?' }]);
    expect(asked.map((a) => a.ref)).toEqual(['F:server/src/summarize.ts#L1-L12']);
    expect(asked[0]!.code).not.toContain(SECRET);
    expect(m.budget).toBeLessThan(48_000);
  });

  it('프롬프트는 가리킨 줄을 그대로 옮기고, 모델 값은 그 줄에 있을 때만, 읽지 않은 줄·지어낸 파일은 거른다', async () => {
    const { root } = await repo();
    const m = await collectFeatureMaterials({ root, feature, files: ['server/src/main.ts', 'server/src/summarize.ts'] });
    await readFeatureExcerpts(m, [{ path: 'server/src/summarize.ts', line: 1, question: 'q' }]);
    expect(resolveFeatureRef('F:server/src/summarize.ts#L2-L3', m)?.text).toBe('export const SUMMARY_SYSTEM = `당신은 요약가입니다.\n짧게 요약하세요.`;');
    expect(resolveFeatureRef('F:server/src/summarize.ts#L3-L2', m)).toBeNull();
    expect(resolveFeatureRef('F:server/src/main.ts#L1-L2', m)).toBeNull();
    expect(resolveFeatureRef('F:server/src/main.ts', m)?.source).toEqual({ kind: 'file', path: 'server/src/main.ts' });
    const call = { purpose: '글 요약', provider: 'OpenAI SDK', model: 'gpt-4o-mini', modelOrigin: 'code' as const, modelRef: 'F:server/src/summarize.ts#L9-L9', systemPromptRef: 'F:server/src/summarize.ts#L2-L3', userPromptRef: 'F:server/src/summarize.ts#L5-L7', outputHandling: '첫 응답 문장을 돌려줍니다.', sources: ['F:server/src/summarize.ts#L8-L11'] };
    const output: FeaturePageOutput = {
      overview: ['요약 기능입니다.'], overviewSources: ['F:server/src/summarize.ts#L1-L12'],
      userFlow: [{ title: '글을 보냄', detail: '요약을 요청합니다.', sources: ['F:server/src/summarize.ts#L8-L9'] }, { title: '지어낸 단계', detail: 'x', sources: ['F:server/src/other.ts#L1-L2'] }],
      files: [{ path: 'server/src/summarize.ts', role: '요약 요청을 보냅니다.', sources: ['F:server/src/summarize.ts#L8-L11'] }, { path: 'server/src/invented.ts', role: '없음', sources: ['F:server/src/summarize.ts#L1-L2'] }],
      aiCalls: [call, { ...call, purpose: '지어낸 모델', model: 'gpt-9', systemPromptRef: 'F:server/src/summarize.ts#L90-L99', userPromptRef: '' }],
      limits: ['오류 처리는 확인하지 못했습니다.'],
    };
    const page = acceptFeaturePage(output, m);
    expect(page.userFlow.map((s) => s.title)).toEqual(['글을 보냄']);
    expect(page.files.map((f) => f.path)).toEqual(['server/src/summarize.ts']);
    const [real, fake] = page.aiCalls;
    expect(real).toMatchObject({ model: 'gpt-4o-mini', modelOrigin: 'code', modelSource: { path: 'server/src/summarize.ts', startLine: 9, endLine: 9 } });
    expect(real!.systemPrompt).toEqual({ source: expect.objectContaining({ startLine: 2, endLine: 3 }), text: SUMMARIZE.split('\n').slice(1, 3).join('\n') });
    expect(real!.userPrompt?.text).toBe(SUMMARIZE.split('\n').slice(4, 7).join('\n'));
    expect(fake).toMatchObject({ modelOrigin: 'unknown' });
    expect(fake!.model).toBeUndefined();
    expect(fake!.systemPrompt).toBeUndefined();
    expect(page.warnings.join('\n')).toMatch(/모델 값을 근거 줄에서 확인하지 못해/);
    expect(page.warnings.join('\n')).toMatch(/읽은 코드 밖/);
    expect(page.warnings.join('\n')).toMatch(/AI 설명 2개를 제외/);
    expect(() => acceptFeaturePage({ overview: [], overviewSources: [], userFlow: [], files: [], aiCalls: [], limits: [] }, m)).toThrow('근거를 확인할 수 있는');
  });
});

async function setup() {
  const { tmp, root } = await repo();
  const requests: LlmRequest<unknown>[] = [];
  let round = 0;
  const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
    requests.push(req as LlmRequest<unknown>);
    let data: unknown;
    if (req.schemaName === 'repo_inspect_plan') data = { questions: [] };
    else if (req.schemaName === 'repo_wiki_text') {
      const nodes = ['server/src/main.ts', 'server/src/summarize.ts', 'web/src/App.tsx'];
      data = { changes: [], sections: [{ id: 'how', page: 'system', title: '동작', sources: [], paragraphs: [], items: [], sourceBlocks: ['mechanism'] }],
        flowGroups: [{ id: 'app', label: '앱', description: '앱 코드', sources: ['F:server/src/main.ts#L1-L1'] }],
        flowNodes: nodes.map((id) => ({ id, groupId: 'app', description: `${id}의 동작`, sources: [`F:${id}#L1-L1`] })),
        features: [
          { id: 'summary', name: '글 요약', summary: '글을 받아 AI로 요약합니다.', files: ['F:server/src/summarize.ts'], sessions: [], sources: ['F:server/src/summarize.ts'] },
          { id: '../evil', name: '경로 조작', summary: 'x', files: ['F:server/src/main.ts'], sessions: [], sources: [] },
          { id: 'ghost', name: '없는 기능', summary: 'x', files: ['F:server/src/ghost.ts'], sessions: [], sources: [] },
        ] };
    } else if (req.schemaName === 'repo_feature_plan') {
      expect(req.task).toBe('repo-inspect');
      data = { questions: [{ path: 'server/src/summarize.ts', line: 1, question: '어떤 모델과 프롬프트로 요약하나요?' }] };
    } else if (req.schemaName === 'repo_feature_round') {
      round++;
      expect(req.task).toBe('repo-inspect');
      data = round === 1
        ? { answers: [{ question: '어떤 모델과 프롬프트로 요약하나요?', answer: 'gpt-4o-mini 와 SUMMARY_SYSTEM 을 씁니다.', sources: ['F:server/src/summarize.ts#L9-L9'] }],
          followUps: [{ path: 'server/src/main.ts', line: 1, question: '요약은 어디서 부르나요?' }] }
        : { answers: [{ question: '요약은 어디서 부르나요?', answer: 'handleSummary 가 부릅니다.', sources: ['F:server/src/main.ts#L2-L3'] }, { question: '지어낸 답', answer: 'x', sources: ['F:web/src/App.tsx#L1-L2'] }], followUps: [] };
    } else if (req.schemaName === 'repo_feature_page') {
      expect(req.task).toBeUndefined();
      data = {
        overview: ['글을 보내면 요약을 돌려줍니다.'], overviewSources: ['F:server/src/summarize.ts#L8-L11'],
        userFlow: [{ title: '요약 요청', detail: 'handleSummary 가 summarize 를 부릅니다.', sources: ['F:server/src/main.ts#L2-L3'] }],
        files: [{ path: 'server/src/main.ts', role: '요청을 받아 요약 함수를 부릅니다.', sources: ['F:server/src/main.ts#L1-L4'] }],
        aiCalls: [{ purpose: '글 요약', provider: 'OpenAI SDK', model: 'gpt-4o-mini', modelOrigin: 'code', modelRef: 'F:server/src/summarize.ts#L9-L9', systemPromptRef: 'F:server/src/summarize.ts#L2-L3', userPromptRef: 'F:server/src/summarize.ts#L5-L7', outputHandling: '첫 응답을 돌려줍니다.', sources: ['F:server/src/summarize.ts#L8-L11'] }],
        limits: [],
      };
    } else throw new Error(`예상하지 못한 호출: ${req.schemaName}`);
    return { data: req.schema.parse(data), provider: 'claude-cli', model: 'fixture', durationMs: 1, costUsd: 0.001 };
  } };
  const paths = resolvePaths(path.join(tmp, 'state'));
  const store = new ConfigStore(paths); await store.load();
  const storage = new WikiStorage(paths.home);
  const index = { getProjectIds: (id: string) => [id], getSessions: () => [], getSummary: () => undefined, loadSession: async () => null } as unknown as SessionIndex;
  const enrich = new EnrichService({ store, paths, providerOverride: provider });
  const repoService = new RepoWikiService({ storage, store, index, analysis: new AnalysisService(), wiki: { current: async () => null } as unknown as WikiService, enrich });
  const features = new FeatureAnalysisService({ storage, store, index, enrich, repo: repoService });
  const project: Project = { id: 'project', accountId: 'account', rootPath: root, name: '요약 앱', exists: true, providers: [], sessionCount: 0 };
  const wait = async (queue: { get(id: string): { state: string } | undefined }, id: string) => {
    for (let n = 0; n < 200; n++) {
      const job = queue.get(id)!;
      if (!['queued', 'running'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('작업이 끝나지 않았습니다');
  };
  return { root, requests, repoService, features, project, wait };
}

describe('주요 기능 페이지', () => {
  it('레포 위키가 고른 기능을 근거 검사 후 목록으로 만들고, 자세한 분석은 AI 질문 → 코드 읽기 → 후속 질문 → 페이지 순서로 만든다', async () => {
    const { root, requests, repoService, features, project, wait } = await setup();
    const built = await repoService.build(project, 'junior', { ok: true });
    if (built.status === 'done') throw new Error('작업 필요');
    expect((await wait(repoService.jobs, built.jobId)).state).toBe('done');

    const list = await features.list(project, 'junior');
    expect(list.features.map((f) => f.id)).toEqual(['summary']);
    // 사용자 페이지에도 같은 목록이 기능 페이지 링크 블록으로 들어간다
    const wiki = (await repoService.get(project, 'junior', { ok: true })).wiki!;
    expect(wiki.user.flatMap((s) => s.blocks).filter((b) => b.kind === 'features')).toEqual([{ kind: 'features', ids: ['summary'] }]);
    expect(list.features[0]!.analyzedAt).toBeUndefined();
    const before = await features.get(project, 'summary', 'junior', { ok: true });
    expect(before).toMatchObject({ page: null, stale: false, feature: { name: '글 요약' } });
    expect(before!.unavailable).toBeUndefined();
    const preview = await features.preview(project, 'summary', 'junior', { ok: true });
    expect(preview.system).toContain('읽는 사람:');
    expect(preview.user).toContain('gpt-4o-mini');
    const callsBefore = requests.length;
    expect(await features.get(project, '../evil', 'junior', { ok: true })).toBeNull();
    await expect(features.analyze(project, '../evil', 'junior', { ok: true })).rejects.toMatchObject({ status: 404 });
    expect(requests).toHaveLength(callsBefore);

    const started = await features.analyze(project, 'summary', 'junior', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    const job = await wait(features.jobs, started.jobId);
    expect(job.state).toBe('done');
    expect(requests.slice(callsBefore).map((r) => r.schemaName)).toEqual(['repo_feature_plan', 'repo_feature_round', 'repo_feature_round', 'repo_feature_page']);
    // 두 번째 단계는 AI 가 만든 후속 질문의 파일(main.ts)을 읽어 보낸다
    expect(requests[callsBefore + 2]!.user).toContain('handleSummary');
    for (const r of requests) {
      expect(r.user).not.toContain(SECRET);
      expect(r.trace?.feature ?? 'repo_feature').toMatch(/^repo_(wiki|feature)$/);
    }

    const after = await features.get(project, 'summary', 'junior', { ok: true });
    const page = after!.page!;
    expect(page.questions.map((q) => [q.round, q.question])).toEqual([[1, '어떤 모델과 프롬프트로 요약하나요?'], [2, '요약은 어디서 부르나요?']]);
    expect(page.aiCalls[0]).toMatchObject({ model: 'gpt-4o-mini', modelOrigin: 'code', systemPrompt: { text: SUMMARIZE.split('\n').slice(1, 3).join('\n') } });
    expect(page.generator).toMatchObject({ calls: 4, rounds: 2, costUsd: 0.004 });
    expect(page.warnings.join('\n')).toContain('확인 답변 1개를 제외');
    expect(after!.stale).toBe(false);
    expect((await features.list(project, 'junior')).features[0]!.analyzedAt).toBe(page.at);
    expect(await features.get(project, 'summary', 'non-dev', { ok: true })).toMatchObject({ page: null });

    await fs.writeFile(path.join(root, 'server', 'src', 'main.ts'), `${MAIN}// 바뀜\n`);
    expect(await features.get(project, 'summary', 'junior', { ok: true })).toMatchObject({ stale: true, staleReasons: [expect.stringContaining('server/src/main.ts')] });
    expect(await features.get(project, 'summary', 'junior', { ok: false, reason: '권한 없음' })).toMatchObject({ unavailable: '권한 없음' });
    await expect(features.analyze(project, 'summary', 'junior', { ok: false, reason: '권한 없음' })).rejects.toMatchObject({ status: 409 });

    // 다시 생성할 때 이전 기능 id 를 알려 같은 기능에 같은 id 를 쓰게 한다
    const rewrite = await repoService.writeText(project, 'junior', { ok: true }, true);
    if (rewrite.status === 'done') throw new Error('작업 필요');
    await wait(repoService.jobs, rewrite.jobId);
    expect(requests.filter((r) => r.schemaName === 'repo_wiki_text').at(-1)!.user).toContain('=== 기존 주요 기능 id (같은 기능이면 같은 id를 다시 쓰세요) ===\n[{"id":"summary","name":"글 요약"}]');
  });
});
