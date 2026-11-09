import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_USAGE_LIMITS, type Project, type RepoFeature } from '@vibe-teacher/shared';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import type { SessionIndex } from '../../src/index/session-index';
import { EnrichService } from '../../src/llm/service';
import type { LlmProvider, LlmRequest } from '../../src/llm/types';
import { readFeatureExcerpts } from '../../src/repo/feature';
import type { RepoWikiService } from '../../src/repo/service';
import { acceptUsagePage, collectUsageMaterials, usagePlanInput, usageScore, UsageGuideService, type UsagePageOutput } from '../../src/repo/usage';
import { WikiStorage } from '../../src/storage/store';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123';
/** 합성 저장소: 메모를 쓰고 저장하는 앱. 줄 번호를 검사에 쓰므로 줄을 바꾸지 않는다. */
const APP = [
  "import { t } from './i18n/ko';",
  "import { saveMemo } from './api';",
  'export function App() {',
  '  return (',
  '    <main>',
  "      <textarea placeholder={t.memo.placeholder} />",
  '      <button onClick={() => saveMemo()}>{t.memo.save}</button>',
  '    </main>',
  '  );',
  '}',
].join('\n');
const STRINGS = [
  'export const t = {',
  '  memo: {',
  "    save: '메모 저장',",
  "    placeholder: '여기에 메모를 쓰세요',",
  '  },',
  '};',
].join('\n');
const API = `export async function saveMemo() {\n  await fetch('/api/memos', { method: 'POST', headers: { authorization: 'Bearer ${SECRET}' } });\n}\n`;
const FILES = ['README.md', 'package.json', 'web/src/App.tsx', 'web/src/api.ts', 'web/src/i18n/ko.ts', 'web/test/App.test.tsx', 'server/src/db.ts', '.env'];

async function repo() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-usage-')); temps.push(tmp);
  const root = path.join(tmp, 'repo');
  const write = async (file: string, text: string) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  await write('README.md', '# 메모 앱\n\n메모를 쓰고 저장합니다.\n');
  await write('package.json', JSON.stringify({ scripts: { start: 'vite' } }));
  await write('web/src/App.tsx', APP);
  await write('web/src/api.ts', API);
  await write('web/src/i18n/ko.ts', STRINGS);
  await write('web/test/App.test.tsx', "it('렌더링', () => {});\n");
  await write('server/src/db.ts', 'export const db = {};\n');
  await write('.env', `OPENAI_API_KEY=${SECRET}\n`);
  return { tmp, root };
}

const feature: RepoFeature = { id: 'memo', name: '메모 저장', summary: '메모를 써서 저장합니다.', files: [{ kind: 'file', path: 'web/src/api.ts' }], sessions: [], sources: [] };

