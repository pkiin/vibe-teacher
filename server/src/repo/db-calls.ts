import ts from 'typescript';
import { maskSecrets } from '../llm/digest';
import type { DbSourceFile, DbUsage } from './database';

/**
 * 표를 쓰는 줄이 공용 모듈(저장소 클래스·기록 모듈 등) 안에 있으면, 그 모듈의 함수·메서드를 다른 파일에서 부르는 줄을 찾는다.
 * 기능 코드는 저장소를 넘겨받아(storage.readJson(...)) 쓰므로 import 관계만으로는 어느 기능이 그 표를 쓰는지 보이지 않는다.
 *   1. 모듈을 TypeScript 구문으로 읽어, 표를 쓰는 줄을 감싸는 이름 있는 함수·메서드를 찾는다
 *   2. 같은 파일 안에서 그 함수를 부르는 함수를 세 단계까지 따라간다 (private 도우미 → 공개 메서드)
 *   3. 공개된 이름을 다른 파일에서 부르는 줄(x.name(...), 불러온 함수 name(...))을 파일마다 하나씩 모은다
 * 코드를 실행하지 않고, 흔한 이름(call·get·list 등)은 따라가지 않는다.
 */
export const DB_CALL_LIMITS = { depth: 3, filesPerTable: 12, minName: 4 } as const;

const STOP = new Set(['call', 'then', 'catch', 'finally', 'bind', 'apply', 'push', 'pop', 'shift', 'slice', 'splice', 'join', 'split', 'map', 'filter', 'reduce', 'some', 'every', 'find', 'forEach',
  'get', 'set', 'has', 'add', 'delete', 'clear', 'keys', 'values', 'entries', 'list', 'read', 'write', 'load', 'save', 'send', 'fetch', 'json', 'text', 'init', 'start', 'stop', 'close', 'open', 'next',
  'emit', 'on', 'off', 'once', 'run', 'test', 'exec', 'match', 'replace', 'trim', 'parse', 'stringify', 'toString', 'valueOf', 'constructor', 'render', 'update', 'create', 'remove', 'insert', 'select',
  'query', 'request', 'handle', 'process', 'resolve', 'reject', 'complete', 'append', 'flush', 'reset', 'check', 'build', 'value', 'error', 'warn', 'info', 'debug', 'log']);
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const IMPORT_LINE = /^\s*(?:import\b|export\s+(?:\{|\*)|const\s+\{[^}]*\}\s*=\s*require\()/;
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 이름 있는 함수·메서드의 줄 범위와 그 안에서 부르는 이름 */
export interface NamedFunction { name: string; start: number; end: number; exported: boolean; isPrivate: boolean; calls: Set<string> }
type Fn = NamedFunction;

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind));

/** 파일의 이름 있는 함수·메서드와 그 안에서 부르는 이름 (안쪽 이름 없는 함수의 호출은 바깥 함수의 호출로 본다) */
export function namedFunctions(path: string, text: string): Fn[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const out: Fn[] = [];
  const named = (node: ts.Node): { name: string; body: ts.Node; exported: boolean; isPrivate: boolean } | null => {
    if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, body: node, exported: hasModifier(node, ts.SyntaxKind.ExportKeyword), isPrivate: false };
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) {
      return { name: node.name.text.replace(/^#/, ''), body: node, exported: false, isPrivate: ts.isPrivateIdentifier(node.name) || hasModifier(node, ts.SyntaxKind.PrivateKeyword) };
    }
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) {
      const statement = ts.isVariableDeclaration(node) ? node.parent?.parent : undefined;
      return { name: node.name.text.replace(/^#/, ''), body: node.initializer, exported: !!statement && ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword),
        isPrivate: ts.isPrivateIdentifier(node.name) || hasModifier(node, ts.SyntaxKind.PrivateKeyword) };
    }
    return null;
  };
  const visit = (node: ts.Node, owner: Fn | null) => {
    const n = named(node);
    let current = owner;
    if (n) {
      current = { name: n.name, start: line(n.body.getStart(sf)), end: line(n.body.getEnd()), exported: n.exported, isPrivate: n.isPrivate, calls: new Set() };
      out.push(current);
    }
    if (current && ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) current.calls.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) current.calls.add(callee.name.text.replace(/^#/, ''));
    }
    ts.forEachChild(node, (child) => visit(child, current));
  };
  visit(sf, null);
  return out;
}

