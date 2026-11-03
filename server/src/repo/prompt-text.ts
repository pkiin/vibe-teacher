import path from 'node:path';
import ts from 'typescript';
import type { RepoFeaturePromptPart, RepoFeaturePromptSegment } from '@vibe-teacher/shared';

/**
 * AI 가 가리킨 코드에서 실제로 AI 에 가는 프롬프트만 꺼낸다. 코드를 실행하지 않고, AI 가 다시 쓴 문장도 쓰지 않는다.
 * 1) 범위 안의 AI 요청에서 역할에 맞는 값을 찾는다: `system:`·`user:`·`prompt:` 키, `{ role: 'system', content: … }` 메시지
 * 2) 값을 따라간다: 문자열·템플릿·이어 붙이기·join, 같은 파일의 변수·함수 반환값, 불러온 파일의 상수,
 *    withReader(...) 같은 감싸는 함수는 고정 문장이 있는 인자를 따라가고 함수 이름을 남긴다
 * 3) 고정 문장이 없는 값(JSON.stringify(...) 등)은 "실행할 때 채워지는 값"(slot)으로 그 식을 보여 준다
 * 역할 키가 없으면 범위 안의 문장이 하나일 때만 그 문장을 쓴다 (오류·로그 문구는 처음부터 뺀다).
 */

export type PromptRole = 'system' | 'user';
export type ReadFile = (file: string) => Promise<string | null>;
type Seg = RepoFeaturePromptSegment;
type Where = { path: string; line: number };
interface Resolved { segments: Seg[]; via: string[]; from: Where[] }
/** 펼친 함수의 매개변수 → 부른 쪽 인자 (실제로 넘어간 값으로 바꿔 보여 준다) */
type Env = Map<string, { s: Script; node: ts.Expression; env: Env }>;
const NO_ENV: Env = new Map();

const MAX_TEXT = 20_000;
const MAX_DEPTH = 6;
const MAX_SLOT = 240;
const MAX_READS = 8;
const MAX_ATTEMPTS = 40;
const SYSTEM_KEY = /^(?:system|systemPrompt|system_prompt|systemInstruction|system_instruction|instructions|preamble)$/;
const USER_KEY = /^(?:user|userPrompt|user_prompt|prompt|input|query)$/;
/** 역할 키를 AI 요청으로 볼 객체: 이런 키가 둘 이상 있다 */
const AI_KEY = /^(?:model|messages|schema|schemaName|maxTokens|max_tokens|temperature|response_format|responseFormat|tools|system|user|prompt|input|stream|task)$/;
const NOISE_CALL = /^(?:console\.\w+|logger\.\w+|log|warn|error|debug|info|assert)$/;

function meaningful(text: string): boolean {
  const s = text.trim();
  return s.length >= 2 && (/[^\x00-\x7f]/.test(s) || /\s/.test(s) || s.length >= 40);
}
const textOf = (segs: Seg[]) => segs.filter((s) => s.kind === 'text').map((s) => s.text).join('');
const hasText = (r: Resolved) => meaningful(textOf(r.segments));
const lit = (text: string): Resolved => ({ segments: text ? [{ kind: 'text', text }] : [], via: [], from: [] });
const slot = (text: string): Resolved => ({ segments: [{ kind: 'slot', text: text.length > MAX_SLOT ? `${text.slice(0, MAX_SLOT)}…` : text }], via: [], from: [] });

function merge(...parts: Resolved[]): Resolved {
  const segments: Seg[] = [];
  for (const s of parts.flatMap((p) => p.segments)) {
    const last = segments[segments.length - 1];
    if (last && last.kind === 'text' && s.kind === 'text') last.text += s.text;
    else if (s.text) segments.push({ ...s });
  }
  const from = [...new Map(parts.flatMap((p) => p.from).map((w) => [`${w.path}:${w.line}`, w])).values()];
  return { segments, via: [...new Set(parts.flatMap((p) => p.via))], from };
}