describe('사용 방법 재료와 근거 검사', () => {
  it('화면·문구 파일과 README, 버튼 단서 줄을 모으고 테스트·비밀 파일·비밀값은 넣지 않는다', async () => {
    const { root } = await repo();
    const m = await collectUsageMaterials({ root, projectName: '메모 앱', files: FILES, features: [feature] });
    const paths = m.candidates.map((c) => c.path);
    // 화면 문구 파일과 화면 진입점이 먼저 오고, 테스트·서버 DB·.env 는 후보가 아니다
    expect(paths.slice(0, 2).sort()).toEqual(['web/src/App.tsx', 'web/src/i18n/ko.ts']);
    expect(paths).not.toContain('web/test/App.test.tsx');
    expect(paths).not.toContain('server/src/db.ts');
    expect(m.fileSet.has('.env')).toBe(false);
    expect(usageScore('web/test/App.test.tsx')).toBe(0);
    // 문구 파일은 묶음 위치를, 화면 파일은 버튼 단서 줄을 보낸다
    const strings = m.candidates.find((c) => c.path === 'web/src/i18n/ko.ts')!;
    expect(strings.keys).toEqual(['t(L1)', 'memo(L2)']);
    expect([...m.excerpts.keys()]).toEqual(expect.arrayContaining(['F:README.md#L1-L4', 'F:web/src/App.tsx#L6-L6', 'F:web/src/App.tsx#L7-L7']));
    const input = usagePlanInput(m);
    expect(input).toContain('메모를 쓰고 저장합니다.');
    expect(input).toContain('<button onClick={() => saveMemo()}>{t.memo.save}</button>');
    const asked = await readFeatureExcerpts(m, [{ path: 'web/src/api.ts', line: 1, question: '저장은?' }, { path: '.env', line: 1, question: '키는?' }], 8);
    expect(asked.map((a) => a.ref)).toEqual(['F:web/src/api.ts#L1-L4']);
    expect(JSON.stringify([input, asked])).not.toContain(SECRET);
  });

  it('근거를 확인한 버튼만 싣고, 화면 문구는 인용한 줄에 그대로 있을 때만, 절 id 는 코드가 붙인다', async () => {
    const { root } = await repo();
    const m = await collectUsageMaterials({ root, projectName: '메모 앱', files: FILES });
    await readFeatureExcerpts(m, [{ path: 'web/src/i18n/ko.ts', line: 1, question: '문구는?' }, { path: 'web/src/App.tsx', line: 1, question: '화면은?' }], 8);
    const item = (over: Partial<UsagePageOutput['sections'][number]['parts'][number]['items'][number]>) => ({ name: '메모 저장', label: '메모 저장', what: '쓴 메모를 서버에 저장해요.', tip: '', sources: ['F:web/src/App.tsx#L7-L7', 'F:web/src/i18n/ko.ts#L3-L3'], ...over });
    const output: UsagePageOutput = {
      intro: ['메모를 쓰고 저장하는 앱이에요.'], introSources: ['F:README.md#L1-L3'],
      steps: [{ title: '메모 쓰기', text: '칸에 메모를 쓰고 저장을 눌러요.', sources: ['F:web/src/App.tsx#L6-L7'] }, { title: '지어낸 단계', text: 'x', sources: ['F:web/src/Other.tsx#L1-L2'] }],
      sections: [
        { title: '메모 화면', where: '첫 화면', intro: '메모를 써요.', parts: [{ title: '', items: [
          item({ tip: '쓴 뒤 바로 눌러 보세요.' }),
          item({ name: '메모 칸', label: '메모를 쓰는 칸', what: '메모를 써요.', sources: ['F:web/src/App.tsx#L6-L6'] }),
          item({ name: '메모 저장', what: '같은 이름은 한 번만 싣는다' }),
          item({ name: '지어낸 버튼', label: '', sources: ['F:web/src/App.tsx#L90-L99'] }),
        ] }] },
        { title: '관리', where: '', intro: '', parts: [{ title: '', items: [item({ name: '없는 화면', sources: ['F:admin/Members.tsx#L1-L2'] })] }] },
      ],
      faq: [{ q: '어디에 저장되나요?', a: '서버의 /api/memos 로 보내요.', sources: ['F:web/src/api.ts'] }],
      limits: ['서버 저장 방식은 확인하지 못했어요.'],
    };
    const page = acceptUsagePage(output, m);
    expect(page.sections.map((s) => [s.id, s.title])).toEqual([['u1', '메모 화면']]);
    const items = page.sections[0]!.parts[0]!.items;
    expect(items.map((i) => i.name)).toEqual(['메모 저장', '메모 칸']);
    expect(items[0]).toMatchObject({ label: '메모 저장', tip: '쓴 뒤 바로 눌러 보세요.' });
    // '메모를 쓰는 칸'은 인용한 줄에 없는 문구라 문구 표시를 빼고 싣는다
    expect(items[1]!.label).toBeUndefined();
    expect(page.steps.map((s) => s.title)).toEqual(['메모 쓰기']);
    expect(page.faq).toHaveLength(1);
    expect(page.warnings.join('\n')).toMatch(/AI 설명 4개를 제외/);
    expect(page.warnings.join('\n')).toMatch(/화면 문구 1개는 문구 표시를 빼고/);
    expect(() => acceptUsagePage({ ...output, sections: [] }, m)).toThrow('근거를 확인할 수 있는 사용 방법');
  });
});

