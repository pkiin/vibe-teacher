import ts from 'typescript';
import type { RepoDatabase, RepoDbColumn, RepoDbTable, RepoSource } from '@vibe-teacher/shared';
import { maskSecrets } from '../llm/digest';
import { truncate } from '../lib/text';
import { findModuleCalls, type NamedFunction } from './db-calls';

/**
 * 저장소 코드에서 데이터베이스 표 정의를 읽는다 (읽기 전용, 코드·명령을 실행하지 않음).
 *   SQL 마이그레이션(CREATE TABLE·ALTER TABLE·COMMENT ON), Prisma 스키마,
 *   Drizzle·TypeORM·Mongoose·Sequelize·Knex (TypeScript 구문 분석), SQLAlchemy·SQLModel·Django (줄 단위)
 * 이름·타입·제약은 원문 그대로 두고 뜻을 해석하지 않는다. 표가 무엇을 저장하는지와 어느 기능이 쓰는지는 AI 가 근거를 보고 쓴다.
 * 사용처는 표 이름 문자열(`'users'`, `/rest/v1/users`, SQL 의 FROM users)과 정의 파일을 불러오는 파일의 모델 이름으로 찾는다.
 */

type FileSource = Extract<RepoSource, { kind: 'file' }>;
type Kind = RepoDbTable['kind'];

export interface DbColumnDef {
  name: string;
  type: string;
  line: number;
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string;
  references?: string;
  check?: string;
  relation?: boolean;
  /** ALTER TABLE 로 다른 파일에서 더한 컬럼 */
  file?: string;
  /** 코드 주석 (AI 입력에만 쓴다) */
  note?: string;
}

export interface DbTableDef {
  name: string;
  schema?: string;
  kind: Kind;
  via: string;
  file: string;
  line: number;
  endLine: number;
  columns: DbColumnDef[];
  /** 코드에서 이 표를 가리키는 이름 (모델 클래스·변수). 정의 파일을 불러오는 파일에서 사용처를 찾는다 */
  aliases: string[];
  /** Prisma 클라이언트 접근자 (prisma.user.findMany 의 user) */
  accessor?: string;
  note?: string;
  /** ALTER TABLE·alterTable: 이미 정의된 표를 고친다 */
  alter?: { drop: string[]; rename: [string, string][]; change: (Partial<DbColumnDef> & { name: string })[]; constraints?: string[] };
}

/** SQL 함수(Supabase RPC 등). 본문에서 읽고 쓰는 표를 모아, 코드에서 이 함수를 부르는 줄을 그 표의 쓰는 곳으로 본다 */
export interface DbRoutineDef {
  name: string;
  schema?: string;
  file: string;
  line: number;
  /** 본문의 FROM·INTO·UPDATE·JOIN 뒤에 나온 이름 (tableKey 형식) */
  tables: string[];
  /** 본문에서 부르는 이름 (다른 SQL 함수를 거쳐 쓰는 표까지 따라가는 데 쓴다) */
  calls: string[];
}

/** AI 입력에만 쓰는 단서: 코드 주석과 사용 줄 원문 (가린 뒤 자름) */
export interface DbHints { note?: string; columns: Record<string, string>; usages: string[] }
export interface DbScan extends RepoDatabase {
  hints: Record<string, DbHints>;
  /** 표를 쓰는 줄이 있는 파일 → 그 파일을 불러오는 파일 (구문으로 읽은 import, 한 단계). 기능 연결 질문에 쓴다 */
  importers: Record<string, string[]>;
}

export const DB_LIMITS = { tables: 80, columns: 60, usages: 16, usagesPerFile: 3, schemaFiles: 80, importers: 12 } as const;

/** 정의를 읽을 SQL·Prisma 파일. 되돌리기(down) 마이그레이션과 테스트 폴더는 뺀다 */
export function isSchemaFile(file: string): boolean {
  return /\.(?:sql|prisma)$/i.test(file) && !/(^|\/)(test|tests|__tests__|fixtures)\//.test(file) && !/(^|[/._-])down\.sql$/i.test(file);
}

const raw = (s: string, max = 120) => truncate(maskSecrets(s.replace(/\s+/g, ' ').trim()), max);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}
function lineOf(starts: number[], offset: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** 괄호·따옴표 밖의 구분자로 나눈다. 조각마다 시작 위치를 함께 돌려준다 */
function splitTop(text: string, sep = ','): { text: string; at: number }[] {
  const parts: { text: string; at: number }[] = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) { parts.push({ text: text.slice(start, i), at: start }); start = i + 1; }
  }
  parts.push({ text: text.slice(start), at: start });
  return parts.filter((p) => p.text.trim());
}

/** open 위치의 여는 괄호와 짝이 되는 닫는 괄호 위치 */
function closeParen(text: string, open: number): number {
  let depth = 0, quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** 괄호·따옴표 안을 공백으로 바꾼 같은 길이의 문자열. 바깥의 키워드만 찾을 때 쓴다 */
function flat(text: string): string {
  const out: string[] = [];
  let depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { out.push(c === quote ? c : ' '); if (c === quote) quote = ''; continue; }
    if (depth === 0 && (c === "'" || c === '"' || c === '`')) { quote = c; out.push(c); continue; }
    if (c === '(') { out.push(depth === 0 ? c : ' '); depth++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); out.push(depth === 0 ? c : ' '); continue; }
    out.push(depth ? ' ' : c);
  }
  return out.join('');
}

// ---------- SQL ----------

const IDENT = String.raw`(?:"[^"\n]+"|\x60[^\x60\n]+\x60|\[[^\]\n]+\]|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;
const unquote = (s: string) => s.trim().replace(/^["`[]|["`\]]$/g, '');
const qparts = (q: string) => [...q.matchAll(new RegExp(IDENT, 'g'))].map((m) => unquote(m[0]));
const DEFAULT_SCHEMAS = new Set(['public', 'dbo', 'main']);

/** 주석과 $$ 함수 본문을 같은 길이의 공백으로 바꾼다 (줄 번호 유지). `--` 주석은 컬럼 설명 단서로 줄 번호와 함께 남긴다 */
function blankSql(text: string): { code: string; comments: Map<number, string> } {
  const out: string[] = [];
  const comments = new Map<number, string>();
  let line = 1;
  const blank = (chunk: string) => { out.push(chunk.replace(/[^\n]/g, ' ')); line += chunk.split('\n').length - 1; };
  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    if (c === '-' && text[i + 1] === '-') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = text.length;
      const note = text.slice(i + 2, end).trim();
      if (note) comments.set(line, note);
      out.push(' '.repeat(end - i));
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c) { if (text[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      const chunk = text.slice(i, Math.min(j + 1, text.length));
      out.push(chunk);
      line += chunk.split('\n').length - 1;
      i += chunk.length;
      continue;
    }
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(text.slice(i, i + 66))?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        const stop = end < 0 ? text.length : end + tag.length;
        blank(text.slice(i, stop));
        i = stop;
        continue;
      }
    }
    out.push(c);
    if (c === '\n') line++;
    i++;
  }
  return { code: out.join(''), comments };
}

const COLUMN_END = /\b(?:not\s+null|null|primary\s+key|unique|default|references|check|constraint|generated|collate|auto_increment|autoincrement|identity|comment|on\s+update)\b/i;
const TABLE_CONSTRAINT = new RegExp(String.raw`^\s*(?:constraint\s|primary\s+key\b|foreign\s+key\b|unique\s*(?:key|index)?\s*(?:${IDENT}\s*)?\(|check\s*\(|exclude\b|(?:key|index)\s+(?:${IDENT}\s*)?\(|(?:fulltext|spatial)\b|like\s|period\s)`, 'i');

