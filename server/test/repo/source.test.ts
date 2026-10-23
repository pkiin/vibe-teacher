import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskSecrets } from '../../src/llm/digest';
import { codeFlow, entryPaths, inspectCode, selectCode } from '../../src/repo/code';
import { MAX_SOURCE_BYTES, readRepoText, readableRepoPath, repoFileView } from '../../src/repo/source';
import { scanRepo } from '../../src/repo/scan';
import { buildRepoWiki } from '../../src/repo/wiki';
import { applyRepoAi, buildRepoAiPrompt } from '../../src/repo/ai';

let root: string;
const SECRET = 'sk-test-abcdefghijklmnopqrstuvwxyz123456';
const write = async (relative: string, text: string) => { await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.writeFile(path.join(root, relative), text); };
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-source-'));
  await write('README.md', '# 앱\n\n설명을 보여 줍니다.');
  await write('package.json', JSON.stringify({ scripts: { start: 'node src/main.ts' } }));
  await write('src/main.ts', `import { answer } from './service.js';\n// import fake from './fake';\nexport async function main() {\n  return answer();\n}\nconst API_KEY = '${SECRET}';\n`);
  await write('src/service.ts', "export function answer() {\n  return '안녕하세요';\n}\n");
  await write('src/private-key.ts', `export const key = '${SECRET}';`);
  await write('src/fake.ts', "throw new Error('실행하면 안 됩니다');");
  await write('.env', `API_KEY=${SECRET}`);
  await write('.env.example', `API_KEY=${SECRET}\n# DATABASE_URL=postgres://private\n`);
  await write('.aws/config.json', `{"token":"${SECRET}"}`);
  await write('large.txt', '한글'.repeat(MAX_SOURCE_BYTES));
  await write('binary.txt', 'a\0b');
  await fs.symlink(os.tmpdir(), path.join(root, 'outside'));
  await fs.symlink(path.join(root, 'README.md'), path.join(root, 'link.md'));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe('repository evidence reader', () => {
  it('only permits text within the repository and rejects secrets, traversal and links', async () => {
    for (const file of ['../README.md', '/etc/passwd', 'src/../../README.md', 'src\\main.ts', '.env', '.aws/config.json', 'src/private-key.ts', 'outside/anything.txt', 'link.md', 'binary.txt', 'src/./main.ts', 'src//main.ts']) expect(await readRepoText(root, file), file).toBeNull();
    expect(readableRepoPath('README.md')).toBe(true);
    expect(readableRepoPath('src/main.ts')).toBe(true);
    expect(readableRepoPath('node_modules/lib/code.js')).toBe(false);
  });
  it('masks keys and preserves line numbers, and shows example variable names only', async () => {
    const file = await repoFileView(root, 'src/main.ts', 3);
    expect(file).toMatchObject({ startLine: 3, masked: true });
    expect(file?.lines[0]).toContain('export async function main');
    expect(JSON.stringify(file)).not.toContain(SECRET);
    const example = await readRepoText(root, '.env.example');
    expect(example?.text).toBe('API_KEY=…\nDATABASE_URL=…');
    expect(JSON.stringify(example)).not.toContain('postgres://');
    const pem = 'before\n-----BEGIN PRIVATE KEY-----\nsynthetic-private-data\n-----END PRIVATE KEY-----\nafter';
    const masked = maskSecrets(pem);
    expect(masked).not.toContain('synthetic-private-data');
    expect(masked.split('\n')).toHaveLength(pem.split('\n').length);
    expect(masked.split('\n')[4]).toBe('after');
  });
  it('bounds large files and paginates without changing their line numbers', async () => {
    expect((await readRepoText(root, 'large.txt'))?.truncated).toBe(true);
    await write('lines.txt', Array.from({ length: 1200 }, (_, index) => `행 ${index + 1}`).join('\n'));
    const file = await repoFileView(root, 'lines.txt', 502);
    expect(file).toMatchObject({ startLine: 502, endLine: 1001, lineCount: 1200 });
    expect(file?.lines[0]).toBe('행 502');
  });
});