/** 표를 쓰는 줄(lines)을 감싸는 함수에서 시작해 같은 파일 안의 호출자를 따라가, 다른 파일에서 부를 수 있는 이름을 고른다 */
export function reachableNames(fns: Fn[], lines: number[]): { methods: Set<string>; functions: Set<string> } {
  const seeds = new Set<Fn>();
  for (const l of lines) {
    const inner = fns.filter((f) => f.start <= l && l <= f.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    if (inner) seeds.add(inner);
  }
  const reached = new Set(seeds);
  let frontier = [...seeds];
  for (let depth = 0; depth < DB_CALL_LIMITS.depth && frontier.length; depth++) {
    const names = new Set(frontier.map((f) => f.name));
    frontier = fns.filter((f) => !reached.has(f) && [...f.calls].some((c) => names.has(c)));
    for (const f of frontier) reached.add(f);
  }
  const usable = [...reached].filter((f) => !f.isPrivate && f.name.length >= DB_CALL_LIMITS.minName && !STOP.has(f.name));
  return { methods: new Set(usable.map((f) => f.name)), functions: new Set(usable.filter((f) => f.exported).map((f) => f.name)) };
}

/**
 * 표마다(direct: 표 → 그 표를 직접 쓰는 줄) 공용 모듈의 함수를 부르는 다른 파일의 줄을 더 찾는다.
 * 결과의 via 는 부른 함수 이름, through 는 그 함수가 있는 모듈 경로다. 정의 파일(own)과 모듈 자신은 뺀다.
 */
export function findModuleCalls<K>(direct: Map<K, DbUsage[]>, files: DbSourceFile[], imports: Map<string, string[]>, own: (key: K) => Set<string>): Map<K, DbUsage[]> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const fnCache = new Map<string, Fn[]>();
  // 윤곽은 원문으로 만든 것(readRepoText functions)을 쓴다. 없으면 받은 글에서 만든다
  const fnsOf = (f: DbSourceFile) => {
    let fns = f.functions ?? fnCache.get(f.path);
    if (!fns) { try { fns = namedFunctions(f.path, f.text); } catch { fns = []; } fnCache.set(f.path, fns); }
    return fns;
  };
  const linesOf = new Map<string, string[]>();
  const lines = (f: DbSourceFile) => { let l = linesOf.get(f.path); if (!l) { l = f.text.split(/\r?\n/); linesOf.set(f.path, l); } return l; };
  const result = new Map<K, DbUsage[]>();
  for (const [key, usages] of direct) {
    const found: DbUsage[] = [];
    const skip = own(key);
    const modules = [...new Set(usages.filter((u) => !u.through).map((u) => u.path))].filter((p) => CODE_FILE.test(p));
    const seenFiles = new Set<string>(usages.map((u) => u.path));
    for (const modulePath of modules) {
      const module = byPath.get(modulePath);
      if (!module) continue;
      const { methods, functions } = reachableNames(fnsOf(module), usages.filter((u) => u.path === modulePath).map((u) => u.line));
      if (!methods.size) continue;
      const methodRe = [...methods].map((name) => ({ name, re: new RegExp(String.raw`(?<!\bthis\s*\??)\.\s*${esc(name)}\s*(?:<[^<>()]*>)?\s*\(`) }));
      const fnRe = [...functions].map((name) => ({ name, re: new RegExp(String.raw`(?<![\w$.])${esc(name)}\s*(?:<[^<>()]*>)?\s*\(`), def: new RegExp(String.raw`\b(?:function|const|let|var)\s+${esc(name)}\b`) }));
      for (const file of files) {
        if (found.length >= DB_CALL_LIMITS.filesPerTable) break;
        if (file.path === modulePath || seenFiles.has(file.path) || skip.has(file.path) || !CODE_FILE.test(file.path)) continue;
        const candidates = methodRe.filter((m) => file.text.includes(m.name));
        const bare = (imports.get(file.path) ?? []).includes(modulePath) ? fnRe.filter((m) => file.text.includes(m.name)) : [];
        if (!candidates.length && !bare.length) continue;
        const text = lines(file);
        for (let i = 0; i < text.length; i++) {
          const line = text[i]!;
          if (line.length > 2000 || IMPORT_LINE.test(line) || COMMENT_LINE.test(line)) continue;
          const hit = candidates.find((m) => m.re.test(line)) ?? bare.find((m) => m.re.test(line) && !m.def.test(line));
          if (!hit) continue;
          found.push({ line: i + 1, path: file.path, text: maskSecrets(line.replace(/\s+/g, ' ').trim()).slice(0, 160), via: hit.name, through: modulePath });
          seenFiles.add(file.path);
          break;
        }
      }
    }
    result.set(key, found);
  }
  return result;
}
