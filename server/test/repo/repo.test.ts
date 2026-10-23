import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoWiki } from '@vibe-teacher/shared';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { applyRepoAi, buildRepoAiPrompt } from '../../src/repo/ai';
import { scanRepo, type RepoScan } from '../../src/repo/scan';
import { buildRepoWiki, diffFacts, parseMarkdown, type RepoSessionDigest } from '../../src/repo/wiki';
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
  await write('src/server.ts', "app.get('/users', h)\nrouter.post(\"/login\", h)\n");
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

describe('repo wiki pages', () => {
  const session = caseA();
  const digest = (over: Partial<RepoSessionDigest> = {}): RepoSessionDigest => ({
    key: session.key,
    title: '관리자 화면 추가',
    at: '2026-10-18T09:00:00.000Z',
    request: '관리자 화면을 추가해 줘',
    oneLiner: '관리자 화면을 만들었습니다.',
    features: [{ name: '관리자 회원 목록', detail: '관리자가 회원을 봅니다' }],
    built: summarizeBuilt(session, '/home/tester'),
    findings: snapshotOf(session).findings,
    securityReviewed: true,
    ...over,
  });

  it('builds a user-facing page from README, scripts, settings, risks and history', async () => {
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan: await scanRepo(root), sessions: [digest()], previous: null });
    const sec = (id: string) => wiki.user.find((s) => s.id === id)!;
    expect(wiki.user.map((s) => s.id)).toEqual(['overview', 'features', 'usage', 'config', 'cautions', 'security', 'history']);
    expect(JSON.stringify(sec('overview').blocks)).toContain('할 일을 기록하고 마감일을 알려 주는 앱입니다.');
    expect(JSON.stringify(sec('overview').blocks)).not.toContain('badge.svg');
    expect(JSON.stringify(sec('features').blocks)).toContain('마감 알림');
    expect(JSON.stringify(sec('features').blocks)).toContain('관리자 회원 목록');
    expect(JSON.stringify(sec('usage').blocks)).toContain('npm run dev');
    expect(JSON.stringify(sec('config').blocks)).toContain('OPENAI_API_KEY');
    expect(JSON.stringify(sec('cautions').blocks)).toContain('접근 권한 검사 위치 미확인');
    expect(wiki.changes).toEqual(['처음 만들었습니다.']);
    expect(JSON.stringify(wiki)).not.toContain(SECRET);
  });

  it('builds a behavior page: structure, stack, entry points, routes, data, tests, risks', async () => {
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan: await scanRepo(root), sessions: [digest()], previous: null });
    const sec = (id: string) => JSON.stringify(wiki.system.find((s) => s.id === id)?.blocks ?? []);
    expect(wiki.system.map((s) => s.id)).toEqual(['structure', 'stack', 'entry', 'mechanism', 'api', 'data', 'quality', 'risks']);
    expect(sec('structure')).toContain('src/');
    expect(sec('stack')).toContain('React — 화면 구성');
    expect(sec('entry')).toContain('시작 파일: src/server.ts');
    expect(sec('api')).toContain('/login');
    expect(sec('data')).toContain('환경 변수로 받는 설정');
    expect(sec('quality')).toContain('테스트 파일 1개');
    expect(sec('risks')).toContain('[보안] 접근 권한 검사 위치 미확인');
  });

  it('falls back to session records when the repository cannot be read', async () => {
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: '/nope' }, scan: await scanRepo('/nonexistent/vt'), sessions: [digest()], previous: null });
    expect(wiki.warnings[0]).toContain('세션 기록만으로');
    expect(JSON.stringify(wiki.user[0]!.blocks)).toContain('관리자 화면을 만들었습니다.');
  });

  it('describes what changed since the previous version', async () => {
    const scan = await scanRepo(root);
    const first: RepoWiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [digest()], previous: null });
    const second = buildRepoWiki({
      project: { id: 'p', name: 'demo', rootPath: root },
      scan: { ...scan, packages: scan.packages.map((p) => ({ ...p, scripts: { ...p.scripts, lint: 'eslint .' } })) },
      sessions: [digest({ key: 'new-session', title: '알림 기능', features: [{ name: '마감 메일', detail: '' }] }), digest()],
      previous: first,
    });
    expect(second.changes.join('\n')).toContain('새 세션 1개 반영: 알림 기능');
    expect(second.changes.join('\n')).toContain('기능 추가: 마감 메일');
    expect(second.changes.join('\n')).toContain('실행 명령 추가: npm run lint');
    expect(diffFacts(first.facts, first.facts, [])).toEqual(['내용상 달라진 점이 없습니다.']);
  });

  it('prefers the bullet list at the top of README over sections that merely mention a feature', async () => {
    const scan = await scanRepo(root);
    const md = '# App\n\n소개 문단입니다.\n\n- 기록을 읽어 보여 주고\n- 개념을 설명하는\n\n## 실험 기능\n\n- 이건 기능 목록이 아님\n';
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan: { ...scan, readme: { path: 'README.md', text: md } }, sessions: [], previous: null });
    const feats = JSON.stringify(wiki.user.find((s) => s.id === 'features')!.blocks);
    expect(feats).toContain('기록을 읽어 보여 주고');
    expect(feats).not.toContain('이건 기능 목록이 아님');
  });

  it('lets AI rewrite the sentences but keeps commands and tables from the repository as they are', async () => {
    const scan = await scanRepo(root);
    const draft = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [digest()], previous: null });
    const { user, handles } = buildRepoAiPrompt({ draft, scan, sessions: [digest()] });
    expect(user).toContain('S1 |');
    expect(user).toContain('[코드 블록 — 그대로 유지됨]');
    expect(user).not.toContain(SECRET);
    const usage = draft.user.find((s) => s.id === 'usage')!;
    const facts = usage.blocks.filter((b) => b.kind === 'code' || b.kind === 'table');
    expect(facts.length).toBeGreaterThan(0);
    const out = applyRepoAi({
      draft,
      output: { sections: [{ id: 'usage', paragraphs: ['`npm install` 로 설치한 뒤 `npm run dev` 로 실행합니다.'], items: [{ text: '개발 서버', detail: '', sources: ['F:package.json', 'F:../../etc/passwd'] }] }] },
      handles,
      fileSet: new Set(scan.files.map((f) => f.path)),
      result: { provider: 'claude-cli', durationMs: 1 },
    });
    const next = out.user.find((s) => s.id === 'usage')!;
    expect(next.origin).toBe('llm');
    expect(next.blocks[0]).toEqual({ kind: 'text', text: '`npm install` 로 설치한 뒤 `npm run dev` 로 실행합니다.' });
    expect(next.blocks.filter((b) => b.kind === 'code' || b.kind === 'table')).toEqual(facts);
    expect(JSON.stringify(next.blocks)).not.toContain('etc/passwd');
    expect(out.user.find((s) => s.id === 'overview')!.origin).toBe('rule');
  });

  it('parses README headings outside code fences only', () => {
    const md = parseMarkdown('# T\n\nintro\n\n## A\n```\n# not a heading\n```\n## B\n');
    expect(md.title).toBe('T');
    expect(md.sections.map((s) => s.heading)).toEqual(['A', 'B']);
  });

  it('keeps security concerns from each session and distinguishes missing review coverage', async () => {
    const scan = await scanRepo(root);
    const first = digest();
    const second = digest({ key: 'second-session', title: '새 작업' });
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [first, second, digest({ key: 'unreviewed', findings: [], securityReviewed: false })], previous: null });
    const security = wiki.user.find((s) => s.id === 'security')!;
    expect(JSON.stringify(security)).toContain('3개 중 위키가 만들어진 2개');
    const findings = security.blocks.find((b) => b.kind === 'list');
    expect(findings?.kind === 'list' && findings.items.flatMap((item) => item.sources ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: first.key }), expect.objectContaining({ key: second.key }),
    ]));
    expect(JSON.stringify(security)).toContain('확인 방법:');
    expect(JSON.stringify(security)).toContain('더 필요한 자료:');
    expect(JSON.stringify(security)).toContain('공개된 보안 공지');

    const out = applyRepoAi({ draft: wiki, output: { sections: [{ id: 'security', paragraphs: ['모든 보안 검사를 통과했습니다.'], items: [] }] }, handles: new Map(), fileSet: new Set(), result: { provider: 'openai', durationMs: 1 } });
    expect(out.user.find((s) => s.id === 'security')).toEqual(security);
  });

  it('does not describe an empty or resolved finding list as a clean vulnerability scan', async () => {
    const first = digest();
    const wiki = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan: await scanRepo(root), sessions: [digest({ findings: first.findings.map((f) => ({ ...f, lifecycle: 'resolved_in_scope' })) })], previous: null });
    const security = wiki.user.find((s) => s.id === 'security')!;
    const text = JSON.stringify(security);
    expect(text).toContain('안전하다는 뜻은 아닙니다');
    expect(text).toContain('자동으로 검사하지 않습니다');
    expect(text).not.toContain('접근 권한 검사 위치 미확인');
  });

  it('changes the revision when review coverage or finding details change without a source file change', async () => {
    const scan = await scanRepo(root);
    const build = (session: RepoSessionDigest) => buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: root }, scan, sessions: [session], previous: null });
    const first = build(digest({ securityReviewed: false, findings: [] }));
    const reviewed = build(digest({ findings: [] }));
    const concerns = build(digest());
    const recheck = build(digest({ findings: digest().findings.map((f) => ({ ...f, lifecycle: 'recheck_required' })) }));
    expect(new Set([first.revision, reviewed.revision, concerns.revision, recheck.revision]).size).toBe(4);
  });
});
