import { Link } from 'react-router';
import type { SessionAnalysisDocumentsResponse } from '@vibe-teacher/shared';
import { useApi } from '../hooks/useApi';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';
import { sessionAnalysisPath } from '../lib/session-analysis';
import { ErrorBox, Loading, fmtDate } from './Notice';

/** 저장된 분석 문서와 하위 절을 부모·자식 목록으로 연결한다. */
export function SessionAnalysisTree({ projectId, data }: { projectId: string; data: SessionAnalysisDocumentsResponse }) {
  return (
    <nav className="card analysis-tree" aria-label={ko.analysis.documents}>
      <details open>
        <summary><strong>{ko.analysis.documents}</strong> <span className="badge">{data.documents.length}</span></summary>
        <p className="small muted">{ko.analysis.intro}</p>
        {!data.documents.length && <p className="small muted">{ko.analysis.empty}</p>}
        <ul>
          {data.documents.map((doc) => (
            <li key={doc.sessionKey}>
              <details>
                <summary>
                  <Link to={sessionAnalysisPath(doc.sessionKey)}>{doc.title}</Link>{' '}
                  <span className={`pill ${doc.status === 'complete' ? 'pill-green' : 'pill-yellow'}`}>{ko.analysis[doc.status]}</span>
                </summary>
                <p className="small muted"><time dateTime={doc.createdAt}>{fmtDate(doc.createdAt)}</time>{doc.stale ? ` · ${ko.analysis.stale}` : ''}</p>
                {doc.summary && <p className="small">{doc.summary}</p>}
                <ul className="small">
                  {doc.sections.map((section) => <li key={section}><Link to={sessionAnalysisPath(doc.sessionKey, section)}>{ko.analysis.sections[section]}</Link></li>)}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        <Link className="small" to={`/projects/${projectId}?tab=sessions`}>{ko.analysis.browseSessions} →</Link>
      </details>
    </nav>
  );
}

export function SessionAnalysisIndex({ projectId }: { projectId: string }) {
  const reader = useReader();
  const result = useApi<SessionAnalysisDocumentsResponse>(`/api/projects/${projectId}/session-analyses`, [reader.level]);
  if (result.error) return <ErrorBox error={result.error} onRetry={result.reload} />;
  if (!result.data) return <Loading />;
  return <SessionAnalysisTree projectId={projectId} data={result.data} />;
}