function part(line: number, r: Resolved, call?: string): RepoFeaturePromptPart {
  let total = 0;
  const segments: Seg[] = [];
  for (const s of r.segments) {
    if (total >= MAX_TEXT) break;
    const text = s.text.slice(0, MAX_TEXT - total);
    total += text.length;
    segments.push({ kind: s.kind, text });
  }
  return { line, segments, via: r.via, from: r.from, ...(call ? { call } : {}) };
}

// ───────────────────────── JS·TS ─────────────────────────

interface Var { init?: ts.Expression; member?: string; pos: number; line: number; scope: ts.Node }
interface Script {
  file: string;
  sf: ts.SourceFile;
  line(pos: number): number;
  vars: Map<string, Var[]>;
  funcs: Map<string, ts.FunctionLikeDeclaration>;
  imports: Map<string, { module: string; name: string }>;
}

const scopeOf = (n: ts.Node): ts.Node => { let p = n.parent; while (p && !ts.isFunctionLike(p) && !ts.isSourceFile(p)) p = p.parent; return p ?? n.getSourceFile(); };

function parseScript(file: string, code: string): Script {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const s: Script = { file, sf, line, vars: new Map(), funcs: new Map(), imports: new Map() };
  const addVar = (name: string, v: Var) => s.vars.set(name, [...(s.vars.get(name) ?? []), v]);
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n)) {
      const at = n.getStart(sf);
      if (ts.isIdentifier(n.name)) {
        if (n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) s.funcs.set(n.name.text, n.initializer);
        else addVar(n.name.text, { ...(n.initializer ? { init: n.initializer } : {}), pos: at, line: line(at), scope: scopeOf(n) });
      } else if (ts.isObjectBindingPattern(n.name) && n.initializer) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const member = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          addVar(el.name.text, { init: n.initializer, member, pos: el.getStart(sf), line: line(el.getStart(sf)), scope: scopeOf(n) });
        }
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name) s.funcs.set(n.name.text, n);
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      for (const el of n.importClause.namedBindings.elements) s.imports.set(el.name.text, { module: n.moduleSpecifier.text, name: (el.propertyName ?? el.name).text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return s;
}

function singleReturn(fn: ts.FunctionLikeDeclaration): ts.Expression | null {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return fn.body;
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return null;
  const returns: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return returns.length === 1 ? returns[0]! : null;
}

/** 이 이름이 둘러싼 함수의 매개변수면 실행할 때 들어오는 값이다 */
function isParameter(id: ts.Identifier): boolean {
  for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && p.parameters.some((param) => ts.isIdentifier(param.name) && param.name.text === id.text)) return true;
  }
  return false;
}

class ScriptResolver {
  private readonly cache = new Map<string, Promise<Script | null>>();
  private reads = 0;
  private attempts = 0;

  constructor(private readonly read?: ReadFile) {}

  private load(file: string): Promise<Script | null> {
    if (!this.cache.has(file)) {
      this.cache.set(file, (async () => {
        if (!this.read || this.reads >= MAX_READS || this.attempts++ >= MAX_ATTEMPTS) return null;
        const code = await this.read(file);
        if (code === null) return null;
        this.reads++;
        return parseScript(file, code);
      })());
    }
    return this.cache.get(file)!;
  }