describe('code evidence and flow', () => {
  it('resolves start scripts in their actual workspace and cd directory', () => {
    expect(entryPaths([{ path: 'package.json', scripts: { start: 'cd server && node src/main.ts' }, dependencies: [], devDependencies: [], workspaces: [] }], new Set(['server/src/main.ts']))).toEqual(['server/src/main.ts']);
  });
  it('parses real imports instead of comments, resolves TS source targets and keeps exact lines', async () => {
    const file = (await readRepoText(root, 'src/main.ts'))!;
    const code = inspectCode('src/main.ts', file.text, file.hash, new Set(['src/main.ts', 'src/service.ts', 'src/fake.ts']));
    expect(code.imports).toEqual([{ path: 'src/service.ts', line: 1 }]);
    expect(code.symbols[0]).toEqual({ name: 'main', line: 3 });
    expect(code.excerpts[0]?.source).toMatchObject({ path: 'src/main.ts', startLine: 1, hash: file.hash });
    expect(JSON.stringify(code)).not.toContain(SECRET);
  });
  it('handles cycles and missing external modules without inventing edges', () => {
    const files = new Set(['a.ts', 'b.ts']);
    const a = inspectCode('a.ts', "import './b'; import 'external';", 'a', files);
    const b = inspectCode('b.ts', "import './a';", 'b', files);
    const selected = selectCode([a, b], ['a.ts']);
    const graph = codeFlow(selected, ['a.ts']);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges.map((edge) => `${edge.from}:${edge.to}`)).toEqual(['a.ts:b.ts', 'b.ts:a.ts']);
  });
  it('leaves type-only imports out of the runtime file connection graph', () => {
    const files = new Set(['a.ts', 'types.ts', 'runtime.ts']);
    const code = inspectCode('a.ts', "import type { Config } from './types'; import { type Result } from './types'; import { run, type Options } from './runtime';", 'a', files);
    expect(code.imports).toEqual([{ path: 'runtime.ts', line: 1 }]);
  });
  it('includes actual code in the AI digest and preserves the flow and line citations', async () => {
    const scan = await scanRepo(root);
    expect(scan.code?.find((file) => file.path === 'src/main.ts')?.imports[0]?.path).toBe('src/service.ts');
    expect(JSON.stringify(scan.code)).not.toContain(SECRET);
    expect(scan.code?.some((file) => file.path.includes('private-key'))).toBe(false);
    const draft = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [], previous: null });
    const { user, handles } = buildRepoAiPrompt({ draft, scan, sessions: [] });
    expect(user).toContain('return answer()');
    expect(user).toContain('F:src/main.ts#L1-L');
    expect(user).not.toContain(SECRET);
    const section = draft.system.find((item) => item.id === 'mechanism')!;
    const source = section.sources.find((ref) => ref.kind === 'file' && ref.path === 'src/main.ts')!;
    if (source.kind !== 'file') throw new Error('파일 근거 필요');
    const output = applyRepoAi({ draft, output: { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], sections: [{ id: 'mechanism', page: 'system', title: '코드 연결', sources: [], sourceBlocks: ['mechanism'], paragraphs: ['시작 코드가 응답 처리 함수를 불러옵니다.'], items: [{ text: '코드', detail: '', sources: [`F:${source.path}#L${source.startLine}-L${source.endLine}`, 'F:src/main.ts#L999-L1000'] }] }] }, handles, fileSet: new Set(scan.files.map((file) => file.path)), result: { provider: 'openai', durationMs: 1 } });
    const updated = output.system.find((item) => item.id === 'mechanism')!;
    expect(updated.blocks.find((block) => block.kind === 'flow')).toEqual(section.blocks.find((block) => block.kind === 'flow'));
    expect(updated.sources).toContainEqual(source);
    expect(JSON.stringify(updated)).not.toContain('999');
    expect(output.warnings.join(' ')).toContain('출처를 확인할 수 없거나 중복된');
  });
});
