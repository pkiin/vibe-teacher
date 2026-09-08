import type { SourceStatus } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { fmtDate } from './Notice';

export function SourceCard({ source, busy, onToggle, onRemove }: { source: SourceStatus; busy: boolean; onToggle: (enabled: boolean) => void; onRemove?: () => void }) {
  const pill = source.readable === 'denied' ? 'pill-red' : !source.exists ? 'pill-gray' : source.sessionCount > 0 ? 'pill-green' : 'pill-yellow';
  const statusText = source.readable === 'denied' ? ko.readable.denied : !source.exists ? ko.common.none : source.sessionCount > 0 ? ko.sources.sessionsFound(source.sessionCount) : source.note ?? '';
  return (
    <div className={`source-card ${source.enabled ? '' : 'source-off'}`}>
      <div className="source-head">
        <span className="pill pill-outline">{ko.provider[source.provider] ?? source.provider}</span>
        <span className="source-label">{source.label}</span>
        <span className={`pill ${pill}`}>{statusText}</span>
        <span className="pill pill-gray">{source.kind === 'default' ? ko.sources.defaultSource : ko.sources.customSource}</span>
      </div>
      <div className="mono small">{source.path}</div>
      {source.note && source.exists && source.sessionCount === 0 && <div className="muted small">{source.note}</div>}
      {source.lastModified && (
        <div className="muted small">
          {ko.common.lastActivity} {fmtDate(source.lastModified)}
        </div>
      )}
      <div className="source-actions">
        <label className="switch">
          <input type="checkbox" checked={source.enabled} disabled={busy} onChange={(e) => onToggle(e.target.checked)} />
          <span>{source.enabled ? ko.sources.enabled : ko.sources.disabled}</span>
        </label>
        {onRemove && (
          <button className="btn btn-small btn-danger" disabled={busy} onClick={onRemove}>
            {ko.sources.remove}
          </button>
        )}
      </div>
    </div>
  );
}