async function setup() {
  const { tmp, root } = await repo();
  const requests: LlmRequest<unknown>[] = [];
  let round = 0;
  const provider: LlmProvider = { id: 'openrouter', availability: async () => ({ ok: true }), complete: async (req) => {
    requests.push(req as LlmRequest<unknown>);
    let data: unknown;
    if (req.schemaName === 'repo_usage_plan') data = { questions: [{ path: 'web/src/App.tsx', line: 1, question: '첫 화면에 어떤 버튼이 있나요?' }] };
    else if (req.schemaName === 'repo_usage_round') {
      round++;
      data = round === 1
        ? { answers: [{ question: '첫 화면에 어떤 버튼이 있나요?', answer: '메모 칸과 저장 버튼이 있습니다.', sources: ['F:web/src/App.tsx#L6-L7'] }],
          followUps: [{ path: 'web/src/i18n/ko.ts', line: 1, question: '저장 버튼 문구는?' }] }
        : { answers: [{ question: '저장 버튼 문구는?', answer: "'메모 저장'입니다.", sources: ['F:web/src/i18n/ko.ts#L3-L3'] }], followUps: [] };
    } else if (req.schemaName === 'repo_usage_page') {
      data = {
        intro: ['메모를 쓰고 저장해요.'], introSources: ['F:README.md#L1-L3'],
        steps: [{ title: '메모 쓰기', text: '칸에 쓰고 메모 저장을 눌러요.', sources: ['F:web/src/App.tsx#L6-L7'] }],
        sections: [{ title: '메모 화면', where: '첫 화면', intro: '메모를 써요.', parts: [{ title: '', items: [{ name: '메모 저장', label: '메모 저장', what: '쓴 메모를 저장해요.', tip: '', sources: ['F:web/src/App.tsx#L7-L7', 'F:web/src/i18n/ko.ts#L3-L3'] }] }] }],
        faq: [], limits: [],
      };
    } else throw new Error(`예상하지 못한 호출: ${req.schemaName}`);
    return { data: req.schema.parse(data), provider: 'openrouter', model: 'fixture', durationMs: 1, costUsd: 0.001 };
  } };
  const paths = resolvePaths(path.join(tmp, 'state'));
  const store = new ConfigStore(paths); await store.load();
  const storage = new WikiStorage(paths.home);
  const index = { getProjectIds: (id: string) => [id] } as unknown as SessionIndex;
  const enrich = new EnrichService({ store, paths, providerOverride: provider });
  let revision = 'r1';
  let built = true;
  const repoService = {
    catalog: async (_id: string, _level: string, opts: { files?: boolean } = {}) => (built ? { revision, features: [feature], files: opts.files ? FILES : [] } : null),
    gate: async (allowed: { ok: boolean; reason?: string }) => (allowed.ok ? { ok: true, provider } : { ok: false, reason: allowed.reason ?? '권한 없음' }),
  } as unknown as RepoWikiService;
  const usage = new UsageGuideService({ storage, store, index, enrich, repo: repoService });
  const project: Project = { id: 'project', accountId: 'account', rootPath: root, name: '메모 앱', exists: true, providers: [], sessionCount: 0 };
  const wait = async (id: string) => {
    for (let n = 0; n < 200; n++) {
      const job = usage.jobs.get(id)!;
      if (!['queued', 'running'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('작업이 끝나지 않았습니다');
  };
  return { root, requests, usage, project, wait, setRevision: (r: string) => { revision = r; }, setBuilt: (b: boolean) => { built = b; } };
}

describe('어떻게 사용하나요?', () => {
  it('GET 은 AI 를 부르지 않고, 분석하기는 질문 계획 → 코드 읽기 → 후속 질문 → 안내 작성 순서로 만든다', async () => {
    const { root, requests, usage, project, wait, setRevision, setBuilt } = await setup();
    expect(await usage.get(project, 'junior', { ok: true })).toMatchObject({ page: null, stale: false, limits: REPO_USAGE_LIMITS });
    const preview = await usage.preview(project, 'junior', { ok: true });
    expect(preview.system).toContain('읽는 사람:');
    expect(preview.system).toContain('운영자·관리자 전용 화면');
    expect(preview.user).toContain('web/src/App.tsx');
    expect(requests).toHaveLength(0);

    const started = await usage.analyze(project, 'junior', { ok: true });
    expect((await wait(started.jobId)).state).toBe('done');
    expect(requests.map((r) => r.schemaName)).toEqual(['repo_usage_plan', 'repo_usage_round', 'repo_usage_round', 'repo_usage_page']);
    expect(requests.map((r) => r.task)).toEqual(['repo-inspect', 'repo-inspect', 'repo-inspect', undefined]);
    // 두 번째 단계는 AI 가 만든 후속 질문의 파일(문구 파일)을 읽어 보낸다
    expect(requests[2]!.user).toContain("save: '메모 저장'");
    for (const r of requests) {
      expect(r.user).not.toContain(SECRET);
      expect(r.trace?.feature).toBe('repo_usage');
      expect(r.system).toContain('읽는 사람:');
    }

    const after = await usage.get(project, 'junior', { ok: true });
    const page = after.page!;
    expect(page.sections[0]!.parts[0]!.items[0]).toMatchObject({ name: '메모 저장', label: '메모 저장' });
    expect(page.questions.map((q) => [q.round, q.question])).toEqual([[1, '첫 화면에 어떤 버튼이 있나요?'], [2, '저장 버튼 문구는?']]);
    expect(page.generator).toMatchObject({ calls: 4, rounds: 2, costUsd: 0.004 });
    expect(after.stale).toBe(false);
    // 수준별로 따로 저장한다
    expect((await usage.get(project, 'non-dev', { ok: true })).page).toBeNull();

    await fs.writeFile(path.join(root, 'web', 'src', 'App.tsx'), `${APP}\n// 바뀜\n`);
    expect(await usage.get(project, 'junior', { ok: true })).toMatchObject({ stale: true, staleReasons: [expect.stringContaining('web/src/App.tsx')] });
    setRevision('r2');
    expect((await usage.get(project, 'junior', { ok: true })).staleReasons).toContain('분석한 뒤 레포 위키가 업데이트되었습니다');
    expect(await usage.get(project, 'junior', { ok: false, reason: '권한 없음' })).toMatchObject({ unavailable: '권한 없음' });
    await expect(usage.analyze(project, 'junior', { ok: false, reason: '권한 없음' })).rejects.toMatchObject({ status: 409 });
    setBuilt(false);
    expect((await usage.get(project, 'junior', { ok: true })).unavailable).toContain('레포 위키를 먼저');
    await expect(usage.analyze(project, 'junior', { ok: true })).rejects.toMatchObject({ status: 409, code: 'wiki_missing' });
    expect(requests).toHaveLength(4);
  });
});