  /** 저장소 안의 상대 경로 모듈만 따라간다 (외부 패키지·경로 별칭은 추측하지 않는다) */
  private async module(from: Script, spec: string): Promise<Script | null> {
    if (!spec.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from.file), spec));
    if (base.startsWith('../') || base.startsWith('/')) return null;
    const stem = base.replace(/\.[cm]?jsx?$/, '');
    const candidates = [...new Set([base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map((x) => stem + x), ...['index.ts', 'index.tsx', 'index.js'].map((x) => `${stem}/${x}`)])];
    for (const candidate of candidates) {
      const script = await this.load(candidate);
      if (script) return script;
    }
    return null;
  }

  private async func(s: Script, name: string): Promise<{ script: Script; decl: ts.FunctionLikeDeclaration } | null> {
    const local = s.funcs.get(name);
    if (local) return { script: s, decl: local };
    const imp = s.imports.get(name);
    const target = imp ? await this.module(s, imp.module) : null;
    const decl = imp && target?.funcs.get(imp.name);
    return target && decl ? { script: target, decl } : null;
  }

  private where(s: Script, n: ts.Node): Where {
    return { path: s.file, line: s.line(n.getStart(s.sf)) };
  }

  /** 부르는 함수: 같은 파일·불러온 파일의 함수, 같은 클래스의 this.메서드 */
  private async callee(s: Script, callee: ts.Expression): Promise<{ script: Script; decl: ts.FunctionLikeDeclaration } | null> {
    if (ts.isIdentifier(callee)) return this.func(s, callee.text);
    if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
      let cls: ts.Node | undefined = callee.parent;
      while (cls && !ts.isClassLike(cls)) cls = cls.parent;
      const method = cls && ts.isClassLike(cls) ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && !!m.name && ts.isIdentifier(m.name) && m.name.text === callee.name.text) : undefined;
      return method ? { script: s, decl: method } : null;
    }
    return null;
  }

  private bind(target: ts.FunctionLikeDeclaration, call: ts.CallExpression, s: Script, env: Env): Env {
    const bound: Env = new Map();
    target.parameters.forEach((p, i) => {
      const arg = call.arguments[i];
      if (arg && ts.isIdentifier(p.name)) bound.set(p.name.text, { s, node: arg, env });
    });
    return bound;
  }

  async expr(s: Script, node: ts.Expression, depth = 0, env: Env = NO_ENV): Promise<Resolved> {
    let n = node;
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
    if (depth > MAX_DEPTH) return slot(n.getText(s.sf));
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return lit(n.text);
    if (ts.isTemplateExpression(n)) {
      const parts = [lit(n.head.text)];
      for (const span of n.templateSpans) parts.push(await this.inline(s, span.expression, depth + 1, env), lit(span.literal.text));
      return merge(...parts);
    }
    if (ts.isTaggedTemplateExpression(n)) return this.expr(s, n.template, depth + 1, env);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return merge(await this.inline(s, n.left, depth + 1, env), await this.inline(s, n.right, depth + 1, env));
    if (ts.isIdentifier(n)) return this.identifier(s, n, depth, env);
    if (ts.isCallExpression(n)) return this.call(s, n, depth, env);
    if (ts.isPropertyAccessExpression(n)) return this.member(s, n.expression, n.name.text, depth, env, n.getText(s.sf));
    return slot(n.getText(s.sf));
  }

  /** 템플릿·이어 붙이기 안의 값: 고정 문장으로 풀리면 끼워 넣고, 아니면 원래 식을 실행 중 값으로 둔다 */
  private async inline(s: Script, n: ts.Expression, depth: number, env: Env): Promise<Resolved> {
    const r = await this.expr(s, n, depth, env);
    // 짧은 값이라도 전부 고정 문자열이면 끼워 넣는다 (예: 인자로 넘긴 'ko')
    return hasText(r) || (r.segments.length > 0 && r.segments.every((x) => x.kind === 'text')) ? r : slot(n.getText(s.sf));
  }

  private async identifier(s: Script, id: ts.Identifier, depth: number, env: Env): Promise<Resolved> {
    const at = id.getStart(s.sf);
    const candidates = (s.vars.get(id.text) ?? []).filter((v) => v.pos < at && v.scope.pos <= at && at < v.scope.end);
    const v = candidates[candidates.length - 1];
    if (v?.init) {
      const r = v.member ? await this.member(s, v.init, v.member, depth + 1, env, `${v.init.getText(s.sf)}.${v.member}`) : await this.expr(s, v.init, depth + 1, env);
      return { ...r, from: [{ path: s.file, line: v.line }, ...r.from] };
    }
    const bound = env.get(id.text);
    if (bound) return this.expr(bound.s, bound.node, depth + 1, bound.env);
    if (isParameter(id)) return slot(id.text);
    const imp = s.imports.get(id.text);
    const target = imp ? await this.module(s, imp.module) : null;
    const tv = imp && target?.vars.get(imp.name)?.find((x) => ts.isSourceFile(x.scope));
    if (target && tv?.init) {
      const r = await this.expr(target, tv.init, depth + 1);
      return { ...r, from: [{ path: target.file, line: tv.line }, ...r.from] };
    }
    return slot(id.text);
  }

  /** obj.name 또는 const { name } = obj: 객체 리터럴이나 그것을 돌려주는 함수·메서드면 그 속성을 따라간다 */
  private async member(s: Script, objectNode: ts.Expression, name: string, depth: number, env: Env, fallback: string): Promise<Resolved> {
    let n = objectNode;
    while (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isAsExpression(n)) n = n.expression;
    let ctx = { s, env, obj: n as ts.Expression | null, from: [] as Where[] };
    if (ts.isCallExpression(n)) {
      const target = await this.callee(s, n.expression);
      const ret = target ? singleReturn(target.decl) : null;
      ctx = target && ret ? { s: target.script, env: this.bind(target.decl, n, s, env), obj: ret, from: [this.where(target.script, target.decl)] } : { ...ctx, obj: null };
    }
    let obj = ctx.obj;
    while (obj && (ts.isParenthesizedExpression(obj) || ts.isAsExpression(obj) || ts.isSatisfiesExpression(obj))) obj = obj.expression;
    if (obj && ts.isObjectLiteralExpression(obj) && depth <= MAX_DEPTH) {
      const prop = obj.properties.find((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
      const value = prop && (ts.isPropertyAssignment(prop) ? prop.initializer : ts.isShorthandPropertyAssignment(prop) ? prop.name : null);
      if (value) {
        const r = await this.expr(ctx.s, value, depth + 1, ctx.env);
        return { ...r, from: [...ctx.from, ...r.from] };
      }
    }
    return { ...slot(fallback), from: ctx.from };
  }

  private async call(s: Script, n: ts.CallExpression, depth: number, env: Env): Promise<Resolved> {
    const callee = n.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'join' && ts.isArrayLiteralExpression(callee.expression)) {
      const sep = n.arguments[0] ? await this.expr(s, n.arguments[0], depth + 1, env) : lit(',');
      const items = await Promise.all(callee.expression.elements.map((e) => this.inline(s, e, depth + 1, env)));
      return merge(...items.flatMap((item, i) => (i ? [sep, item] : [item])));
    }
    // 같은 저장소의 함수면 매개변수에 실제 인자를 넣어 돌려주는 문장을 펼친다 (예: withReader(PROMPT, level))
    const target = await this.callee(s, callee);
    const at = target ? this.where(target.script, target.decl) : null;
    const ret = target ? singleReturn(target.decl) : null;
    if (target && ret) {
      const r = await this.expr(target.script, ret, depth + 1, this.bind(target.decl, n, s, env));
      if (hasText(r)) return { ...r, from: [at!, ...r.from] };
    }
    // 저장소 밖의 감싸는 함수(maskSecrets·truncate 등)는 고정 문장이 있는 첫 인자를 따라가고 이름을 남긴다
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : 'call';
    for (const arg of n.arguments) {
      const r = await this.expr(s, arg, depth + 1, env);
      if (hasText(r)) return { ...r, via: [name, ...r.via] };
    }
    return { ...slot(n.getText(s.sf)), from: at ? [at] : [] };
  }

  /** 범위 안에서 역할에 맞는 프롬프트 값의 위치 */
  roleValues(s: Script, range: { start: number; end: number }, role: PromptRole): { node: ts.Expression; line: number; call?: string; inCall: boolean }[] {
    const keys = role === 'system' ? SYSTEM_KEY : USER_KEY;
    const nameOf = (p: ts.ObjectLiteralElementLike) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);
    const valueOf = (p: ts.ObjectLiteralElementLike): ts.Expression | null => (ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null);
    const out: { node: ts.Expression; line: number; call?: string; inCall: boolean }[] = [];
    /** 요청 객체가 어떤 호출의 인자인지 (예: provider.complete · wiki_ai_candidates) */
    const requestOf = (obj: ts.ObjectLiteralExpression): { call?: string; inCall: boolean } => {
      let p: ts.Node = obj;
      while (p.parent && (ts.isObjectLiteralExpression(p.parent) || ts.isArrayLiteralExpression(p.parent) || ts.isPropertyAssignment(p.parent))) p = p.parent;
      const call = p.parent && (ts.isCallExpression(p.parent) || ts.isNewExpression(p.parent)) && p.parent.arguments?.includes(p as ts.Expression) ? p.parent : null;
      if (!call) return { inCall: false };
      const top = p as ts.Node;
      const tag = ts.isObjectLiteralExpression(top) ? top.properties.flatMap((x) => (ts.isPropertyAssignment(x) && x.name && ts.isIdentifier(x.name) && /^(?:schemaName|model|name)$/.test(x.name.text) && (ts.isStringLiteral(x.initializer) || ts.isNoSubstitutionTemplateLiteral(x.initializer)) ? [x.initializer.text] : []))[0] : undefined;
      return { inCall: true, call: [call.expression.getText(s.sf).replace(/\s+/g, ''), tag].filter(Boolean).join(' · ').slice(0, 120) };
    };
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const roleProp = n.properties.find((p) => nameOf(p) === 'role');
        const content = n.properties.find((p) => nameOf(p) === 'content');
        const roleValue = roleProp && ts.isPropertyAssignment(roleProp) && (ts.isStringLiteral(roleProp.initializer) || ts.isNoSubstitutionTemplateLiteral(roleProp.initializer)) ? roleProp.initializer.text : null;
        if (roleValue && content) {
          const value = valueOf(content);
          if (value && (role === 'system' ? roleValue === 'system' || roleValue === 'developer' : roleValue === 'user')) out.push({ node: value, line: s.line(value.getStart(s.sf)), ...requestOf(n) });
        } else if (n.properties.map(nameOf).filter((k): k is string => !!k && AI_KEY.test(k)).length >= 2) {
          for (const p of n.properties) {
            const value = valueOf(p);
            const k = nameOf(p);
            if (value && k && keys.test(k)) out.push({ node: value, line: s.line(value.getStart(s.sf)), ...requestOf(n) });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(s.sf);
    const inRange = out.filter((v) => v.line >= range.start && v.line <= range.end);
    // 미리 보기 응답처럼 프롬프트를 담기만 한 객체보다 실제로 호출에 넘기는 요청 객체를 우선한다
    return inRange.some((v) => v.inCall) ? inRange.filter((v) => v.inCall) : inRange;
  }

  /** 역할 키가 없을 때 쓰는 범위 안의 문장들 (오류·로그·모듈 경로·타입·객체 키는 뺀다) */
  strings(s: Script, range: { start: number; end: number }): ts.Expression[] {
    const out: ts.Expression[] = [];
    const isString = (n: ts.Node): n is ts.Expression => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isTaggedTemplateExpression(n)
      || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && (isString(n.left) || isString(n.right)))
      || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'join' && ts.isArrayLiteralExpression(n.expression.expression));
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isThrowStatement(n) || ts.isNewExpression(n)) return;
      if (ts.isCallExpression(n) && NOISE_CALL.test(n.expression.getText(s.sf))) return;
      if (ts.isPropertyAssignment(n)) return visit(n.initializer);
      if (isString(n)) {
        const start = s.line(n.getStart(s.sf)), end = s.line(n.getEnd());
        if (start <= range.end && end >= range.start) out.push(n);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(s.sf);
    return out;
  }

  static parse(file: string, code: string): Script {
    return parseScript(file, code);
  }
}

