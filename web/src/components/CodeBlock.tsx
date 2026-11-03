import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * 코드 색칠. 의존성 없이 글자 단위로 나눠 문자열·주석·키워드·숫자·함수 이름만 구분한다.
 * 실행하거나 HTML 로 해석하지 않고 React 텍스트로만 그린다 (저장소 코드에 HTML 이 있어도 안전).
 */
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'type' | 'slot' | 'property';
export interface Token { kind: TokenKind; text: string }
export type CodeLanguage = 'js' | 'py' | 'sh' | 'json' | 'text';

export function codeLanguage(path?: string, lang?: string): CodeLanguage {
  const v = (lang || (path?.includes('.') ? path.split('.').pop() : '') || '').toLowerCase();
  if (/^(?:[cm]?[jt]sx?|javascript|typescript)$/.test(v)) return 'js';
  if (v === 'py' || v === 'python') return 'py';
  if (/^(?:sh|bash|zsh|shell|console)$/.test(v)) return 'sh';
  if (v === 'json' || v === 'jsonc') return 'json';
  return 'text';
}

const words = (s: string) => new Set(s.split(' '));
const KEYWORDS: Record<Exclude<CodeLanguage, 'text'>, Set<string>> = {
  js: words('import from export default const let var function return if else for while do switch case break continue new class extends implements interface type enum async await try catch finally throw typeof instanceof in of as satisfies yield delete void static public private protected readonly declare namespace get set'),
  py: words('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await global nonlocal assert del match case'),
  sh: words('if then else elif fi for while until do done case esac function in export local return set unset source'),
  json: words(''),
};
const LITERALS: Record<Exclude<CodeLanguage, 'text'>, Set<string>> = {
  js: words('true false null undefined this super NaN Infinity'),
  py: words('True False None self cls'),
  sh: words('true false'),
  json: words('true false null'),
};
const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)/y;
const PY_STRING = /[rRbBuUfF]{0,2}("""|'''|"|')/y;
const SH_VAR = /\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*$!-])/y;

const at = (re: RegExp, code: string, i: number) => { re.lastIndex = i; return re.exec(code)?.[0] ?? null; };

export function tokenize(code: string, lang: CodeLanguage): Token[] {
  if (lang === 'text') return [{ kind: 'plain', text: code }];
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  /** 따옴표 끝까지 (한 줄 문자열은 줄 끝에서 멈춘다) */
  const quoted = (start: number, quote: string, multiline: boolean): number => {
    let j = start;
    while (j < code.length && !code.startsWith(quote, j)) {
      if (!multiline && code[j] === '\n') return j;
      j += code[j] === '\\' ? 2 : 1;
    }
    return Math.min(code.length, j + quote.length);
  };
  const keywords = KEYWORDS[lang], literals = LITERALS[lang];
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const prev = code[i - 1] ?? '\n';
    if ((lang === 'js' && code.startsWith('//', i)) || ((lang === 'py' || (lang === 'sh' && /\s/.test(prev))) && c === '#')) {
      const end = code.indexOf('\n', i);
      push('comment', code.slice(i, end < 0 ? code.length : end));
      i = end < 0 ? code.length : end;
      continue;
    }
    if (lang === 'js' && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      const j = end < 0 ? code.length : end + 2;
      push('comment', code.slice(i, j)); i = j; continue;
    }
    if (lang === 'py') {
      const head = at(PY_STRING, code, i);
      if (head && (head.length <= 3 && /^["']/.test(head) || !/\w/.test(prev))) {
        const quote = head.replace(/^[rRbBuUfF]+/, '');
        const j = quoted(i + head.length, quote, quote.length === 3);
        push('string', code.slice(i, j)); i = j; continue;
      }
    }
    if (lang === 'js' && c === '`') {
      // 템플릿 문자열: ${...} 부분은 따로 표시한다
      let j = i + 1, from = i;
      while (j < code.length && code[j] !== '`') {
        if (code[j] === '\\') { j += 2; continue; }
        if (code.startsWith('${', j)) {
          push('string', code.slice(from, j));
          let depth = 0, k = j + 2;
          for (; k < code.length; k++) { if (code[k] === '{') depth++; else if (code[k] === '}') { if (depth === 0) break; depth--; } }
          push('slot', code.slice(j, Math.min(code.length, k + 1)));
          j = from = Math.min(code.length, k + 1);
          continue;
        }
        j++;
      }
      push('string', code.slice(from, Math.min(code.length, j + 1)));
      i = Math.min(code.length, j + 1);
      continue;
    }
    if (c === '"' || (c === "'" && lang !== 'json')) {
      const j = quoted(i + 1, c, false);
      // JSON 의 "키": 는 속성 이름으로 구분한다
      const kind: TokenKind = lang === 'json' && /^\s*:/.test(code.slice(j, j + 20)) ? 'property' : 'string';
      push(kind, code.slice(i, j)); i = j; continue;
    }
    if (lang === 'sh' && c === '$') {
      const v = at(SH_VAR, code, i);
      if (v) { push('slot', v); i += v.length; continue; }
    }
    if (/\d/.test(c) && !/[\w$.]/.test(prev)) {
      const num = at(NUMBER, code, i)!;
      push('number', num); i += num.length; continue;
    }
    if (/[A-Za-z_$]/.test(c) && !/[\w$]/.test(prev)) {
      const word = at(IDENT, code, i)!;
      const after = /^\s*\(/.test(code.slice(i + word.length, i + word.length + 8));
      const kind: TokenKind = keywords.has(word) && code[i - 1] !== '.' ? 'keyword' : literals.has(word) ? 'number'
        : after ? 'function' : lang === 'js' && /^[A-Z][a-z]/.test(word) ? 'type' : (lang === 'py' && prev === '@') ? 'function' : 'plain';
      push(kind, word); i += word.length; continue;
    }
    push('plain', c);
    i++;
  }
  return out;
}

/** 여러 줄에 걸친 문자열·주석도 줄마다 같은 색이 되도록 전체를 나눈 뒤 줄로 자른다 */
export function highlightLines(code: string, lang: CodeLanguage): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code, lang)) {
    token.text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

/** 줄의 토큰을 그린다. mark 를 주면 그 글자 범위를 강조한다 (검색어). */
export function TokenLine({ tokens, mark }: { tokens: Token[]; mark?: { start: number; end: number } }): ReactNode {
  let offset = 0;
  return tokens.map((token, index) => {
    const start = offset;
    offset += token.text.length;
    const wrap = (text: string, key: string) => (token.kind === 'plain' ? <Fragment key={key}>{text}</Fragment> : <span key={key} className={`syntax-${token.kind}`}>{text}</span>);
    if (!mark || mark.end <= start || mark.start >= offset) return wrap(token.text, String(index));
    const a = Math.max(0, mark.start - start), b = Math.min(token.text.length, mark.end - start);
    return (
      <Fragment key={index}>
        {a > 0 && wrap(token.text.slice(0, a), `${index}a`)}
        <mark>{wrap(token.text.slice(a, b), `${index}b`)}</mark>
        {b < token.text.length && wrap(token.text.slice(b), `${index}c`)}
      </Fragment>
    );
  });
}

export function CodeBlock({ code, path, lang, startLine }: { code: string; path?: string; lang?: string; startLine?: number }) {
  const lines = useMemo(() => highlightLines(code, codeLanguage(path, lang)), [code, path, lang]);
  const width = startLine !== undefined ? String(startLine + lines.length - 1).length : 0;
  return (
    <pre className="repo-code code-block">
      <code>
        {lines.map((tokens, index) => (
          <Fragment key={index}>
            {index > 0 && '\n'}
            {startLine !== undefined && <span className="code-line-number" aria-hidden="true">{String(startLine + index).padStart(width)}</span>}
            <TokenLine tokens={tokens} />
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
