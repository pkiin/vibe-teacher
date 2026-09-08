/**
 * 가벼운 셸 명령 파서.
 * 목적: "무엇이 만들어졌나"를 알아내기 위해 명령을 단순 명령(argv + 리다이렉트 + heredoc)으로 쪼갠다.
 * 완전한 셸 문법이 아니라, 코딩 에이전트가 흔히 쓰는 형태(&&, ;, |, 파이프, > >>, heredoc, $(…))를 관대하게 처리한다.
 */

export type RedirectOp = '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '&>>' | '2>&1' | '>&2';

export interface Redirect {
  op: RedirectOp;
  target?: string;
}

export interface SimpleCommand {
  argv: string[];
  /** 앞에 붙은 VAR=value 할당 */
  assignments: string[];
  redirects: Redirect[];
  heredocs: { delim: string; body: string }[];
  raw: string;
  /** 이 명령이 실행될 때의 작업 디렉터리 (앞선 cd 반영), 알 수 없으면 undefined */
  cwd?: string;
}

interface Token {
  kind: 'word' | 'op' | 'newline';
  value: string;
}

const HEREDOC_RE = /<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g;

/** heredoc 본문을 걷어내고 따로 돌려준다 (본문은 줄 단위, 구분자 줄에서 끝남). */
export function stripHeredocs(text: string): { text: string; heredocs: { delim: string; body: string }[] } {
  const lines = text.split('\n');
  const outLines: string[] = [];
  const heredocs: { delim: string; body: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    outLines.push(line);
    const delims: { delim: string; stripTabs: boolean }[] = [];
    HEREDOC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEREDOC_RE.exec(line))) {
      const delim = m[1] ?? m[2] ?? m[3] ?? '';
      if (delim) delims.push({ delim, stripTabs: m[0].startsWith('<<-') });
    }
    i += 1;
    for (const d of delims) {
      const body: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const cmp = d.stripTabs ? l.replace(/^\t+/, '') : l;
        i += 1;
        if (cmp === d.delim || cmp.trimEnd() === d.delim) break;
        body.push(l);
      }
      heredocs.push({ delim: d.delim, body: body.join('\n') });
    }
  }
  return { text: outLines.join('\n'), heredocs };
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

const OPS = ['2>&1', '&>>', '>&2', '2>>', '&&', '||', ';;', '|&', '>>', '<<', '2>', '&>', '|', ';', '&', '>', '<', '(', ')'];

/** 따옴표/이스케이프/$(…)/`…` 를 인식하는 토크나이저 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let word = '';
  let hasWord = false;
  let i = 0;
  const n = text.length;
  const flush = () => {
    if (hasWord) tokens.push({ kind: 'word', value: word });
    word = '';
    hasWord = false;
  };
  const readUntil = (close: string, open?: string): string => {
    let depth = 1;
    let out = '';
    while (i < n) {
      const ch = text[i] ?? '';
      if (open && ch === open) depth += 1;
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          return out;
        }
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  while (i < n) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (ch === '\\' && next === '\n') {
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      tokens.push({ kind: 'newline', value: '\n' });
      i += 1;
      continue;
    }
    if (isSpace(ch)) {
      flush();
      i += 1;
      continue;
    }
    if (ch === '#' && !hasWord) {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === "'") {
      i += 1;
      const start = i;
      while (i < n && text[i] !== "'") i += 1;
      word += text.slice(start, i);
      hasWord = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      let out = '';
      while (i < n && text[i] !== '"') {
        const c = text[i] ?? '';
        if (c === '\\' && i + 1 < n) {
          const e = text[i + 1] ?? '';
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            out += e;
            i += 2;
            continue;
          }
        }
        if (c === '$' && text[i + 1] === '(') {
          i += 2;
          out += '$(' + readUntil(')', '(') + ')';
          continue;
        }
        out += c;
        i += 1;
      }
      word += out;
      hasWord = true;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      word += next;
      hasWord = true;
      i += 2;
      continue;
    }
    if (ch === '$' && next === '(') {
      i += 2;
      word += '$(' + readUntil(')', '(') + ')';
      hasWord = true;
      continue;
    }
    if (ch === '$' && next === '{') {
      i += 2;
      word += '${' + readUntil('}', '{') + '}';
      hasWord = true;
      continue;
    }
    if (ch === '`') {
      i += 1;
      word += '`' + readUntil('`') + '`';
      hasWord = true;
      continue;
    }
    const ahead = text.slice(i, i + 4);
    let matched: string | undefined;
    for (const op of OPS) {
      if (ahead.startsWith(op)) {
        matched = op;
        break;
      }
    }
    if (matched) {
      if (/^\d/.test(matched) && hasWord) {
        // "file2>x" 처럼 단어 중간의 숫자는 리다이렉트가 아님
        word += ch;
        i += 1;
        continue;
      }
      flush();
      let op = matched;
      if (op === ';;') op = ';';
      if (op === '|&') op = '|';
      i += matched.length;
      if (op === '<<' && text[i] === '-') i += 1;
      tokens.push({ kind: 'op', value: op });
      continue;
    }
    word += ch;
    hasWord = true;
    i += 1;
  }
  flush();
  return tokens;
}

const REDIRECT_OPS = new Set<string>(['>', '>>', '<', '2>', '2>>', '&>', '&>>']);
const NO_TARGET_REDIRECTS = new Set<string>(['2>&1', '>&2']);
const SEPARATORS = new Set<string>(['&&', '||', '|', ';', '&', '(', ')']);

/**
 * 명령 문자열을 단순 명령 목록으로 나눈다.
 * @param baseCwd 명령이 실행된 작업 디렉터리 (cd 추적의 시작점)
 */