async function scriptPrompts(file: string, code: string, range: { start: number; end: number }, role: PromptRole, read?: ReadFile): Promise<RepoFeaturePromptPart[]> {
  const resolver = new ScriptResolver(read);
  const s = ScriptResolver.parse(file, code);
  const values = resolver.roleValues(s, range, role);
  if (values.length) return Promise.all(values.map(async (v) => part(v.line, await resolver.expr(s, v.node), v.call)));
  const strings = (await Promise.all(resolver.strings(s, range).map(async (n) => ({ line: s.line(n.getStart(s.sf)), r: await resolver.expr(s, n) })))).filter((x) => hasText(x.r));
  return strings.length === 1 ? [part(strings[0]!.line, strings[0]!.r)] : [];
}

// ───────────────────────── Python ─────────────────────────

interface PyPiece { segments: Seg[]; start: number; end: number; offset: number; endOffset: number }
const COOK: Record<string, string> = { n: '\n', t: '\t', r: '', '\\': '\\', "'": "'", '"': '"', '\n': '' };

function pythonPieces(code: string) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const lineAt = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const pieces: PyPiece[] = [];
  const comments: [number, number][] = [];
  const consts = new Map<string, PyPiece>();
  let group: PyPiece | null = null;
  const flush = () => {
    if (!group) return;
    pieces.push(group);
    // NAME = """...""" 또는 NAME = ( "..." "..." ) 형태의 상수
    const before = code.slice(0, group.offset).replace(/[\s(]*$/, '');
    const name = /^\s*([A-Za-z_]\w*)\s*(?::[^=\n]*)?=$/.exec(before.slice(before.lastIndexOf('\n') + 1))?.[1];
    if (name) consts.set(name, group);
    group = null;
  };
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '#') { const start = i; while (i < code.length && code[i] !== '\n') i++; comments.push([start, i]); continue; }
    const m = /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(code.slice(i, i + 5));
    if (m && !(m[1] && /\w/.test(code[i - 1] ?? ''))) {
      const prefix = m[1]!.toLowerCase(), quote = m[2]!;
      let j = i + m[0].length, body = '';
      while (j < code.length && !code.startsWith(quote, j) && !(quote.length === 1 && code[j] === '\n')) {
        if (code[j] === '\\') { body += prefix.includes('r') ? code.slice(j, j + 2) : COOK[code[j + 1] ?? ''] ?? `\\${code[j + 1] ?? ''}`; j += 2; continue; }
        body += code[j]; j++;
      }
      if (quote.length === 3 && body.startsWith('\n')) body = body.slice(1);
      const segs: Seg[] = [];
      if (prefix.includes('f')) {
        let last = 0;
        for (const fm of body.matchAll(/\{\{|\}\}|\{([^{}]+)\}/g)) {
          segs.push({ kind: 'text', text: body.slice(last, fm.index) });
          segs.push(fm[0] === '{{' ? { kind: 'text', text: '{' } : fm[0] === '}}' ? { kind: 'text', text: '}' } : { kind: 'slot', text: fm[1]! });
          last = fm.index + fm[0].length;
        }
        segs.push({ kind: 'text', text: body.slice(last) });
      } else segs.push({ kind: 'text', text: body });
      const end = Math.min(code.length, j + quote.length);
      group ??= { segments: [], start: lineAt(i), end: 0, offset: i, endOffset: 0 };
      group.segments = merge({ segments: group.segments, via: [], from: [] }, { segments: segs, via: [], from: [] }).segments;
      group.end = lineAt(end - 1);
      group.endOffset = end;
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) { flush(); i += /^[A-Za-z_]\w*/.exec(code.slice(i, i + 200))![0].length; continue; }
    // 괄호로 감싼 붙여 쓴 문자열은 한 덩어리로 본다
    if (!/\s/.test(c) && c !== '(' && c !== ')') flush();
    i++;
  }
  flush();
  return { pieces, comments, consts, lineAt, starts };
}