/** 컬럼 정의 한 조각 (이름 타입 제약…) */
function sqlColumn(part: string, line: number): DbColumnDef | null {
  const head = new RegExp(String.raw`^\s*(${IDENT})\s*`).exec(part);
  if (!head) return null;
  const name = unquote(head[1]!);
  const rest = part.slice(head[0].length);
  const restFlat = flat(rest);
  const end = COLUMN_END.exec(restFlat);
  const typeEnd = end ? end.index : rest.length;
  const type = raw(rest.slice(0, typeEnd), 60);
  const cons = rest.slice(typeEnd), consFlat = restFlat.slice(typeEnd);
  const col: DbColumnDef = { name, type: type || '(타입 없음)', line };
  if (/\bprimary\s+key\b/i.test(consFlat)) col.primaryKey = true;
  if (/\bnot\s+null\b/i.test(consFlat)) col.notNull = true;
  if (/\bunique\b/i.test(consFlat)) col.unique = true;
  const def = /\bdefault\s+/i.exec(consFlat);
  if (def) {
    const from = def.index + def[0].length;
    const next = COLUMN_END.exec(consFlat.slice(from));
    col.default = raw(cons.slice(from, next ? from + next.index : cons.length), 80);
  } else {
    const auto = /\bgenerated\s+(?:always|by\s+default)\s+as\s+identity\b|\bauto_?increment\b|\bidentity\b/i.exec(consFlat);
    if (auto) col.default = raw(auto[0], 60);
  }
  const ref = new RegExp(String.raw`\breferences\s+(${QNAME})\s*(\([^)]*\))?`, 'i').exec(cons);
  if (ref) col.references = raw(`${qparts(ref[1]!).join('.')}${ref[2] ? ref[2].replace(/\s+/g, '') : ''}`, 80);
  const comment = /\bcomment\s+'((?:[^']|'')*)'/i.exec(cons);
  if (comment) col.note = raw(comment[1]!.replace(/''/g, "'"), 160);
  const check = /\bcheck\s*\(/i.exec(consFlat);
  if (check) {
    const open = check.index + check[0].length - 1;
    const close = closeParen(cons, open);
    if (close > open) col.check = raw(cons.slice(open + 1, close), 160);
  }
  return col;
}

const colList = (s: string) => s.split(',').map(unquote).filter(Boolean);

/** PRIMARY KEY (a, b)·UNIQUE (a)·FOREIGN KEY (a) REFERENCES t(b) 를 컬럼에 반영한다 */
function sqlTableConstraint(columns: DbColumnDef[], part: string): void {
  const text = part.replace(new RegExp(String.raw`^\s*constraint\s+${IDENT}\s+`, 'i'), '');
  const find = (name: string) => columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const pk = /^\s*primary\s+key\s*\(([^)]*)\)/i.exec(text);
  if (pk) for (const name of colList(pk[1]!)) { const c = find(name); if (c) c.primaryKey = true; }
  const unique = new RegExp(String.raw`^\s*unique(?:\s+(?:key|index))?\s*(?:${IDENT}\s*)?\(([^)]*)\)`, 'i').exec(text);
  if (unique) { const names = colList(unique[1]!); const c = names.length === 1 ? find(names[0]!) : undefined; if (c) c.unique = true; }
  const fk = new RegExp(String.raw`^\s*foreign\s+key\s*\(([^)]*)\)\s*references\s+(${QNAME})\s*(?:\(([^)]*)\))?`, 'i').exec(text);
  if (fk) {
    const local = colList(fk[1]!), target = qparts(fk[2]!).join('.'), refs = colList(fk[3] ?? '');
    local.forEach((name, i) => { const c = find(name); if (c) c.references = raw(`${target}${refs.length ? `(${refs[i] ?? refs.join(',')})` : ''}`, 80); });
  }
}

export function parseSql(file: string, text: string): DbTableDef[] {
  const { code, comments } = blankSql(text);
  const starts = lineStarts(code);
  const out: DbTableDef[] = [];
  const noteAt = (line: number) => comments.get(line);
  const nameOf = (q: string) => { const parts = qparts(q); return { name: parts.at(-1)!, ...(parts.length > 1 ? { schema: parts.at(-2)! } : {}) }; };
  const events: { at: number; run: () => void }[] = [];

  const create = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(table|(?:materialized\s+)?view)\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, 'gi');
  for (const m of code.matchAll(create)) {
    const at = m.index;
    events.push({ at, run: () => {
      const { name, schema } = nameOf(m[2]!);
      const line = lineOf(starts, at);
      if (/view/i.test(m[1]!)) {
        const stop = code.indexOf(';', at);
        out.push({ name, ...(schema ? { schema } : {}), kind: 'view', via: 'SQL', file, line, endLine: lineOf(starts, stop < 0 ? code.length : stop), columns: [], aliases: [] });
        return;
      }
      const after = at + m[0].length;
      const open = code.slice(after).search(/\S/) + after;
      if (code[open] !== '(') return;
      const close = closeParen(code, open);
      if (close < 0) return;
      const body = code.slice(open + 1, close);
      const columns: DbColumnDef[] = [];
      const constraints: string[] = [];
      for (const part of splitTop(body)) {
        const lead = part.text.search(/\S/);
        const line = lineOf(starts, open + 1 + part.at + Math.max(0, lead));
        if (TABLE_CONSTRAINT.test(part.text)) { constraints.push(part.text); continue; }
        const col = sqlColumn(part.text, line);
        if (col) columns.push({ ...col, ...(!col.note && noteAt(line) ? { note: raw(noteAt(line)!, 160) } : {}) });
      }
      for (const c of constraints) sqlTableConstraint(columns, c);
      const note = noteAt(line - 1) ?? noteAt(line);
      out.push({ name, ...(schema ? { schema } : {}), kind: 'table', via: 'SQL', file, line, endLine: lineOf(starts, close), columns, aliases: [], ...(note ? { note: raw(note, 200) } : {}) });
    } });
  }

  const alter = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([^;]*)`, 'gi');
  for (const m of code.matchAll(alter)) {
    const at = m.index;
    events.push({ at, run: () => {
      const { name, schema } = nameOf(m[1]!);
      const bodyAt = at + m[0].length - m[2]!.length;
      const columns: DbColumnDef[] = [];
      const change: NonNullable<DbTableDef['alter']>['change'] = [];
      const drop: string[] = [], rename: [string, string][] = [], constraints: string[] = [];
      for (const part of splitTop(m[2]!)) {
        const action = part.text.trim();
        const line = lineOf(starts, bodyAt + part.at + Math.max(0, part.text.search(/\S/)));
        const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/i.exec(action);
        if (add && !TABLE_CONSTRAINT.test(action.slice(add[0].length))) {
          const col = sqlColumn(action.slice(add[0].length), line);
          if (col) columns.push({ ...col, file, ...(noteAt(line) ? { note: raw(noteAt(line)!, 160) } : {}) });
          continue;
        }
        if (add) { constraints.push(action.slice(add[0].length)); continue; }
        const dropped = new RegExp(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`, 'i').exec(action);
        if (dropped && !/^drop\s+(?:constraint|index|default|not\s+null)\b/i.test(action)) { drop.push(unquote(dropped[1]!)); continue; }
        const renamed = new RegExp(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})`, 'i').exec(action);
        if (renamed && !/^rename\s+to\b/i.test(action)) { rename.push([unquote(renamed[1]!), unquote(renamed[2]!)]); continue; }
        const altered = new RegExp(String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(.*)$`, 'is').exec(action);
        if (altered) {
          const col = unquote(altered[1]!), what = altered[2]!.trim();
          const type = /^(?:set\s+data\s+)?type\s+(.+?)(?:\s+using\b.*)?$/is.exec(what);
          if (type) change.push({ name: col, type: raw(type[1]!, 60) });
          else if (/^set\s+not\s+null/i.test(what)) change.push({ name: col, notNull: true });
          else if (/^drop\s+not\s+null/i.test(what)) change.push({ name: col, notNull: false });
          else if (/^set\s+default\s+/i.test(what)) change.push({ name: col, default: raw(what.replace(/^set\s+default\s+/i, ''), 80) });
          else if (/^drop\s+default/i.test(what)) change.push({ name: col, default: '' });
        }
      }
      if (!columns.length && !change.length && !drop.length && !rename.length && !constraints.length) return;
      out.push({ name, ...(schema ? { schema } : {}), kind: 'table', via: 'SQL', file, line: lineOf(starts, at), endLine: lineOf(starts, at), columns, aliases: [], alter: { drop, rename, change, constraints } });
    } });
  }

  // COMMENT ON TABLE/COLUMN 은 표·컬럼 설명의 단서로만 쓴다
  const comment = new RegExp(String.raw`\bcomment\s+on\s+(table|column)\s+(${QNAME})\s+is\s+'((?:[^']|'')*)'`, 'gi');
  for (const m of code.matchAll(comment)) {
    events.push({ at: m.index, run: () => {
      const parts = qparts(m[2]!), note = raw(m[3]!.replace(/''/g, "'"), 200);
      const isColumn = /column/i.test(m[1]!);
      const table = isColumn ? parts.at(-2) : parts.at(-1);
      const schema = isColumn ? parts.at(-3) : parts.at(-2);
      if (!table) return;
      const line = lineOf(starts, m.index);
      out.push({ name: table, ...(schema ? { schema } : {}), kind: 'table', via: 'SQL', file, line, endLine: line, columns: [], aliases: [],
        alter: { drop: [], rename: [], change: isColumn ? [{ name: parts.at(-1)!, note }] : [] }, ...(isColumn ? {} : { note }) });
    } });
  }
  for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  return out;
}

