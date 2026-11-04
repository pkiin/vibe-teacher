import type { ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';

function safeHref(target: string): string | null {
  if (/^https?:\/\//i.test(target)) {
    try { return new URL(target).href; } catch { return null; }
  }
  if (/^#/.test(target) || /^\/(?:projects|sessions|knowledge|accounts|sources)(?:[/?#]|$)/.test(target)) return target;
  return null;
}

function renderInline(text: string, depth = 0): ReactNode[] {
  if (depth > 12) return [text];
  const out: ReactNode[] = [];
  const re = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|\[([^\]\n]+)\]\((<[^>\n]+>|[^)\n]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={key++}>{m[2]}</code>);
    else if (m[3]) out.push(<strong key={key++}>{renderInline(m[3], depth + 1)}</strong>);
    else {
      const target = (m[5] ?? '').replace(/^<|>$/g, '').trim();
      const href = safeHref(target);
      const label = renderInline(m[4] ?? '', depth + 1);
      // 로컬 파일 경로 등은 주소를 함께 보존하고, 실행 가능한 링크로 만들지 않는다.
      out.push(href ? <a key={key++} href={href} {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{label}</a>
        : <span key={key++}>{label} <code>{target}</code></span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 코드 안의 |와 이스케이프한 \|는 표의 열을 나누지 않는다. */
function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = '', code = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\' && value[i + 1] === '|') { cell += '|'; i++; }
    else if (char === '`') {
      let count = 1;
      while (value[i + count] === '`') count++;
      if (!code) code = count;
      else if (code === count) code = 0;
      cell += '`'.repeat(count);
      i += count - 1;
    } else if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

const listLine = (line: string) => /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
const fenceLine = (line: string) => /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const headingLine = (line: string) => /^(#{1,6})\s+(.*)$/.exec(line);
const ruleLine = (line: string) => /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);

function renderBlocks(lines: string[], depth = 0): ReactNode[] {
  if (depth > 24) return [<pre key="text">{lines.join('\n')}</pre>];
  const blocks: ReactNode[] = [];
  const tableAt = (index: number) => {
    const head = lines[index], divider = lines[index + 1];
    if (!head?.includes('|') || !divider) return false;
    const cells = tableCells(divider);
    return cells.length === tableCells(head).length && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };
  const startsBlock = (index: number) => {
    const line = lines[index] ?? '';
    return !line.trim() || fenceLine(line) || headingLine(line) || listLine(line) || /^\s*>/.test(line) || ruleLine(line) || tableAt(index);
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const key = blocks.length;
    const fence = fenceLine(line);
    if (fence) {
      const marker = fence[1]!;
      const close = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
      const content: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i] ?? '')) content.push(lines[i++] ?? '');
      if (i < lines.length) i++;
      blocks.push(<CodeBlock key={key} code={content.join('\n')} lang={fence[2]?.trim().split(/\s+/)[0]} />);
      continue;
    }
    const heading = headingLine(line);
    if (heading) { blocks.push(<h4 key={key}>{renderInline(heading[2] ?? '')}</h4>); i++; continue; }
    if (ruleLine(line)) { blocks.push(<hr key={key} />); i++; continue; }
    if (tableAt(i)) {
      const head = tableCells(line), rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]?.trim() && lines[i]?.includes('|')) {
        const row = tableCells(lines[i]!);
        if (row.length !== head.length) break;
        rows.push(row);
        i++;
      }
      blocks.push(<div key={key} className="repo-table-wrap"><table className="table repo-table"><thead><tr>{head.map((cell, index) => <th key={index}>{renderInline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col}>{renderInline(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) quote.push((lines[i++] ?? '').replace(/^\s*> ?/, ''));
      blocks.push(<blockquote key={key}>{renderBlocks(quote, depth + 1)}</blockquote>);
      continue;
    }
    const first = listLine(line);
    if (first) {
      const indent = first[1]!.length, ordered = /^\d/.test(first[2]!);
      const items: string[][] = [];
      while (i < lines.length) {
        const entry = lines[i] ?? '', match = listLine(entry);
        if (match && match[1]!.length === indent && /^\d/.test(match[2]!) === ordered) { items.push([match[3] ?? '']); i++; }
        else if (entry.trim() && /^\s*/.exec(entry)![0].length > indent && items.length) { items.at(-1)!.push(entry.slice(Math.min(indent + 2, /^\s*/.exec(entry)![0].length))); i++; }
        else break;
      }
      const children = items.map((item, index) => <li key={index}>{renderBlocks(item, depth + 1)}</li>);
      blocks.push(ordered ? <ol key={key} start={parseInt(first[2]!, 10)}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && !startsBlock(i)) paragraph.push(lines[i++] ?? '');
    blocks.push(<p key={key}>{renderInline(paragraph.join('\n'))}</p>);
  }
  return blocks;
}

/** 답변 원문의 제목·목록·코드·표·링크를 표시한다. HTML과 외부 이미지는 실행하거나 불러오지 않는다. */
export function MiniMarkdown({ text }: { text: string }) {
  return <div className="markdown">{renderBlocks(text.replace(/\r\n?/g, '\n').split('\n'))}</div>;
}
