import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoWiki } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { applyRepoAi, buildRepoAiPrompt } from '../../src/repo/ai';
import { scanRepo, type RepoScan } from '../../src/repo/scan';
import { buildRepoWiki, type RepoSessionDigest } from '../../src/repo/wiki';
import { caseA, snapshotOf } from '../wiki/helpers';

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-READ-1234567890';
let root: string;

async function write(rel: string, text: string) {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-repo-'));
  await write('package.json', JSON.stringify({ name: 'demo', description: '할 일 관리 앱', scripts: { dev: 'tsx src/server.ts', test: 'vitest run' }, dependencies: { react: '^19', hono: '^4', zod: '^4' }, devDependencies: { vitest: '^5' } }));
  await write('README.md', '# Demo\n\n[![ci](https://x/badge.svg)](https://x)\n\n할 일을 기록하고 마감일을 알려 주는 앱입니다.\n\n## 기능\n\n- 할 일 추가와 완료\n- **마감 알림**\n\n## 빠른 시작\n\n```bash\nnpm install\nnpm run dev\n```\n');
  await write('src/server.ts', `app.get('/users', (c) => {\n  return c.json({ users: [] });\n});\nrouter.post('/login', (c) => {\n  const token = '${SECRET}';\n  return c.json({ ok: true });\n});\n`);
  await write('app.py', "@app.route('/health')\ndef health(): pass\n");
  await write('src/components/List.tsx', 'export const List = () => null;\n');
  await write('tests/a.test.ts', "app.get('/test-only', h)\n");
  await write('.env.example', 'OPENAI_API_KEY=\n# DATABASE_URL=postgres://...\n');
  await write('.env', `OPENAI_API_KEY=${SECRET}\n`);
  await write('node_modules/x/index.js', "app.get('/from-deps', h)\n");
  await write('.git/HEAD', 'ref: refs/heads/main\n');
  await write('.git/refs/heads/main', 'abcdef1234567890abcdef\n');
  await fs.symlink('/etc', path.join(root, 'etc-link')).catch(() => {});
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('repo scan (read-only)', () => {
  let scan: RepoScan;
  beforeAll(async () => {
    scan = await scanRepo(root);
  });

  it('lists source files but skips dependency folders, .git and symlinks', () => {
    const paths = scan.files.map((f) => f.path);
    expect(scan.readable).toBe('ok');
    expect(paths).toEqual(expect.arrayContaining(['package.json', 'README.md', 'src/server.ts', 'app.py']));
    expect(paths.some((p) => p.startsWith('node_modules/') || p.startsWith('.git/') || p.startsWith('etc-link'))).toBe(false);
    expect(scan).toMatchObject({ head: 'abcdef123456', branch: 'main' });
  });

  it('never reads .env values, only the variable names in .env.example', () => {
    expect(scan.envExample).toEqual({ path: '.env.example', keys: ['OPENAI_API_KEY', 'DATABASE_URL'] });
    expect(JSON.stringify(scan)).not.toContain(SECRET);
    expect(JSON.stringify(scan)).not.toContain('postgres://');
  });

  it('extracts route definitions from source files, not tests or dependencies', () => {
    expect(scan.routes.map((r) => `${r.method} ${r.path} ${r.file}`)).toEqual(['ANY /health app.py', 'GET /users src/server.ts', 'POST /login src/server.ts']);
    const users = scan.routes.find((r) => r.path === '/users');
    expect(users).toMatchObject({ line: 1, endLine: 3 });
    expect(users?.code).toContain('return c.json({ users: [] })');
    expect(users?.code).not.toContain('/login');
    expect(scan.routes.find((r) => r.path === '/login')?.code).toContain("const token = '***'");
  });

  it('computes the same signature in light mode without reading contents', async () => {
    const light = await scanRepo(root, { light: true });
    expect(light.signature).toBe(scan.signature);
    expect(light.readme).toBeUndefined();
  });

  it('reports a missing folder as a state instead of failing', async () => {
    expect((await scanRepo(path.join(root, 'nope'))).readable).toBe('missing');
  });
});

describe('AI repo wiki input', () => {
  it('collects raw source blocks without template explanations or canned security advice', async () => {
    const scan = await scanRepo(root);
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [] });
    expect(wiki.generator.kind).toBe('pending');
    expect(wiki.user).toEqual([]);
    expect(wiki.system.every((s) => s.blocks.every((b) => b.kind === 'table' || b.kind === 'flow'))).toBe(true);
    const prompt = buildRepoAiPrompt({ draft: wiki, scan: { ...scan, code: [] }, sessions: [] }).user;
    expect(prompt).toContain('hono');
    expect(prompt).toContain('F:src/server.ts#L1-L3');
    expect(prompt).toContain('return c.json({ users: [] })');
    expect(prompt).not.toContain(SECRET);
  });
  it('requires source references for generated prose and keeps source blocks unchanged', async () => {
    const scan = await scanRepo(root);
    const draft = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [] });
    const output = applyRepoAi({ draft, handles: new Map(), fileSet: new Set(scan.files.map((f) => f.path)), result: { provider: 'openrouter', durationMs: 1 },
      output: { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], sections: [
        { id: 'overview', page: 'user', title: '이 프로젝트', paragraphs: ['AI가 자료를 읽고 설명합니다.'], items: [], sources: ['F:README.md', 'F:invented.ts'], sourceBlocks: [] },
        { id: 'mechanism', page: 'system', title: '파일 연결', paragraphs: [], items: [], sources: [], sourceBlocks: ['mechanism'] },
      ] } });
    expect(output.generator.kind).toBe('llm');
    expect(output.user[0]?.origin).toBe('llm');
    expect(output.system[0]?.blocks).toEqual(draft.system.find((s) => s.id === 'mechanism')?.blocks);
    expect(JSON.stringify(output)).not.toContain('invented.ts');
    expect(output.warnings).toHaveLength(1);
  });
  it('adds grounded descriptions between path and file without changing route identities or raw blocks', async () => {
    const originalScan = await scanRepo(root);
    const scan = { ...originalScan, routes: [...originalScan.routes,
      { file: 'src/server.ts', method: 'POST', path: '/users', line: 1 },
      { file: 'app.py', method: 'GET', path: '/users', line: 1 },
    ] };
    const draft = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [] });
    const before = JSON.stringify(draft);
    const output = applyRepoAi({ draft, handles: new Map(), fileSet: new Set(scan.files.map((f) => f.path)), result: { provider: 'openrouter', durationMs: 1 },
      output: { changes: [], flowGroups: [], flowNodes: [], sections: [{ id: 'requests', page: 'system', title: '서버의 요청 창구와 접근 검사', paragraphs: [], items: [], sources: [], sourceBlocks: ['api', 'mechanism'] }],
        routeDescriptions: [
          { method: 'POST', path: '/login', file: 'src/server.ts', description: `처리 결과를 응답합니다. ${SECRET}`, sources: ['F:src/server.ts'] },
          { method: 'GET', path: '/users', file: 'src/server.ts', description: '사용자 목록을 응답합니다.', sources: ['F:src/server.ts#L1-L3'] },
          { method: 'POST', path: '/users', file: 'src/server.ts', description: '다른 방식의 처리입니다.', sources: ['F:src/server.ts'] },
          { method: 'GET', path: '/users', file: 'app.py', description: '다른 파일의 처리입니다.', sources: ['F:app.py'] },
          { method: 'ANY', path: '/health', file: 'app.py', description: '확인되지 않은 설명', sources: ['F:app.py', 'F:app.py#L999-L1000'] },
          { method: 'DELETE', path: '/invented', file: 'src/server.ts', description: '존재하지 않는 경로', sources: ['F:src/server.ts'] },
          { method: 'GET', path: '/users', file: 'src/server.ts', description: '중복 설명', sources: ['F:src/server.ts'] },
        ] } });
    const table = output.system[0]?.blocks.find((b) => b.kind === 'table');
    expect(table?.head).toEqual(['방식', '경로', '동작 설명', '파일']);
    expect(table?.rows).toEqual([
      ['ANY', '/health', '설명을 생성하지 못했습니다.', 'app.py'],
      ['GET', '/users', '사용자 목록을 응답합니다.', 'src/server.ts'],
      ['POST', '/login', '처리 결과를 응답합니다. ***', 'src/server.ts'],
      ['POST', '/users', '다른 방식의 처리입니다.', 'src/server.ts'],
      ['GET', '/users', '다른 파일의 처리입니다.', 'app.py'],
    ]);
    expect(output.system[0]?.blocks.find((b) => b.kind === 'flow')).toEqual(draft.system.find((s) => s.id === 'mechanism')?.blocks[0]);
    expect(JSON.stringify(draft)).toBe(before);
    expect(JSON.stringify(output)).not.toContain(SECRET);
    expect(output.warnings).toHaveLength(1);
  });
});