export function splitCommands(command: string, baseCwd?: string): SimpleCommand[] {
  const stripped = stripHeredocs(command);
  const tokens = tokenize(stripped.text);
  const out: SimpleCommand[] = [];
  let cwd = baseCwd;
  let current: SimpleCommand | null = null;
  const heredocQueue = stripped.heredocs.slice();
  let expectRedirectTarget: RedirectOp | null = null;
  let expectHeredocDelim = false;
  let rawParts: string[] = [];

  const begin = (): SimpleCommand => {
    if (!current) {
      current = { argv: [], assignments: [], redirects: [], heredocs: [], raw: '', cwd };
      rawParts = [];
    }
    return current;
  };
  const finish = () => {
    if (!current) return;
    const c: SimpleCommand = current;
    c.raw = rawParts.join(' ').trim();
    if (c.argv.length || c.assignments.length || c.redirects.length) {
      if (c.argv[0] === 'cd' && c.argv[1] && !c.argv[1].startsWith('$')) cwd = resolveRel(cwd, c.argv[1]);
      out.push(c);
    }
    current = null;
    expectRedirectTarget = null;
    expectHeredocDelim = false;
  };

  for (const t of tokens) {
    if (t.kind === 'newline') {
      finish();
      continue;
    }
    if (t.kind === 'op') {
      if (SEPARATORS.has(t.value)) {
        finish();
        continue;
      }
      const c = begin();
      rawParts.push(t.value);
      if (t.value === '<<') {
        expectHeredocDelim = true;
      } else if (NO_TARGET_REDIRECTS.has(t.value)) {
        c.redirects.push({ op: t.value as RedirectOp });
      } else if (REDIRECT_OPS.has(t.value)) {
        expectRedirectTarget = t.value as RedirectOp;
      }
      continue;
    }
    const c = begin();
    rawParts.push(t.value);
    if (expectHeredocDelim) {
      expectHeredocDelim = false;
      const body = heredocQueue.shift();
      c.heredocs.push({ delim: t.value, body: body?.body ?? '' });
      continue;
    }
    if (expectRedirectTarget) {
      c.redirects.push({ op: expectRedirectTarget, target: t.value });
      expectRedirectTarget = null;
      continue;
    }
    if (c.argv.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.value)) {
      c.assignments.push(t.value);
      continue;
    }
    c.argv.push(t.value);
  }
  finish();
  // $( … <<'EOF' … ) 처럼 단어 안에 숨은 heredoc 은 토큰으로 보이지 않으므로 남은 본문을 순서대로 붙인다
  if (heredocQueue.length) {
    for (const c of out) {
      const hidden = (c.raw.match(/<<-?\s*['"\\]?[A-Za-z_]/g) ?? []).length - c.heredocs.length;
      for (let i = 0; i < hidden && heredocQueue.length; i += 1) {
        const body = heredocQueue.shift();
        if (body) c.heredocs.push(body);
      }
    }
  }
  return out;
}

export function resolveRel(cwd: string | undefined, p: string): string | undefined {
  if (!p) return cwd;
  if (p.startsWith('/')) return p.replace(/\/+$/, '') || '/';
  if (p === '~' || p.startsWith('~/')) return p;
  if (!cwd) return undefined;
  const parts = cwd.split('/').filter(Boolean);
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

const PREFIX_WRAPPERS = new Set(['sudo', 'nohup', 'time', 'exec', 'command', 'builtin', 'nice', 'stdbuf', 'caffeinate']);

/** timeout/sudo/env 등 래퍼를 벗겨 실제 명령 argv 를 돌려준다. */
export function effectiveArgv(argv: string[]): string[] {
  let a = argv.slice();
  for (let guard = 0; guard < 5 && a.length; guard += 1) {
    const head = a[0] ?? '';
    if (PREFIX_WRAPPERS.has(head)) {
      a = a.slice(1);
      while (a.length && a[0]?.startsWith('-')) a = a.slice(1);
      continue;
    }
    if (head === 'timeout' || head === 'gtimeout') {
      a = a.slice(1);
      while (a.length && (a[0]?.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(a[0] ?? ''))) a = a.slice(1);
      continue;
    }
    if (head === 'env') {
      a = a.slice(1);
      while (a.length && (a[0]?.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0] ?? ''))) a = a.slice(1);
      continue;
    }
    break;
  }
  return a;
}
