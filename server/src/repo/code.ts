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
      const from = /^\s*from\s+(\.*)([\w.]+)\s+import\b/.exec(line);
      if (from) {
        const dots = from[1]!.length;
        const base = dots ? `${'../'.repeat(Math.max(0, dots - 1))}./` : '/';
        addImport(base + from[2]!.replaceAll('.', '/'), index + 1);
      }
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

export function codeFlow(code: CodeFile[], entries: string[]): RepoFlow {
  const byPath = new Map(code.map((file) => [file.path, file]));
  const columns = new Map<string, number>();
  const queue = entries.filter((entry) => byPath.has(entry)).map((file) => ({ file, column: 0 }));
  if (!queue.length && code[0]) queue.push({ file: code[0].path, column: 0 });
  while (queue.length) {
    const { file, column } = queue.shift()!;
    if (columns.has(file)) continue;
    columns.set(file, Math.min(column, 3));
    for (const link of byPath.get(file)?.imports ?? []) if (byPath.has(link.path)) queue.push({ file: link.path, column: column + 1 });
  }
  for (const file of code) if (!columns.has(file.path)) columns.set(file.path, 3);
  const nodes = code.map((file) => ({ id: file.path, label: file.path, column: columns.get(file.path) ?? 0, source: file.excerpts[0]!.source }));
  const edges = code.flatMap((file) => file.imports.filter((link) => byPath.has(link.path)).map((link) => ({ from: file.path, to: link.path, label: '불러옴', source: { kind: 'file' as const, path: file.path, startLine: link.line, endLine: link.line, hash: file.hash } })));
  return { nodes, edges, limited: code.some((file) => file.imports.some((link) => !byPath.has(link.path))) };
}