/** SQL 함수·프로시저 정의. 본문($$ … $$ 또는 as '…')은 blankSql 이 지운 자리라 원문에서 꺼내 표 이름과 호출만 읽는다 */
export function parseSqlRoutines(file: string, text: string): DbRoutineDef[] {
  const { code } = blankSql(text);
  const starts = lineStarts(code);
  const out: DbRoutineDef[] = [];
  const head = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(${QNAME})\s*\(`, 'gi');
  for (const m of code.matchAll(head)) {
    const parts = qparts(m[1]!);
    const from = m.index + m[0].length;
    const stop = code.indexOf(';', from);
    const segment = text.slice(from, stop < 0 ? text.length : stop);
    const tag = /\$(?:[A-Za-z_]\w*)?\$/.exec(segment);
    let body = '';
    if (tag) {
      const open = tag.index + tag[0].length, close = segment.indexOf(tag[0], open);
      body = segment.slice(open, close < 0 ? segment.length : close);
    } else body = /\bas\s+'((?:[^']|'')*)'/i.exec(segment)?.[1]?.replace(/''/g, "'") ?? '';
    if (!body.trim()) continue;
    const inner = blankSql(body).code;
    const tables = new Set<string>();
    for (const t of inner.matchAll(new RegExp(String.raw`\b(?:from|into|update|join)\s+(?:only\s+)?(${QNAME})`, 'gi'))) {
      const p = qparts(t[1]!);
      tables.add(tableKey({ name: p.at(-1)!, ...(p.length > 1 ? { schema: p.at(-2)! } : {}) }));
    }
    const calls = new Set([...inner.matchAll(new RegExp(String.raw`(${IDENT})\s*\(`, 'g'))].map((c) => unquote(c[1]!).toLowerCase()));
    out.push({ name: parts.at(-1)!, ...(parts.length > 1 ? { schema: parts.at(-2)! } : {}), file, line: lineOf(starts, m.index), tables: [...tables], calls: [...calls] });
  }
  return out;
}

// ---------- Prisma ----------

export function parsePrisma(file: string, text: string): DbTableDef[] {
  const lines = text.split(/\r?\n/);
  const models = new Set<string>(), enums = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const head = /^\s*(model|enum|view)\s+(\w+)\s*\{/.exec(line);
    if (head) { current = head[1] === 'enum' ? head[2]! : null; if (head[1] !== 'enum') models.add(head[2]!); else enums.set(head[2]!, []); continue; }
    if (/^\s*\}/.test(line)) { current = null; continue; }
    const value = current && /^\s*(\w+)/.exec(line.replace(/\/\/.*$/, ''));
    if (current && value) enums.get(current)!.push(value[1]!);
  }
  const out: DbTableDef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^\s*(model|view)\s+(\w+)\s*\{/.exec(lines[i]!);
    if (!head) continue;
    const model = head[2]!;
    const columns: DbColumnDef[] = [];
    const links: { fields: string[]; refs: string[]; target: string }[] = [];
    let table: string | undefined, doc: string | undefined, end = i;
    for (let j = i + 1; j < lines.length; j++) {
      end = j;
      const line = lines[j]!;
      if (/^\s*\}/.test(line)) break;
      const docLine = /^\s*\/\/\/\s?(.*)$/.exec(line);
      if (docLine) { doc = doc ? `${doc} ${docLine[1]}` : docLine[1]; continue; }
      const code = line.replace(/\s\/\/.*$/, '').replace(/^\s*\/\/.*$/, '');
      const map = /^\s*@@map\(\s*"([^"]+)"/.exec(code);
      if (map) { table = map[1]; continue; }
      const ids = /^\s*@@id\(\s*(?:fields:\s*)?\[([^\]]*)\]/.exec(code);
      if (ids) { for (const name of colList(ids[1]!)) { const c = columns.find((x) => x.name === name); if (c) c.primaryKey = true; } continue; }
      if (/^\s*@@/.test(code)) continue;
      const field = /^\s*(\w+)\s+(\w+(?:\([^)]*\))?)(\[\])?(\?)?\s*(.*)$/.exec(code);
      if (!field) { doc = undefined; continue; }
      const name = field[1]!, base = field[2]!, list = !!field[3], optional = !!field[4], attrs = field[5] ?? '';
      const relation = models.has(base);
      const native = /@db\.(\w+(?:\([^)]*\))?)/.exec(attrs)?.[1];
      const col: DbColumnDef = { name: /@map\(\s*"([^"]+)"/.exec(attrs)?.[1] ?? name, type: `${base}${list ? '[]' : ''}${optional ? '?' : ''}${native ? ` (${native})` : ''}`, line: j + 1 };
      if (/@id\b/.test(attrs)) col.primaryKey = true;
      if (/@unique\b/.test(attrs)) col.unique = true;
      if (!optional && !list && !relation) col.notNull = true;
      if (relation) col.relation = true;
      const dflt = attrs.indexOf('@default(');
      if (dflt >= 0) { const close = closeParen(attrs, dflt + 8); if (close > 0) col.default = raw(attrs.slice(dflt + 9, close), 80); }
      if (enums.has(base)) col.check = raw(enums.get(base)!.join(' | '), 160);
      const rel = /@relation\(([^)]*)\)/.exec(attrs)?.[1];
      const fields = rel && /fields:\s*\[([^\]]*)\]/.exec(rel)?.[1], refs = rel && /references:\s*\[([^\]]*)\]/.exec(rel)?.[1];
      if (fields) links.push({ fields: colList(fields), refs: colList(refs ?? ''), target: base });
      if (doc) col.note = raw(doc, 160);
      doc = undefined;
      columns.push(col);
    }
    for (const link of links) link.fields.forEach((name, k) => {
      const c = columns.find((x) => x.name === name);
      if (c) c.references = `${link.target}(${link.refs[k] ?? link.refs.join(',')})`;
    });
    out.push({ name: table ?? model, kind: head[1] === 'view' ? 'view' : 'table', via: 'Prisma', file, line: i + 1, endLine: end + 1, columns, aliases: [model], accessor: lowerFirst(model) });
    i = end;
  }
  return out;
}

// ---------- TypeScript·JavaScript (Drizzle, TypeORM, Mongoose, Sequelize, Knex) ----------

const DRIZZLE_TABLE = /^(?:pg|mysql|sqlite|singlestore)Table$/;
const TYPEORM_COLUMN = /^(?:Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn|ViewColumn)$/;
const TYPEORM_RELATION = /^(?:ManyToOne|OneToOne|OneToMany|ManyToMany)$/;
const KNEX_NOT_COLUMN = new Set(['primary', 'unique', 'index', 'foreign', 'dropColumn', 'dropColumns', 'renameColumn', 'dropForeign', 'dropIndex', 'dropUnique', 'dropPrimary', 'comment', 'engine', 'charset', 'collate', 'inherits', 'check', 'setNullable', 'dropNullable', 'dropTimestamps', 'timestamps', 'dropChecks', 'queryContext']);

export function parseScript(file: string, text: string): DbTableDef[] {
  if (!/drizzle-orm|(?:pg|mysql|sqlite|singlestore)Table\b|typeorm|mongoose|sequelize|knex|createTable|\bSchema\s*\(/.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lineOfNode = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const endOfNode = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const str = (node?: ts.Node): string | undefined => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const textOf = (node: ts.Node, max = 80) => raw(node.getText(sf), max);
  const keyOf = (name: ts.PropertyName) => ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText(sf);
  const prop = (obj: ts.Node | undefined, name: string) => obj && ts.isObjectLiteralExpression(obj)
    ? obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && keyOf(p.name) === name)?.initializer : undefined;
  const isTrue = (node?: ts.Node) => node?.kind === ts.SyntaxKind.TrueKeyword;
  const isFalse = (node?: ts.Node) => node?.kind === ts.SyntaxKind.FalseKeyword;
  const varName = (node: ts.Node) => { const p = node.parent; return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : undefined; };
  /** a.b().c(x) 를 바깥 메서드부터 풀어 기본 호출과 이어진 메서드 목록으로 나눈다 */
  const unwind = (node: ts.Expression) => {
    const methods: { name: string; args: readonly ts.Expression[] }[] = [];
    let cur: ts.Expression = node;
    while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ts.isCallExpression(cur.expression.expression)) {
      methods.unshift({ name: cur.expression.name.text, args: cur.arguments });
      cur = cur.expression.expression;
    }
    return { base: ts.isCallExpression(cur) ? cur : undefined, methods };
  };
  const calleeName = (call: ts.CallExpression) => ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : '';
  const out: DbTableDef[] = [];
  const drizzleEnums = new Map<string, string>();
  const mongooseModels = new Map<string, { name: string; alias?: string }>();

  // 1차: Drizzle enum, Mongoose model('Name', schema) 연결
  const pre = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (/^(?:pg|mysql)Enum$/.test(name) && node.arguments[1]) { const v = varName(node); if (v) drizzleEnums.set(v, textOf(node.arguments[1], 160)); }
      if (name === 'model' && str(node.arguments[0]) && node.arguments[1] && ts.isIdentifier(node.arguments[1])) {
        const alias = varName(node);
        mongooseModels.set(node.arguments[1].text, { name: str(node.arguments[0])!, ...(alias ? { alias } : {}) });
      }
    }
    ts.forEachChild(node, pre);
  };
  pre(sf);

  const drizzleColumns = (obj: ts.ObjectLiteralExpression): DbColumnDef[] => obj.properties.flatMap((p): DbColumnDef[] => {
    if (!ts.isPropertyAssignment(p)) return [];
    const { base, methods } = unwind(p.initializer);
    if (!base) return [];
    const type = calleeName(base);
    const extra = base.arguments.filter((a) => !str(a));
    const col: DbColumnDef = { name: str(base.arguments[0]) ?? keyOf(p.name), type: `${type}${extra.length ? `(${raw(extra.map((a) => a.getText(sf)).join(', '), 40)})` : ''}`, line: lineOfNode(p) };
    if (drizzleEnums.has(type)) col.check = drizzleEnums.get(type)!;
    for (const m of methods) {
      if (m.name === 'primaryKey') col.primaryKey = true;
      else if (m.name === 'notNull') col.notNull = true;
      else if (m.name === 'unique') col.unique = true;
      else if (m.name === 'array') col.type += '[]';
      else if (m.name === 'default' && m.args[0]) col.default = textOf(m.args[0]);
      else if (/^(?:defaultNow|defaultRandom|\$defaultFn|\$default|\$onUpdate|\$onUpdateFn|generatedAlwaysAsIdentity|generatedByDefaultAsIdentity|generatedAlwaysAs)$/.test(m.name)) col.default = m.args[0] ? `${m.name}(${textOf(m.args[0], 60)})` : `${m.name}()`;
      else if (m.name === 'references' && m.args[0]) {
        const target = m.args[0];
        col.references = textOf(ts.isArrowFunction(target) && !ts.isBlock(target.body) ? target.body : target);
      }
    }
    return [col];
  });

  const fieldColumns = (obj: ts.ObjectLiteralExpression, style: 'mongoose' | 'sequelize'): DbColumnDef[] => obj.properties.flatMap((p): DbColumnDef[] => {
    if (!ts.isPropertyAssignment(p)) return [];
    let value = p.initializer, list = false;
    if (ts.isArrayLiteralExpression(value) && value.elements[0]) { value = value.elements[0]; list = true; }
    const line = lineOfNode(p);
    if (!ts.isObjectLiteralExpression(value)) return [{ name: keyOf(p.name), type: `${textOf(value, 60)}${list ? '[]' : ''}`, line }];
    const type = prop(value, 'type');
    if (!type) return [{ name: keyOf(p.name), type: textOf(value, 60), line }];
    const col: DbColumnDef = { name: str(prop(value, 'field')) ?? keyOf(p.name), type: `${textOf(type, 60)}${list ? '[]' : ''}`, line };
    const required = prop(value, 'required');
    if (style === 'mongoose' ? (isTrue(required) || (required && ts.isArrayLiteralExpression(required))) : isFalse(prop(value, 'allowNull'))) col.notNull = true;
    if (isTrue(prop(value, 'primaryKey'))) col.primaryKey = true;
    const unique = prop(value, 'unique');
    if (unique && !isFalse(unique)) col.unique = true;
    const dflt = prop(value, style === 'mongoose' ? 'default' : 'defaultValue');
    if (dflt) col.default = textOf(dflt);
    if (isTrue(prop(value, 'autoIncrement'))) col.default = 'autoIncrement';
    const ref = prop(value, 'ref');
    const refs = prop(value, 'references');
    if (ref) col.references = str(ref) ?? textOf(ref);
    else if (refs && ts.isObjectLiteralExpression(refs)) { const model = prop(refs, 'model'), key = prop(refs, 'key'); if (model) col.references = `${str(model) ?? textOf(model)}${key ? `(${str(key) ?? textOf(key)})` : ''}`; }
    const choices = prop(value, 'enum') ?? prop(value, 'values');
    if (choices) col.check = textOf(choices, 160);
    return [col];
  });

  const knexColumns = (fn: ts.ArrowFunction | ts.FunctionExpression) => {
    const param = fn.parameters[0]?.name;
    const columns: DbColumnDef[] = [];
    const drop: string[] = [], rename: [string, string][] = [];
    if (!param || !ts.isIdentifier(param)) return { columns, drop, rename };
    const p = param.text;
    const find = (name: string) => columns.find((c) => c.name === name);
    const visit = (node: ts.Node): void => {
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const { base, methods } = unwind(node.expression);
        if (base && ts.isPropertyAccessExpression(base.expression) && ts.isIdentifier(base.expression.expression) && base.expression.expression.text === p) {
          const kind = base.expression.name.text, first = str(base.arguments[0]);
          const names = base.arguments[0] && ts.isArrayLiteralExpression(base.arguments[0]) ? base.arguments[0].elements.flatMap((e) => str(e) ?? []) : first ? [first] : [];
          const line = lineOfNode(node);
          if (kind === 'timestamps') for (const name of ['created_at', 'updated_at']) columns.push({ name, type: 'timestamp', line, default: 'timestamps()' });
          else if (kind === 'primary') for (const name of names) { const c = find(name); if (c) c.primaryKey = true; }
          else if (kind === 'unique' && names.length === 1) { const c = find(names[0]!); if (c) c.unique = true; }
          else if (kind === 'foreign' && first) {
            const c = find(first);
            const target = methods.find((m) => m.name === 'references')?.args[0], table = methods.find((m) => m.name === 'inTable')?.args[0];
            if (c && target) c.references = `${str(table) ? `${str(table)}.` : ''}${str(target) ?? textOf(target)}`;
          } else if (kind === 'dropColumn' || kind === 'dropColumns') drop.push(...base.arguments.flatMap((a) => str(a) ?? []));
          else if (kind === 'renameColumn' && first && str(base.arguments[1])) rename.push([first, str(base.arguments[1])!]);
          else if (first && !KNEX_NOT_COLUMN.has(kind)) {
            const col: DbColumnDef = { name: first, type: `${kind}${base.arguments.length > 1 ? `(${raw(base.arguments.slice(1).map((a) => a.getText(sf)).join(', '), 40)})` : ''}`, line };
            if (/^(?:increments|bigIncrements)$/.test(kind)) { col.primaryKey = true; col.default = kind; }
            if (/^(?:enum|enu)$/.test(kind) && base.arguments[1]) col.check = textOf(base.arguments[1], 160);
            let target: string | undefined, table: string | undefined;
            for (const m of methods) {
              if (m.name === 'notNullable') col.notNull = true;
              else if (m.name === 'nullable') col.notNull = false;
              else if (m.name === 'primary') col.primaryKey = true;
              else if (m.name === 'unique') col.unique = true;
              else if (m.name === 'unsigned') col.type += ' unsigned';
              else if (m.name === 'defaultTo' && m.args[0]) col.default = textOf(m.args[0]);
              else if (m.name === 'references' && m.args[0]) target = str(m.args[0]) ?? textOf(m.args[0]);
              else if (m.name === 'inTable' && m.args[0]) table = str(m.args[0]) ?? textOf(m.args[0]);
              else if (m.name === 'comment' && str(m.args[0])) col.note = raw(str(m.args[0])!, 160);
            }
            if (target) col.references = `${table ? `${table}.` : ''}${target}`;
            columns.push(col);
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    return { columns, drop, rename };
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node), [a0, a1, a2] = node.arguments;
      const table = str(a0);
      const fnArg = a1 && (ts.isArrowFunction(a1) || ts.isFunctionExpression(a1)) ? a1 : undefined;
      const fnObject = fnArg && ts.isArrowFunction(fnArg) && !ts.isBlock(fnArg.body) ? (ts.isParenthesizedExpression(fnArg.body) ? fnArg.body.expression : fnArg.body) : undefined;
      const base = { file, line: lineOfNode(node), endLine: endOfNode(node) };
      // Drizzle: pgTable('users', { … }) 또는 pgTable('users', (t) => ({ … }))
      const drizzleObj = a1 && ts.isObjectLiteralExpression(a1) ? a1 : fnObject && ts.isObjectLiteralExpression(fnObject) ? fnObject : undefined;
      if (table && drizzleObj && (DRIZZLE_TABLE.test(name) || (name === 'table' && ts.isPropertyAccessExpression(node.expression) && /drizzle-orm/.test(text)))) {
        const alias = varName(node);
        out.push({ ...base, name: table, kind: 'table', via: 'Drizzle', columns: drizzleColumns(drizzleObj), aliases: alias ? [alias] : [] });
        return;
      }
      // Knex: schema.createTable('users', (t) => { t.string('email') … }) · alterTable
      if (table && fnArg && ts.isBlock(fnArg.body) && /^(?:createTable|createTableIfNotExists|alterTable|table)$/.test(name) && (name !== 'table' || /knex/.test(text))) {
        const { columns, drop, rename } = knexColumns(fnArg);
        const alter = !/^createTable/.test(name);
        out.push({ ...base, name: table, kind: 'table', via: 'Knex', columns, aliases: [], ...(alter ? { alter: { drop, rename, change: [] } } : {}) });
        // knex.schema.createTable(…).alterTable(…) 처럼 이어진 앞 호출도 읽는다
        visit(node.expression);
        return;
      }
      // Sequelize: queryInterface.createTable('users', { … }) · sequelize.define('User', { … }) · User.init({ … }, { sequelize, tableName })
      if (table && a1 && ts.isObjectLiteralExpression(a1) && name === 'createTable') {
        out.push({ ...base, name: table, kind: 'table', via: 'Sequelize', columns: fieldColumns(a1, 'sequelize'), aliases: [] });
        return;
      }
      if (table && a1 && ts.isObjectLiteralExpression(a1) && name === 'define' && /sequelize/i.test(text)) {
        const tableName = str(prop(a2, 'tableName')), alias = varName(node);
        out.push({ ...base, name: tableName ?? table, kind: tableName ? 'table' : 'model', via: 'Sequelize', columns: fieldColumns(a1, 'sequelize'), aliases: [alias, table].filter((x): x is string => !!x) });
        return;
      }
      if (name === 'init' && a0 && ts.isObjectLiteralExpression(a0) && a1 && ts.isObjectLiteralExpression(a1) && (prop(a1, 'sequelize') || a1.properties.some((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === 'sequelize'))
        && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const model = node.expression.expression.text, tableName = str(prop(a1, 'tableName')) ?? str(prop(a1, 'modelName'));
        out.push({ ...base, name: tableName ?? model, kind: str(prop(a1, 'tableName')) ? 'table' : 'model', via: 'Sequelize', columns: fieldColumns(a0, 'sequelize'), aliases: [model] });
        return;
      }
    }
    // Mongoose: new Schema({ … }, { collection, timestamps })
    if (ts.isNewExpression(node) && /(^|\.)Schema$/.test(node.expression.getText(sf)) && node.arguments?.[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const schemaVar = varName(node), opts = node.arguments[1];
      const linked = schemaVar ? mongooseModels.get(schemaVar) : undefined;
      const collection = str(prop(opts, 'collection'));
      const columns = fieldColumns(node.arguments[0], 'mongoose');
      if (isTrue(prop(opts, 'timestamps'))) for (const name of ['createdAt', 'updatedAt']) columns.push({ name, type: 'Date', line: lineOfNode(node), default: 'timestamps: true' });
      const name = collection ?? linked?.name ?? schemaVar;
      if (name) out.push({ file, line: lineOfNode(node), endLine: endOfNode(node), name, kind: collection ? 'collection' : 'model', via: 'Mongoose', columns,
        aliases: [linked?.alias, linked?.name].filter((x): x is string => !!x) });
      return;
    }
    // TypeORM: @Entity('users') class User { @Column() email: string }
    if (ts.isClassDeclaration(node) && node.name) {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
      const entity = decorators.map((d) => d.expression).find((e) => /^(?:Entity|ViewEntity)$/.test(ts.isCallExpression(e) ? calleeName(e) : e.getText(sf)));
      if (entity) {
        const arg = ts.isCallExpression(entity) ? entity.arguments[0] : undefined;
        const tableName = str(arg) ?? str(prop(arg, 'name'));
        const columns: DbColumnDef[] = [];
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !ts.canHaveDecorators(member)) continue;
          for (const d of ts.getDecorators(member) ?? []) {
            const call = ts.isCallExpression(d.expression) ? d.expression : undefined;
            const kind = call ? calleeName(call) : d.expression.getText(sf);
            const field = keyOf(member.name), line = lineOfNode(member);
            if (TYPEORM_COLUMN.test(kind)) {
              const opts = call?.arguments.find(ts.isObjectLiteralExpression);
              const type = str(call?.arguments[0]) ?? (prop(opts, 'type') ? (str(prop(opts, 'type')) ?? textOf(prop(opts, 'type')!)) : member.type ? textOf(member.type, 60) : kind);
              const col: DbColumnDef = { name: str(prop(opts, 'name')) ?? field, type, line };
              if (kind.startsWith('Primary')) col.primaryKey = true;
              if (kind === 'Column' && !isTrue(prop(opts, 'nullable'))) col.notNull = true;
              if (isTrue(prop(opts, 'unique'))) col.unique = true;
              const dflt = prop(opts, 'default');
              if (dflt) col.default = textOf(dflt);
              else if (kind !== 'Column' && kind !== 'PrimaryColumn' && kind !== 'ViewColumn') col.default = `@${kind}`;
              const choices = prop(opts, 'enum');
              if (choices) col.check = textOf(choices, 160);
              columns.push(col);
            } else if (TYPEORM_RELATION.test(kind)) {
              const target = call?.arguments[0];
              const to = target && ts.isArrowFunction(target) && !ts.isBlock(target.body) ? textOf(target.body, 60) : target ? textOf(target, 60) : '?';
              columns.push({ name: field, type: `${kind}(${to})`, line, relation: true, ...(kind === 'ManyToOne' || kind === 'OneToOne' ? { references: to } : {}) });
            }
          }
        }
        const isView = /ViewEntity/.test(entity.getText(sf));
        out.push({ file, line: lineOfNode(node), endLine: endOfNode(node), name: tableName ?? node.name.text, kind: isView ? 'view' : tableName ? 'table' : 'model', via: 'TypeORM', columns, aliases: [node.name.text] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------- Python (SQLAlchemy, SQLModel, Django) ----------

interface PyLine { text: string; line: number; indent: number; note?: string }

/** 괄호가 닫힐 때까지 이어 붙인 논리 줄. 주석은 떼어 note 로 두고, 여러 줄 문자열(docstring)은 건너뛴다 */
function pythonLines(text: string): PyLine[] {
  const lines = text.split(/\r?\n/);
  const out: PyLine[] = [];
  let pending: PyLine | null = null, depth = 0, triple = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (triple) { if (line.includes(triple)) triple = ''; continue; }
    let code = '', quote = '', note: string | undefined;
    for (let k = 0; k < line.length; k++) {
      const c = line[k]!;
      if (quote) { code += c; if (c === '\\') { code += line[k + 1] ?? ''; k++; } else if (c === quote) quote = ''; continue; }
      const three = line.slice(k, k + 3);
      if (three === '"""' || three === "'''") {
        const close = line.indexOf(three, k + 3);
        if (close < 0) { triple = three; break; }
        code += line.slice(k, close + 3); k = close + 2; continue;
      }
      if (c === '#') { note = line.slice(k + 1).trim(); break; }
      if (c === '"' || c === "'") quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      code += c;
    }
    line = code;
    if (pending) { pending.text += ` ${line.trim()}`; if (note && !pending.note) pending.note = note; }
    else if (line.trim()) pending = { text: line.trimEnd(), line: i + 1, indent: line.length - line.trimStart().length, ...(note ? { note } : {}) };
    if (pending && depth === 0 && !/\\$/.test(pending.text)) { pending.text = pending.text.trim(); out.push(pending); pending = null; }
    else if (pending) pending.text = pending.text.replace(/\\$/, '');
  }
  if (pending) out.push(pending);
  return out;
}

const pyString = (s?: string) => s ? /^[rbuf]*(['"])(.*)\1$/is.exec(s.trim())?.[2] : undefined;

/** f(a, b, k=v) 의 인자를 위치 인자와 키워드 인자로 나눈다 */
function pyArgs(inner: string): { positional: string[]; keywords: Map<string, string> } {
  const positional: string[] = [], keywords = new Map<string, string>();
  for (const part of splitTop(inner)) {
    const kw = /^\s*(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(part.text);
    if (kw) keywords.set(kw[1]!, kw[2]!.trim()); else positional.push(part.text.trim());
  }
  return { positional, keywords };
}

/** `Name(…)` 호출의 괄호 안 */
function callInner(text: string, at: number): string | undefined {
  const open = text.indexOf('(', at);
  const close = open >= 0 ? closeParen(text, open) : -1;
  return close > open ? text.slice(open + 1, close) : undefined;
}

function sqlalchemyColumn(name: string, annotation: string | undefined, value: string | undefined, line: number, note?: string): DbColumnDef | null {
  const mapped = annotation && /^Mapped\[(.*)\]$/.exec(annotation.trim())?.[1];
  const optional = !!mapped && /^Optional\[|\|\s*None\b|\bNone\s*\|/.test(mapped);
  const call = value && /^(?:\w+\.)?(Column|mapped_column|relationship|column_property|Field|Relationship)\s*\(/.exec(value);
  if (!call && !mapped && !(annotation && value === undefined)) return null;
  const col: DbColumnDef = { name, type: raw(mapped ?? annotation ?? '', 60), line, ...(note ? { note: raw(note, 160) } : {}) };
  if (call && /^(?:relationship|Relationship)$/.test(call[1]!)) return { ...col, type: raw(pyArgs(callInner(value!, 0) ?? '').positional[0] ?? col.type, 60) || 'relationship', relation: true };
  if (!call) { if (!optional && !/\bNone\b|Optional\[/.test(annotation ?? '')) col.notNull = true; return col.type ? col : null; }
  const { positional, keywords } = pyArgs(callInner(value!, 0) ?? '');
  for (const arg of positional) {
    const fk = /^(?:\w+\.)?ForeignKey\(\s*(['"])(.+?)\1/.exec(arg);
    if (fk) col.references = raw(fk[2]!, 80);
    else if (pyString(arg) && positional.indexOf(arg) === 0 && call[1] !== 'Field') col.name = pyString(arg)!;
    else if (!col.type || mapped) col.type = raw(arg, 60);
  }
  if (!col.type) col.type = raw(annotation ?? '(타입 없음)', 60);
  if (keywords.get('primary_key') === 'True') col.primaryKey = true;
  if (keywords.get('unique') === 'True') col.unique = true;
  const nullable = keywords.get('nullable');
  if (nullable === 'False' || (nullable !== 'True' && (mapped ? !optional : call[1] === 'Field' ? !/\bNone\b|Optional\[/.test(annotation ?? '') : false))) col.notNull = true;
  const dflt = keywords.get('default') ?? keywords.get('server_default') ?? keywords.get('default_factory');
  if (dflt !== undefined) col.default = raw(dflt, 80);
  const fk = keywords.get('foreign_key');
  if (fk) col.references = raw(pyString(fk) ?? fk, 80);
  const comment = keywords.get('comment') ?? keywords.get('description');
  if (comment && !col.note) col.note = raw(pyString(comment) ?? comment, 160);
  return col;
}

function djangoColumn(name: string, value: string, line: number, note?: string): DbColumnDef | null {
  const call = /^(?:models\.)?(\w*Field|ForeignKey|OneToOneField|ManyToManyField)\s*\(/.exec(value);
  if (!call) return null;
  const kind = call[1]!;
  const { positional, keywords } = pyArgs(callInner(value, 0) ?? '');
  const col: DbColumnDef = { name: pyString(keywords.get('db_column')) ?? name, type: kind + (keywords.has('max_length') ? `(${keywords.get('max_length')})` : ''), line, ...(note ? { note: raw(note, 160) } : {}) };
  if (kind === 'ManyToManyField') return { ...col, relation: true, references: raw(positional[0] ?? keywords.get('to') ?? '?', 80) };
  if (kind === 'ForeignKey' || kind === 'OneToOneField') col.references = raw(positional[0] ?? keywords.get('to') ?? '?', 80);
  if (keywords.get('primary_key') === 'True') col.primaryKey = true;
  if (keywords.get('unique') === 'True' || kind === 'OneToOneField') col.unique = true;
  if (keywords.get('null') !== 'True') col.notNull = true;
  if (keywords.has('default')) col.default = raw(keywords.get('default')!, 80);
  if (keywords.has('choices')) col.check = raw(keywords.get('choices')!, 160);
  const help = keywords.get('help_text') ?? keywords.get('verbose_name');
  if (help && !col.note) col.note = raw(pyString(help) ?? help, 160);
  return col;
}

export function parsePython(file: string, text: string): DbTableDef[] {
  if (!/sqlalchemy|sqlmodel|django|\bColumn\(|mapped_column|models\.Model/.test(text)) return [];
  const lines = pythonLines(text);
  const out: DbTableDef[] = [];
  const django = /django/.test(text);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    // SQLAlchemy Core: users = Table('users', metadata, Column('id', …), …)
    const core = /^(\w+)\s*=\s*(?:\w+\.)?Table\(\s*(['"])(\w+)\2\s*,/.exec(l.text);
    if (core) {
      const { positional } = pyArgs(callInner(l.text, l.text.indexOf('Table')) ?? '');
      const columns = positional.flatMap((arg) => {
        const inner = /^(?:\w+\.)?Column\(/.test(arg) ? callInner(arg, 0) : undefined;
        const name = inner ? pyString(pyArgs(inner).positional[0]) : undefined;
        const col = name ? sqlalchemyColumn(name, undefined, arg, l.line) : null;
        return col ? [col] : [];
      });
      out.push({ name: core[3]!, kind: 'table', via: 'SQLAlchemy', file, line: l.line, endLine: l.line, columns, aliases: [core[1]!] });
      continue;
    }
    const cls = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(l.text);
    if (!cls) continue;
    const className = cls[1]!, bases = cls[2] ?? '';
    const body: PyLine[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j]!.indent > l.indent; j++) body.push(lines[j]!);
    const memberIndent = body[0]?.indent;
    const members = body.filter((b) => b.indent === memberIndent);
    const isDjango = django && /\bmodels\.Model\b|\bModel\b/.test(bases);
    const isSqlModel = /\bSQLModel\b/.test(bases) && /table\s*=\s*True/.test(bases);
    const tablename = members.map((m) => /^__tablename__\s*(?::\s*\w+\s*)?=\s*(.+)$/.exec(m.text)?.[1]).find(Boolean);
    const metaAt = body.findIndex((b) => b.indent === memberIndent && /^class\s+Meta\b/.test(b.text));
    const dbTable = metaAt >= 0 ? body.slice(metaAt + 1).find((b) => b.indent > memberIndent! && /^db_table\s*=/.test(b.text))?.text.replace(/^db_table\s*=\s*/, '') : undefined;
    const columns: DbColumnDef[] = [];
    for (const m of members) {
      const member = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(m.text);
      if (!member || member[1]!.startsWith('__') || /^(?:class|def|async|@)/.test(m.text)) continue;
      const name = member[1]!, annotation = member[2], value = member[3];
      const col = isDjango ? (value ? djangoColumn(name, value, m.line, m.note) : null) : sqlalchemyColumn(name, annotation, value, m.line, m.note);
      if (col && (isDjango || isSqlModel || tablename || /\b(?:Column|mapped_column|relationship)\(/.test(value ?? '') || /^Mapped\[/.test(annotation ?? ''))) columns.push(col);
    }
    const explicit = pyString(tablename) ?? pyString(dbTable);
    const isSqlAlchemy = !!tablename || (columns.some((c) => !c.relation) && /\b(?:Base|DeclarativeBase|db\.Model|Model)\b/.test(bases));
    if (!columns.length || !(isDjango || isSqlModel || isSqlAlchemy)) { i = j - 1; continue; }
    out.push({ name: explicit ?? className, kind: explicit ? 'table' : 'model', via: isDjango ? 'Django' : isSqlModel ? 'SQLModel' : 'SQLAlchemy', file, line: l.line, endLine: lines[j - 1]?.line ?? l.line, columns, aliases: [className] });
    i = j - 1;
  }
  return out;
}

/** 파일 하나에서 표 정의를 찾는다. 구문을 읽지 못한 파일은 건너뛴다 */
export function extractDbDefs(file: string, text: string): DbTableDef[] {
  try {
    if (/\.sql$/i.test(file)) return parseSql(file, text);
    if (/\.prisma$/i.test(file)) return parsePrisma(file, text);
    if (/\.[cm]?[jt]sx?$/.test(file)) return parseScript(file, text);
    if (file.endsWith('.py')) return parsePython(file, text);
  } catch {
    // 형식이 맞지 않는 파일은 표가 없는 것으로 본다
  }
  return [];
}

/** SQL 파일의 함수 정의. 읽지 못한 파일은 건너뛴다 */
export function extractDbRoutines(file: string, text: string): DbRoutineDef[] {
  if (!/\.sql$/i.test(file)) return [];
  try { return parseSqlRoutines(file, text); } catch { return []; }
}

// ---------- 합치기와 사용처 ----------

const tableKey = (t: { name: string; schema?: string }) => `${t.schema && !DEFAULT_SCHEMAS.has(t.schema.toLowerCase()) ? `${t.schema}.` : ''}${t.name}`.toLowerCase();

/** 같은 표의 정의를 합친다: 나중 CREATE 가 앞의 것을 대신하고, ALTER 는 순서대로 반영한다. ORM 정의가 있으면 그 ORM 이 만든 SQL 보다 우선한다 */
export function mergeDbDefs(defs: DbTableDef[]): DbTableDef[] {
  const tables = new Map<string, DbTableDef>();
  const alters: DbTableDef[] = [];
  const apply = (target: DbTableDef, alter: DbTableDef) => {
    const find = (name: string) => target.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    for (const col of alter.columns) { if (!find(col.name)) target.columns.push(col); }
    for (const name of alter.alter?.drop ?? []) target.columns = target.columns.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
    for (const [from, to] of alter.alter?.rename ?? []) { const c = find(from); if (c) c.name = to; }
    for (const change of alter.alter?.change ?? []) {
      const c = change.name ? find(change.name) : undefined;
      if (!c) continue;
      if (change.type) c.type = change.type;
      if (change.notNull !== undefined) c.notNull = change.notNull || undefined;
      if (change.default !== undefined) c.default = change.default || undefined;
      if (change.note) c.note = change.note;
    }
    for (const c of alter.alter?.constraints ?? []) sqlTableConstraint(target.columns, c);
    if (alter.note) target.note = alter.note;
  };
  for (const def of [...defs].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    const key = tableKey(def);
    const existing = tables.get(key);
    if (def.alter) {
      // ORM 정의가 있는 표는 그 ORM 이 만든 SQL 의 ALTER 를 반영하지 않는다
      if (existing?.via === def.via) apply(existing, def);
      else if (!existing) alters.push(def);
      continue;
    }
    if (existing && existing.via !== 'SQL' && def.via === 'SQL') continue;
    tables.set(key, { ...def, columns: def.columns.map((c) => ({ ...c })) });
  }
  // 정의보다 앞 파일에 있던 ALTER 는 마지막에 반영한다
  for (const alter of alters) { const t = tables.get(tableKey(alter)); if (t && t.via === alter.via) apply(t, alter); }
  return [...tables.values()];
}

/** functions: 원문으로 만든 함수 윤곽 (readRepoText functions). 마스킹한 text 는 구문이 깨질 수 있다 */
export interface DbSourceFile { path: string; hash: string; text: string; functions?: NamedFunction[] }
/**
 * 코드에서 표를 쓰는 줄.
 *   via: 이 줄이 부르는 SQL 함수가 표를 쓴다 (through 가 없을 때)
 *   through: 이 줄이 부르는 함수 via 가 있는 공용 모듈. 그 모듈 안에서 이 표를 쓴다 (db-calls.ts)
 */
export interface DbUsage { line: number; path: string; text: string; via?: string; through?: string; listing?: boolean }

/** 표마다 그 표를 읽고 쓰는 SQL 함수 (다른 SQL 함수를 세 단계까지 거친 것 포함). 같은 이름은 나중 정의(create or replace)를 쓴다 */
export function routinesByTable(defs: DbTableDef[], routines: DbRoutineDef[]): Map<DbTableDef, DbRoutineDef[]> {
  const byName = new Map([...routines].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).map((r) => [r.name.toLowerCase(), r]));
  const tablesOf = (r: DbRoutineDef, depth: number, seen: Set<DbRoutineDef>): Set<string> => {
    const out = new Set(r.tables);
    seen.add(r);
    if (depth < 3) {
      for (const call of r.calls) {
        const next = byName.get(call);
        if (next && !seen.has(next)) for (const t of tablesOf(next, depth + 1, seen)) out.add(t);
      }
    }
    return out;
  };
  const touched = [...byName.values()].map((r) => ({ r, tables: tablesOf(r, 0, new Set()) }));
  return new Map(defs.map((def) => [def, touched.filter((x) => x.tables.has(tableKey(def))).map((x) => x.r).slice(0, 8)]));
}

/**
 * 표마다 코드에서 쓰는 줄을 찾는다 (정의 파일 제외).
 *   - 표 이름: 따옴표 안의 정확한 이름('users', "public.users"), Supabase REST 경로(/rest/v1/users), SQL 문(FROM·INTO·UPDATE·JOIN users)
 *   - SQL 함수: 그 표를 쓰는 함수를 부르는 줄(rpc('approve_member'), /rest/v1/rpc/approve_member)
 *   - 모델 이름: 정의 파일을 직접 또는 한 단계 거쳐 불러오는 파일에서만 (import 줄은 뺌)
 *   - Prisma: 클라이언트 접근자(.user.findMany 등)
 * 표 이름을 셋 이상 늘어놓은 줄(설치·점검 스크립트의 표 목록)은 실제로 쓰는 줄 뒤로 미룬다.
 */
export function findDbUsages(defs: DbTableDef[], files: DbSourceFile[], imports: Map<string, string[]>, routines: DbRoutineDef[] = []): Map<DbTableDef, DbUsage[]> {
  const result = new Map<DbTableDef, DbUsage[]>();
  const viaRoutines = routinesByTable(defs, routines);
  const reaches = (file: string, target: string) => {
    const direct = imports.get(file) ?? [];
    return direct.includes(target) || direct.some((x) => (imports.get(x) ?? []).includes(target));
  };
  const linesOf = new Map<string, string[]>();
  const IMPORT_LINE = /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+(?:\{|\*)|const\s+\{[^}]*\}\s*=\s*require\()/;
  // 주석 줄(주석 처리한 예전 코드 포함)은 쓰는 곳으로 보지 않는다
  const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*|--)/;
  for (const def of defs) {
    const own = new Set([def.file, ...def.columns.flatMap((c) => c.file ?? [])]);
    const name = esc(def.name);
    const byName = def.kind !== 'model' ? [
      new RegExp(String.raw`(['"\x60])(?:[\w-]+\.)?${name}\1`),
      new RegExp(String.raw`/rest/v1/${name}\b`),
      new RegExp(String.raw`\b(?:from|into|update|join|table)\s+["\x60]?(?:\w+["\x60]?\.["\x60]?)?${name}\b(?!\s*import\b)`, 'i'),
    ] : [];
    const byAlias = def.aliases.filter((a) => a.length > 1).map((a) => new RegExp(String.raw`(?<![\w$'"\x60])${esc(a)}\b(?!['"\x60])`));
    const byAccessor = def.accessor ? [new RegExp(String.raw`\.\s*${esc(def.accessor)}\s*\.\s*(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b`)] : [];
    const calls = (viaRoutines.get(def) ?? []).map((r) => ({ name: r.name, tests: [new RegExp(String.raw`(['"\x60])(?:[\w-]+\.)?${esc(r.name)}\1`), new RegExp(String.raw`/rpc/${esc(r.name)}\b`)] }));
    const found: DbUsage[] = [];
    for (const file of files) {
      if (own.has(file.path)) continue;
      const aliases = byAlias.length && reaches(file.path, def.file) ? byAlias : [];
      const direct = [...byName, ...byAccessor, ...aliases];
      const fileCalls = calls.filter((c) => file.text.includes(c.name));
      if ((!direct.length || !(file.text.includes(def.name) || def.aliases.some((a) => file.text.includes(a)) || (def.accessor && file.text.includes(def.accessor)))) && !fileCalls.length) continue;
      let lines = linesOf.get(file.path);
      if (!lines) { lines = file.text.split(/\r?\n/); linesOf.set(file.path, lines); }
      let inFile = 0;
      for (let i = 0; i < lines.length && inFile < DB_LIMITS.usagesPerFile; i++) {
        const line = lines[i]!;
        if (line.length > 2000 || IMPORT_LINE.test(line) || COMMENT_LINE.test(line)) continue;
        const via = direct.some((re) => re.test(line)) ? undefined : fileCalls.find((c) => c.tests.some((re) => re.test(line)))?.name;
        if (via === undefined && !direct.some((re) => re.test(line))) continue;
        found.push({ line: i + 1, path: file.path, text: raw(line, 160), ...(via ? { via } : {}) });
        inFile++;
      }
    }
    result.set(def, found);
  }
  // 한 줄에 표 이름이 셋 이상이면 표 목록으로 보고, 실제로 쓰는 줄이 상한 안에 먼저 들어가게 뒤로 보낸다
  const perLine = new Map<string, number>();
  for (const found of result.values()) for (const u of new Set(found.map((x) => `${x.path}:${x.line}`))) perLine.set(u, (perLine.get(u) ?? 0) + 1);
  const listing = (u: DbUsage) => (perLine.get(`${u.path}:${u.line}`) ?? 0) >= 3 ? 1 : 0;
  for (const [def, found] of result) result.set(def, found.map((u, i) => ({ u, i })).sort((a, b) => listing(a.u) - listing(b.u) || a.i - b.i).map((x) => (listing(x.u) ? { ...x.u, listing: true } : x.u)));
  return result;
}

/** 합친 정의와 사용처를 화면·AI 입력용 자료로 만든다 */
export function buildDatabase(input: { defs: DbTableDef[]; routines?: DbRoutineDef[]; files: DbSourceFile[]; hashes: Map<string, string>; imports: Map<string, string[]>; limited: boolean }): DbScan | undefined {
  const merged = mergeDbDefs(input.defs).filter((t) => t.columns.length || t.kind === 'view');
  if (!merged.length) return undefined;
  const kept = merged.slice(0, DB_LIMITS.tables);
  const direct = findDbUsages(kept, input.files, input.imports, input.routines);
  // 공용 모듈 안에서 표를 쓰면, 그 모듈의 함수를 부르는 기능 코드의 줄도 쓰는 곳으로 더한다 (직접 쓰는 줄 뒤에)
  const calls = findModuleCalls(direct, input.files, input.imports, (def) => new Set([def.file, ...def.columns.flatMap((c) => c.file ?? [])]));
  // 순서: 직접 쓰는 줄 → 기능 코드가 공용 모듈을 부르는 줄 → 표 이름만 늘어놓은 줄
  const usages = new Map(kept.map((def) => {
    const own = direct.get(def) ?? [];
    return [def, [...own.filter((u) => !u.listing), ...(calls.get(def) ?? []), ...own.filter((u) => u.listing)]];
  }));
  const routines = routinesByTable(kept, input.routines ?? []);
  const ids = new Set<string>();
  const hints: Record<string, DbHints> = {};
  const fileSource = (p: string, start: number, end = start): FileSource => ({ kind: 'file', path: p, startLine: start, endLine: Math.max(start, end), ...(input.hashes.get(p) ? { hash: input.hashes.get(p)! } : {}) });
  const tables = kept.map((def): RepoDbTable => {
    const baseId = tableKey(def).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'table';
    let id = baseId;
    for (let n = 2; ids.has(id); n++) id = `${baseId}-${n}`;
    ids.add(id);
    const found = usages.get(def) ?? [];
    const shown = found.slice(0, DB_LIMITS.usages);
    const columns = def.columns.slice(0, DB_LIMITS.columns).map((c): RepoDbColumn => ({
      name: c.name, type: c.type,
      ...(c.primaryKey ? { primaryKey: true } : {}), ...(c.notNull ? { notNull: true } : {}), ...(c.unique ? { unique: true } : {}),
      ...(c.default ? { default: c.default } : {}), ...(c.references ? { references: c.references } : {}), ...(c.check ? { check: c.check } : {}), ...(c.relation ? { relation: true } : {}),
      source: fileSource(c.file ?? def.file, c.line),
    }));
    hints[id] = { ...(def.note ? { note: def.note } : {}), columns: Object.fromEntries(def.columns.flatMap((c) => c.note ? [[c.name, c.note]] : [])),
      usages: shown.map((u) => u.through ? `${u.text} (공용 코드 ${u.through}의 ${u.via}를 부름. 그 함수가 이 표를 씀)` : u.via ? `${u.text} (SQL 함수 ${u.via} 안에서 이 표를 씀)` : u.text) };
    const fns = (routines.get(def) ?? []).map((r) => ({ name: raw(`${r.schema && !DEFAULT_SCHEMAS.has(r.schema.toLowerCase()) ? `${r.schema}.` : ''}${r.name}`, 80), source: fileSource(r.file, r.line) }));
    return {
      id, name: def.name, ...(def.schema ? { schema: def.schema } : {}), kind: def.kind, via: def.via,
      source: fileSource(def.file, def.line, def.endLine), columns, ...(def.columns.length > DB_LIMITS.columns ? { columnsLimited: true } : {}),
      usages: shown.map((u) => fileSource(u.path, u.line)), ...(found.length > shown.length ? { usagesLimited: true } : {}),
      ...(fns.length ? { routines: fns } : {}),
    };
  });
  const used = new Set(tables.flatMap((t) => t.usages.map((u) => u.path)));
  const importers: Record<string, string[]> = {};
  for (const [file, targets] of input.imports) {
    for (const target of targets) {
      if (!used.has(target) || target === file) continue;
      const list = importers[target] ??= [];
      if (list.length < DB_LIMITS.importers && !list.includes(file)) list.push(file);
    }
  }
  return { tables, limited: input.limited || merged.length > kept.length, hints, importers };
}

export const dbLabel = (t: { name: string; schema?: string }) => `${t.schema ? `${t.schema}.` : ''}${t.name}`;
