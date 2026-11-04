import { useState } from 'react';
import type { StorageActivityResponse } from '@vibe-teacher/shared';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading } from './Notice';

export function StorageActivity() {
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useApi<StorageActivityResponse>(open ? '/api/me/storage' : null);
  return <details className="storage-activity settings-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{ko.work.storageTitle}</summary>
    <p className="small muted">{ko.work.storageNote}</p>
    {loading && <Loading />}{error && <ErrorBox error={error} onRetry={reload} />}
    {data?.mode === 'local' && <p>{ko.work.local}</p>}
    {data?.mode === 'supabase' && <>
      {data.cache && <p className="small">{ko.work.cache(data.cache.hits, data.cache.coalesced)}</p>}
      <div className="table-scroll"><table><thead><tr><th>{ko.work.table}</th><th>{ko.work.reads}</th><th>{ko.work.writes}</th><th>{ko.work.errors}</th><th>{ko.work.time}</th></tr></thead><tbody>{data.tables.map((row) => <tr key={row.table}><td><code>{row.table}</code></td><td>{row.reads}</td><td>{row.writes}</td><td>{row.errors}</td><td>{(row.durationMs / 1000).toFixed(1)}s</td></tr>)}</tbody></table></div>
    </>}
    <button className="btn btn-small" onClick={reload} disabled={loading}>{ko.work.refresh}</button>
  </details>;
}
