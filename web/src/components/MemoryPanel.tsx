import { useEffect, useRef, useState } from 'react';
import type { MemorySearchResponse } from '@vibe-teacher/shared';
import { Link } from 'react-router';
import { api, apiPost } from '../api/client';
import { ko } from '../i18n/ko';
import { ErrorBox, Notice } from './Notice';

export function MemoryPanel({ projectId }: { projectId?: string }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MemorySearchResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setData(null); setError(null); setSyncNote('');
    api<MemorySearchResponse>(`/api/me/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`).then((result) => { if (generation.current === current) setData(result); }).catch((e: Error) => { if (generation.current === current) setError(e); });
    return () => { generation.current++; };
  }, [projectId]);
  const search = async () => {
    const current = generation.current;
    setBusy(true); setError(null);
    try { const result = await apiPost<MemorySearchResponse>('/api/me/memory/search', { query, projectId }); if (current === generation.current) setData(result); }
    catch (e) { if (current === generation.current) setError(e as Error); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true); setError(null);
    const current = generation.current;
    try {
      const result = await apiPost<{ indexed: number; remaining: number; notices: string[] }>('/api/me/memory/sync', { projectId });
      if (current === generation.current) setSyncNote([ko.memory.synced(result.indexed, result.remaining), ...result.notices].join(' · '));
      const refreshed = await api<MemorySearchResponse>(`/api/me/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
      if (current === generation.current) setData(refreshed);
    } catch (e) { if (current === generation.current) setError(e as Error); }
    finally { setBusy(false); }
  };
  return <details className="memory-panel card">
    <summary><strong>{ko.memory.title}</strong></summary>
    <p className="small muted">{ko.memory.intro} {data?.configuredBackend === 'mem0' ? ko.memory.mem0Intro : data?.configuredBackend === 'supermemory' ? ko.memory.cloudIntro : ko.memory.localIntro}</p>
    <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="memory-search">
      <input aria-label={ko.memory.title} placeholder={ko.memory.placeholder} value={query} maxLength={2000} onChange={(e) => setQuery(e.target.value)} />
      <button className="btn btn-small" disabled={busy}>{busy ? ko.memory.loading : ko.memory.search}</button>
    </form>
    {error && <ErrorBox error={error} />}
    {data && <>
      <p className="small muted">{ko.memory[data.backend]} · {ko.memory.count(data.total)}{data.databaseProvider && <> · {ko.memory.database[data.databaseProvider]}</>}</p>
      {data.notices.map((notice) => <Notice key={notice} kind="warn">{notice}</Notice>)}
      {!data.records.length && <p className="small muted">{ko.memory.empty}</p>}
      <ul className="memory-results">{data.records.map((r) => <li key={r.id}><span className="small muted">{new Date(r.at).toLocaleString('ko-KR')} · {ko.learning.kind[r.kind]}</span><p>{r.text}</p>{r.sessionKey && <Link className="small" to={`/sessions/${encodeURIComponent(r.sessionKey)}?tab=understand`}>{ko.memory.source}</Link>}</li>)}</ul>
      {data.canSync && <button className="btn btn-small" disabled={busy} onClick={() => void sync()}>{ko.memory.sync}</button>}
    </>}
    {syncNote && <p className="small" role="status">{syncNote}</p>}
  </details>;
}
