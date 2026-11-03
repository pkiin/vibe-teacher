import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoFileView, RepoSource } from '@vibe-teacher/shared';
import { api } from '../api/client';
import { ko } from '../i18n/ko';
import { TokenLine, codeLanguage, highlightLines } from './CodeBlock';
import { ErrorBox, Loading, Notice } from './Notice';
import { Modal } from './Modal';

type FileSource = Extract<RepoSource, { kind: 'file' }>;
function SourceDocument({ projectId, source }: { projectId: string; source: FileSource }) {
  const [data, setData] = useState<RepoFileView | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [line, setLine] = useState(Math.max(1, (source.startLine ?? 1) - 12));
  const [query, setQuery] = useState('');
  const code = useRef<HTMLDivElement>(null);
  const stale = !!source.hash && !!data && source.hash !== data.hash;
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    void api<RepoFileView>(`/api/projects/${projectId}/repo-wiki/source?${new URLSearchParams({ path: source.path, line: String(line) })}`, { signal: controller.signal }).then(setData).catch((e: Error) => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [projectId, source.path, line]);
  useEffect(() => {
    if (data && !stale) code.current?.querySelector('[data-highlight="true"]')?.scrollIntoView({ block: 'center' });
  }, [data, stale]);
  // 여러 줄 문자열·주석도 같은 색이 되도록 보이는 범위 전체를 한 번에 나눈다
  const highlighted = useMemo(() => (data ? highlightLines(data.lines.join('\n'), codeLanguage(source.path)) : []), [data, source.path]);
  const markOf = (text: string) => {
    const index = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    return index < 0 ? undefined : { start: index, end: index + query.length };
  };
  return <div className="source-document">
    <p className="small muted">{ko.source.readOnly}</p>
    {error && <ErrorBox error={error} />}
    {!error && !data && <Loading />}
    {data && <>
      {stale && <Notice kind="warn">{ko.source.stale}</Notice>}
      {data.masked && <p className="small muted">{ko.source.masked}</p>}
      {data.truncated && <Notice kind="warn">{ko.source.truncated}</Notice>}
      <div className="source-toolbar"><label>{ko.source.search}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="small muted">{ko.source.lines(data.startLine, data.endLine, data.lineCount)}</span></div>
      {!stale && source.startLine && <p className="small source-highlight-note">{ko.source.highlight(source.startLine, source.endLine ?? source.startLine)}</p>}
      <div className="source-code" ref={code} tabIndex={0} role="region" aria-label={ko.source.code}>
        <pre>{data.lines.map((text, index) => {
          const number = data.startLine + index;
          const highlight = !stale && !!source.startLine && number >= source.startLine && number <= (source.endLine ?? source.startLine);
          return <span key={number} className={`source-line ${highlight ? 'highlighted' : ''}`} data-highlight={highlight} id={`source-line-${number}`}><span className="source-line-number" aria-hidden="true">{number}</span><code>{text ? <TokenLine tokens={highlighted[index] ?? [{ kind: 'plain', text }]} mark={markOf(text)} /> : ' '}</code></span>;
        })}</pre>
      </div>
      {(data.startLine > 1 || data.endLine < data.lineCount) && <div className="source-pagination"><button type="button" className="btn btn-small" disabled={data.startLine === 1} onClick={() => setLine(Math.max(1, data.startLine - 500))}>{ko.source.previous}</button><button type="button" className="btn btn-small" disabled={data.endLine >= data.lineCount} onClick={() => setLine(data.endLine + 1)}>{ko.source.next}</button></div>}
    </>}
  </div>;
}
export function RepoSourceViewer({ projectId, source, onClose }: { projectId: string; source: FileSource | null; onClose: () => void }) {
  return <Modal open={!!source} title={source ? ko.source.title(source.path) : ko.source.code} onClose={onClose} className="source-modal">
    {source && <SourceDocument key={`${source.path}:${source.startLine ?? 0}`} projectId={projectId} source={source} />}
  </Modal>;
}
