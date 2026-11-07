import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoWiki } from '@vibe-teacher/shared';
import { applyRepoAi, type RepoAiOutput } from '../../src/repo/ai';
import { askDbFeatureLinks } from '../../src/repo/db-link';
import { scanRepo } from '../../src/repo/scan';
import { buildRepoWiki } from '../../src/repo/wiki';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-READ-1234567890';
const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

/** notes·tags 표를 공통 저장 모듈(store.ts)에서 쓰고, 화면(page.ts)이 그 모듈을 불러오는 합성 저장소 */
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-repo-dblink-')); temps.push(root);
  const write = async (rel: string, text: string) => { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); };
  await write('package.json', JSON.stringify({ scripts: { start: 'node src/page.ts' } }));
  await write('db/schema.sql', 'create table notes (\n  id int primary key,\n  body text\n);\ncreate table tags (\n  id int primary key,\n  label text\n);\n');
  await write('src/store.ts', `const key = '${SECRET}';\nexport const notes = () => db.from('notes').select();\nexport const tags = () => db.from('tags').select();\n`);
  await write('src/page.ts', "import { notes } from './store';\nexport const page = () => notes();\n");
  await write('src/late.ts', "export const late = () => db.from('tags').insert({});\n");
  const scan = await scanRepo(root);
  const draft = buildRepoWiki({ project: { id: 'p', name: 'notes', rootPath: root }, scan, sessions: [] });
  const wiki: RepoWiki = { ...draft, features: [{ id: 'notes-page', name: '메모 화면', summary: '메모를 보여 줍니다.', files: [{ kind: 'file', path: 'src/page.ts' }], sessions: [], sources: [] }] };
  return { root, scan, draft, wiki, write };
}

const fake = (reply: (req: LlmRequest<unknown>) => unknown) => {
  const requests: LlmRequest<unknown>[] = [];
  const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
    requests.push(req as LlmRequest<unknown>);
    return { data: req.schema.parse(reply(req as LlmRequest<unknown>)), provider: 'claude-cli', model: 'fixture', durationMs: 3, costUsd: 0.001 };
  } };
  return { provider, requests };
};

