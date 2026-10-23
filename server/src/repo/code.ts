import path from 'node:path';
import ts from 'typescript';
import type { RepoFlow, RepoSource } from '@vibe-teacher/shared';
import { resolveRel, splitCommands } from '../lib/shell';
import type { PackageInfo } from './scan';

type FileSource = Extract<RepoSource, { kind: 'file' }>;
export interface CodeExcerpt { text: string; source: FileSource }
export interface CodeFile {
  path: string;
  hash: string;
  imports: { path: string; line: number }[];
  symbols: { name: string; line: number }[];
  excerpts: CodeExcerpt[];
}

/** 실제로 있는 상대 경로만 연결한다. 경로 별칭·외부 패키지는 추측하지 않는다. */
function localTarget(file: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const base = path.posix.normalize(specifier.startsWith('/') ? specifier.slice(1) : path.posix.join(path.posix.dirname(file), specifier));
  if (base.startsWith('../')) return null;
  const stems = [base, base.replace(/\.[cm]?jsx?$/, '')];
  for (const stem of stems) {
    for (const candidate of [stem, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'].map((ext) => stem + ext), ...['index.ts', 'index.tsx', 'index.js', '__init__.py'].map((name) => `${stem}/${name}`)]) {
      if (files.has(candidate)) return candidate;
    }
  }
  return null;
}

/** `import` 뒤의 이름 목록. 괄호로 여러 줄에 걸친 목록과 줄 끝 `\` 이어 쓰기를 따라가고 `as` 별칭·주석·`*` 는 뺀다. */
function pythonImportNames(rest: string, lines: string[], index: number): string[] {
  const strip = (text: string) => text.replace(/#.*$/, '');
  let text = strip(rest);
  for (let next = index + 1; next < lines.length && next <= index + 40 && (text.includes('(') ? !text.includes(')') : /\\\s*$/.test(text)); next++) {
    text = `${text.replace(/\\\s*$/, ' ')} ${strip(lines[next]!)}`;
  }
  return text.replace(/[()\\]/g, ' ').split(',').map((part) => /^\s*(\w+)/.exec(part)?.[1]).filter((name): name is string => !!name);
}

export function inspectCode(file: string, text: string, hash: string, files: ReadonlySet<string>): CodeFile {
  const imports: CodeFile['imports'] = [];
  const symbols: CodeFile['symbols'] = [];
  const lines = text.split(/\r?\n/);
  const addImport = (specifier: string, line: number) => {
    const target = localTarget(file, specifier, files);
    if (target && target !== file && !imports.some((item) => item.path === target)) imports.push({ path: target, line });
  };
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const names = clause?.namedBindings;
        const onlyTypes = clause?.isTypeOnly || (!clause?.name && names && ts.isNamedImports(names) && names.elements.length > 0 && names.elements.every((item) => item.isTypeOnly));
        if (!onlyTypes) addImport(node.moduleSpecifier.text, lineOf(node));
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text, lineOf(node));
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) addImport(arg.text, lineOf(node));
      }
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) symbols.push({ name: node.name.text, line: lineOf(node) });
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) symbols.push({ name: node.name.text, line: lineOf(node) });
      ts.forEachChild(node, visit);
    };
    visit(source);
  } else if (file.endsWith('.html')) {
    for (const match of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) addImport(match[1]!.startsWith('/') ? `.${match[1]!}` : match[1]!, text.slice(0, match.index).split('\n').length);
  } else if (file.endsWith('.py')) {
    lines.forEach((line, index) => {
      const symbol = /^\s*(?:async\s+)?(?:def|class)\s+(\w+)/.exec(line);
      if (symbol) symbols.push({ name: symbol[1]!, line: index + 1 });
      const from = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/.exec(line);
      if (!from || (!from[1] && !from[2])) return;
      const dots = from[1]!.length;
      const base = dots ? `${'../'.repeat(Math.max(0, dots - 1))}./` : '/';
      const module = base + from[2]!.replaceAll('.', '/');
      // `from . import a` 는 자기 패키지가 아니라 하위 모듈 a 를 가져오므로 모듈 자체는 잇지 않는다
      if (from[2]) addImport(module, index + 1);
      // `from .steps import load` 처럼 가져온 이름이 실제 하위 모듈 파일이면 그 파일도 잇는다 (함수·클래스 이름은 파일이 없어 걸러진다)
      for (const name of pythonImportNames(from[3]!, lines, index)) addImport(`${module.endsWith('/') ? module : `${module}/`}${name}`, index + 1);
    });
  }
  const anchors = [...new Set([1, symbols[0]?.line ?? 1])].filter((line, index, all) => index === 0 || line > all[0]! + 20);
  const excerpts = anchors.slice(0, 2).map((line) => {
    const start = Math.max(0, line - 3);
    const chunk: string[] = [];
    let chars = 0;
    for (const current of lines.slice(start, start + 32)) {
      if (chars + current.length > 1800) break;
      chunk.push(current); chars += current.length + 1;
    }
    return { text: chunk.join('\n'), source: { kind: 'file' as const, path: file, startLine: start + 1, endLine: start + Math.max(1, chunk.length), hash } };
  });
  return { path: file, hash, imports, symbols: symbols.slice(0, 12), excerpts };
}

