import { Link } from 'react-router';
import type { SessionSummary } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { fmtDate, fmtDuration } from './Notice';

export function SessionRow({ s }: { s: SessionSummary }) {
  return (
    <tr>
      <td>
        <Link to={`/sessions/${encodeURIComponent(s.key)}`} className="session-title">
          {s.title || '(제목 없음)'}
        </Link>
        {s.isLive && <span className="pill pill-red">{ko.common.live}</span>}
        <div className="muted small">
          <span className="pill pill-outline">{ko.provider[s.provider] ?? s.provider}</span> <span className="mono">{s.sessionId.slice(0, 8)}</span>
          {s.gitBranch && <span className="mono"> · {s.gitBranch}</span>}
        </div>
      </td>
      <td className="nowrap">{fmtDate(s.startedAt)}</td>
      <td className="nowrap">{fmtDuration(s.startedAt, s.endedAt)}</td>
      <td className="num">{s.counts.human}</td>
      <td className="num">{s.counts.toolCalls}</td>
      <td className="small">{s.models.map((m) => m.replace(/^claude-/, '')).join(', ') || '-'}</td>
    </tr>
  );
}