function pythonPrompts(code: string, range: { start: number; end: number }, role: PromptRole, file: string): RepoFeaturePromptPart[] {
  const { pieces, comments, consts, lineAt, starts } = pythonPieces(code);
  const from = starts[range.start - 1] ?? code.length, to = starts[range.end] ?? code.length;
  // 문자열 안이나 주석 안에 적힌 "role": "system" 은 요청이 아니다 (따옴표로 시작하는 "role" 자체는 괜찮다)
  const hidden = (pos: number) => pieces.some((p) => p.offset < pos && pos < p.endOffset) || comments.some(([a, b]) => a <= pos && pos < b);
  const valueAt = (pos: number): Resolved => {
    const piece = pieces.find((p) => p.offset >= pos && p.offset <= pos + 3);
    if (piece) return { segments: piece.segments, via: [], from: [] };
    const name = /^[A-Za-z_][\w.]*/.exec(code.slice(pos, pos + 200))?.[0];
    if (!name) return slot(code.slice(pos, pos + 40).split(/[,)\n]/)[0] ?? '');
    const c = consts.get(name);
    if (c) return { segments: c.segments, via: [], from: [{ path: file, line: c.start }] };
    if (code[pos + name.length] === '(') {
      // 감싸는 함수: 괄호 안의 첫 문자열이나 상수를 따라간다
      let depth = 0, k = pos + name.length;
      for (; k < code.length; k++) { if (code[k] === '(') depth++; else if (code[k] === ')' && --depth === 0) break; }
      const inner = pieces.find((p) => p.offset > pos && p.offset < k);
      if (inner && meaningful(textOf(inner.segments))) return { segments: inner.segments, via: [name], from: [] };
      for (const m of code.slice(pos + name.length, k).matchAll(/[A-Za-z_]\w*/g)) {
        const arg = consts.get(m[0]);
        if (arg) return { segments: arg.segments, via: [name], from: [{ path: file, line: arg.start }] };
      }
      return slot(code.slice(pos, k + 1));
    }
    return slot(name);
  };
  const patterns = role === 'system'
    ? [/["']role["']\s*:\s*["'](?:system|developer)["']\s*,\s*["']content["']\s*:\s*/g, /\b(?:system|system_prompt|system_instruction|instructions)\s*=(?!=)\s*/g]
    : [/["']role["']\s*:\s*["']user["']\s*,\s*["']content["']\s*:\s*/g, /\b(?:prompt|user_prompt|input)\s*=(?!=)\s*/g];
  const found: RepoFeaturePromptPart[] = [];
  const segment = code.slice(from, to);
  for (const re of patterns) {
    for (const m of segment.matchAll(re)) {
      const at = from + m.index;
      if (hidden(at)) continue;
      const pos = at + m[0].length;
      found.push(part(lineAt(pos), valueAt(pos)));
    }
  }
  if (found.length) return found.sort((a, b) => a.line - b.line);
  const lines = code.split('\n');
  const strings = pieces.filter((p) => p.start <= range.end && p.end >= range.start && meaningful(textOf(p.segments)) && !/^\s*(?:raise|assert)\b|\b(?:print|logging\.\w+|logger\.\w+)\(/.test(lines[p.start - 1] ?? ''));
  return strings.length === 1 ? [part(strings[0]!.start, { segments: strings[0]!.segments, via: [], from: [] })] : [];
}

/**
 * code 는 파일 전체이거나 lineOffset 만큼 밀린 발췌다. range 는 파일 기준 줄 번호.
 * read 를 주면 같은 저장소의 불러온 파일(상대 경로)도 따라간다.
 */
export async function extractPrompts(input: { file: string; code: string; range: { start: number; end: number }; role: PromptRole; lineOffset?: number; read?: ReadFile }): Promise<RepoFeaturePromptPart[]> {
  const offset = input.lineOffset ?? 0;
  const range = { start: input.range.start - offset, end: input.range.end - offset };
  const shift = (p: RepoFeaturePromptPart): RepoFeaturePromptPart => ({ ...p, line: p.line + offset, from: p.from.map((w) => (w.path === input.file ? { ...w, line: w.line + offset } : w)) });
  if (/\.[cm]?[jt]sx?$/.test(input.file)) return (await scriptPrompts(input.file, input.code, range, input.role, input.read)).map(shift);
  if (input.file.endsWith('.py')) return pythonPrompts(input.code, range, input.role, input.file).map(shift);
  return [];
}