describe('주요 기능과 이어지지 않은 표에 짧게 묻기', () => {
  it('표마다 질문을 만들고 쓰는 줄 앞뒤만 읽어 보내며, 바뀐 파일은 읽지 않는다', async () => {
    const { root, scan, draft, wiki, write } = await fixture();
    // 스캔 뒤 바뀐 파일은 줄 번호가 맞지 않으므로 보내지 않는다
    await write('src/late.ts', "// 바뀜\nexport const late = () => db.from('tags').insert({});\n");
    const { provider, requests } = fake(() => ({ answers: [
      { table: 'notes', answer: '메모 화면이 저장 모듈의 notes 로 이 표를 조회합니다.', sources: ['F:src/store.ts#L1-L4'], features: [{ id: 'notes-page', usage: '메모 목록을 조회합니다.', sources: ['F:src/store.ts#L2-L2'] }] },
      { table: 'tags', answer: '저장 모듈에서 tags 를 조회하지만 이 함수를 부르는 기능은 보이지 않습니다.', sources: ['F:src/store.ts#L1-L4'], features: [] },
      { table: 'ghost', answer: '묻지 않은 표', sources: [], features: [] },
    ], newFeatures: [] }));
    const links = await askDbFeatureLinks({ root, draft, wiki, tableIds: ['notes', 'tags'], files: scan.files.map((f) => f.path), importers: scan.database!.importers, provider, level: 'non-dev' });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.task).toBe('repo-inspect');
    expect(req.schemaName).toBe('repo_wiki_db_links');
    expect(req.system).toContain('읽는 사람:');
    expect(req.user).not.toContain(SECRET);
    const sent = JSON.parse(req.user) as { features: unknown[]; newFeatureSlots: number; questions: { table: string; question: string; columns: string[]; code: { ref: string; code: string; importedBy: string[] }[] }[] };
    expect(sent.features).toEqual([{ id: 'notes-page', name: '메모 화면', summary: '메모를 보여 줍니다.', files: ['F:src/page.ts'] }]);
    expect(sent.newFeatureSlots).toBe(15);
    expect(sent.questions.map((q) => [q.table, q.question, q.columns])).toEqual([
      ['notes', '이 표(notes)는 지금 주요 기능 중 무엇과 관계가 있나요?', ['id', 'body']],
      ['tags', '이 표(tags)는 지금 주요 기능 중 무엇과 관계가 있나요?', ['id', 'label']],
    ]);
    // 가까운 줄은 한 발췌를 함께 쓰고, 그 파일을 불러오는 파일과 그 파일이 속한 주요 기능을 알려 준다.
    // 저장 모듈의 notes() 를 부르는 화면 코드(page.ts)도 이 표를 쓰는 곳으로 함께 보낸다
    const notes = sent.questions[0]!.code, tags = sent.questions[1]!.code;
    expect(notes.map((c) => c.ref)).toEqual(['F:src/store.ts#L1-L4', 'F:src/page.ts#L1-L3']);
    expect(tags.map((c) => c.ref)).toEqual(['F:src/store.ts#L1-L4']);
    expect(notes[0]!.importedBy).toEqual(['F:src/page.ts (주요 기능: notes-page)']);
    expect(notes[0]!.code).toContain("db.from('notes')");
    expect(links.asked).toEqual(['notes', 'tags']);
    expect(links.output?.answers.map((a) => a.table)).toEqual(['notes', 'tags']);
    expect(links.sources).toEqual([expect.objectContaining({ path: 'src/store.ts', startLine: 1, endLine: 4 }), expect.objectContaining({ path: 'src/page.ts', startLine: 1, endLine: 3 })]);
    expect(links).toMatchObject({ durationMs: 3, costUsd: 0.001, warnings: [] });

    // 답을 위키에 입힌다: 근거가 확인된 기능 연결은 싣고, 잇지 못한 표에는 받은 답을 보여 준다
    const output: RepoAiOutput = { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], features: [{ id: 'notes-page', name: '메모 화면', summary: '메모를 보여 줍니다.', files: ['F:src/page.ts'], sessions: [], sources: ['F:src/page.ts'] }],
      databaseTables: ['notes', 'tags'].map((table) => ({ table, description: `${table} 를 저장합니다.`, sources: ['F:db/schema.sql'], columns: [], features: links.output!.answers.find((a) => a.table === table)!.features })),
      sections: [{ id: 'data', page: 'system', title: '데이터', paragraphs: ['저장합니다.'], items: [], sources: ['F:db/schema.sql'], sourceBlocks: ['database'] }] };
    const applied = applyRepoAi({ draft, output, handles: new Map(), fileSet: new Set(scan.files.map((f) => f.path)), result: { provider: 'claude-cli', durationMs: 1 }, additionalSources: links.sources,
      dbAnswers: [...links.output!.answers, { table: 'notes', answer: '두 번째 답은 쓰지 않습니다.', sources: [], features: [] }, { table: 'tags', answer: '근거 없는 답', sources: ['F:README.md'], features: [] }] });
    const tables = applied.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []));
    expect(tables.find((t) => t.id === 'notes')).toMatchObject({ features: [{ featureId: 'notes-page', usage: '메모 목록을 조회합니다.' }] });
    expect(tables.find((t) => t.id === 'notes')?.linkAnswer).toBeUndefined();
    expect(tables.find((t) => t.id === 'tags')?.linkAnswer).toEqual({ text: '저장 모듈에서 tags 를 조회하지만 이 함수를 부르는 기능은 보이지 않습니다.', sources: [expect.objectContaining({ path: 'src/store.ts', startLine: 1, endLine: 4 })] });
  });

  it('물어볼 발췌가 없으면 부르지 않고, 호출이 실패하면 경고만 남기며, 취소는 그대로 전한다', async () => {
    const { root, scan, draft, wiki } = await fixture();
    const base = { root, draft, wiki, files: scan.files.map((f) => f.path), importers: scan.database!.importers, level: 'non-dev' as const };
    const idle = fake(() => ({ answers: [], newFeatures: [] }));
    expect((await askDbFeatureLinks({ ...base, tableIds: ['missing'], provider: idle.provider })).output).toBeNull();
    // 읽을 수 있는 파일 목록에 없는 파일은 읽지 않는다
    expect((await askDbFeatureLinks({ ...base, files: [], tableIds: ['notes'], provider: idle.provider })).output).toBeNull();
    expect(idle.requests).toHaveLength(0);

    const failing = fake(() => { throw new Error('CLI 실패'); });
    const failed = await askDbFeatureLinks({ ...base, tableIds: ['notes'], provider: failing.provider });
    expect(failed.output).toBeNull();
    expect(failed.warnings).toEqual(['주요 기능과 이어지지 않은 데이터베이스 표를 AI에 물어보지 못했습니다: CLI 실패']);

    const cancelled = fake(() => { throw new LlmError('cancelled', '취소'); });
    await expect(askDbFeatureLinks({ ...base, tableIds: ['notes'], provider: cancelled.provider })).rejects.toThrow('취소');
  });
});