export function entryPaths(packages: PackageInfo[], files: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const pkg of packages) {
    const html = path.posix.join(path.posix.dirname(pkg.path), 'index.html');
    if (files.has(html)) out.push(html);
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (!['start', 'dev', 'serve'].includes(name)) continue;
      const virtualRoot = '/__repo__';
      for (const command of splitCommands(script, path.posix.join(virtualRoot, path.posix.dirname(pkg.path)))) for (const arg of command.argv) {
        if (!/\.[cm]?[jt]sx?$|\.py$/.test(arg)) continue;
        const absolute = resolveRel(command.cwd, arg);
        if (!absolute?.startsWith(`${virtualRoot}/`)) continue;
        const target = absolute.slice(virtualRoot.length + 1);
        if (files.has(target)) out.push(target);
      }
    }
    if (pkg.main) {
      const target = path.posix.join(path.posix.dirname(pkg.path), pkg.main);
      if (files.has(target)) out.push(target);
    }
  }
  for (const candidate of ['web/index.html', 'index.html', 'server/src/index.ts', 'src/main.tsx', 'src/main.ts', 'src/index.ts', 'src/index.js', 'main.py', 'app.py']) if (files.has(candidate)) out.push(candidate);
  return [...new Set(out)];
}

/** 시작 파일에서 이어지는 연결을 우선하고, 그림과 AI 입력에 같은 범위를 쓴다. */
export function selectCode(all: CodeFile[], entries: string[], max = 18): CodeFile[] {
  const byPath = new Map(all.map((file) => [file.path, file]));
  const queue = entries.filter((entry) => byPath.has(entry));
  const selected: CodeFile[] = [];
  const seen = new Set<string>();
  while (queue.length && selected.length < max) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const code = byPath.get(current);
    if (!code) continue;
    selected.push(code);
    queue.push(...code.imports.map((item) => item.path));
  }
  for (const file of all.slice().sort((a, b) => b.imports.length - a.imports.length)) {
    if (selected.length >= max) break;
    if (!seen.has(file.path)) { selected.push(file); seen.add(file.path); }
  }
  return selected;
}

/** 폴더 안에서 시작 파일 역할을 하는 이름 (패키지 실행·초기화 파일, 모듈 진입 파일) */
const FOLDER_ENTRY = /^(?:__main__|__init__|main|app)\.py$|^(?:index|main)\.[cm]?[jt]sx?$|^index\.html$/;

export function codeFlow(code: CodeFile[], entries: string[]): RepoFlow {
  const byPath = new Map(code.map((file) => [file.path, file]));
  const columns = new Map<string, number>();
  const layer = (starts: string[], first: number) => {
    const queue = starts.map((file) => ({ file, column: first }));
    while (queue.length) {
      const { file, column } = queue.shift()!;
      if (columns.has(file)) continue;
      columns.set(file, Math.min(column, 3));
      for (const link of byPath.get(file)?.imports ?? []) if (byPath.has(link.path)) queue.push({ file: link.path, column: column + 1 });
    }
  };
  const starts = entries.filter((entry) => byPath.has(entry));
  layer(starts.length ? starts : code.slice(0, 1).map((file) => file.path), 0);
  // 시작 파일에서 닿지 않는 파일만 모인 폴더는 그 폴더의 __main__.py·__init__.py·index.ts 같은 파일을 시작 파일(0열)로 본다.
  // 바깥 폴더부터 하나씩 정하고, 이미 닿은 파일이 들어 있는 폴더는 건너뛴다.
  const folderEntries = (rest: CodeFile[]): string[] => {
    const candidates = rest.filter((file) => FOLDER_ENTRY.test(path.posix.basename(file.path))).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const candidate of candidates) {
      const dir = path.posix.dirname(candidate.path);
      const prefix = dir === '.' ? '' : `${dir}/`;
      if (code.some((file) => columns.has(file.path) && file.path.startsWith(prefix))) continue;
      return candidates.filter((file) => path.posix.dirname(file.path) === dir).map((file) => file.path);
    }
    return [];
  };
  // 그래도 남은 파일은 한 열에 몰지 않고, 남은 파일끼리 불려오지 않는 파일부터 다시 층을 나눈다.
  // 0열은 시작 파일 자리이므로 1열부터 쓰고, 순환만 남으면 가장 많이 불러오는 파일에서 시작한다.
  for (let rest = code.filter((file) => !columns.has(file.path)); rest.length; rest = rest.filter((file) => !columns.has(file.path))) {
    const local = folderEntries(rest);
    if (local.length) { layer(local, 0); continue; }
    const imported = new Set(rest.flatMap((file) => file.imports.map((link) => link.path)));
    const roots = rest.filter((file) => !imported.has(file.path));
    layer((roots.length ? roots : [rest.reduce((a, b) => (b.imports.length > a.imports.length ? b : a))]).map((file) => file.path), 1);
  }
  const nodes = code.map((file) => ({ id: file.path, label: file.path, column: columns.get(file.path) ?? 0, source: file.excerpts[0]!.source }));
  const edges = code.flatMap((file) => file.imports.filter((link) => byPath.has(link.path)).map((link) => ({ from: file.path, to: link.path, label: '불러옴', source: { kind: 'file' as const, path: file.path, startLine: link.line, endLine: link.line, hash: file.hash } })));
  return { nodes, edges, limited: code.some((file) => file.imports.some((link) => !byPath.has(link.path))) };
}
