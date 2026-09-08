import { useParams } from 'react-router';
import type { Account, Project, SessionSummary } from '@vibe-teacher/shared';
import { Breadcrumb } from '../components/Layout';
import { ErrorBox, Loading, Notice } from '../components/Notice';
import { SessionRow } from '../components/SessionRow';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

export function SessionsPage() {
  const { projectId = '' } = useParams();
  const project = useApi<Project>(`/api/projects/${projectId}`);
  const account = useApi<Account>(project.data ? `/api/accounts/${project.data.accountId}` : null, [project.data?.accountId]);
  const sessions = useApi<SessionSummary[]>(`/api/projects/${projectId}/sessions`);

  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: ko.accounts.title, to: '/' },
          { label: account.data?.username ?? '…', to: project.data ? `/accounts/${project.data.accountId}` : undefined },
          { label: project.data?.name ?? '…' },
        ]}
      />
      <h1>
        {project.data?.name ?? ''} <span className="muted h-sub">{ko.sessions.title}</span>
      </h1>
      <p className="muted mono small">{project.data?.rootPath}</p>
      {sessions.loading && <Loading />}
      {sessions.error && <ErrorBox error={sessions.error} onRetry={sessions.reload} />}
      {sessions.data && sessions.data.length === 0 && <Notice kind="warn">{ko.sessions.empty}</Notice>}
      {sessions.data && sessions.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{ko.sessions.title}</th>
              <th>{ko.sessions.startedAt}</th>
              <th>{ko.sessions.duration}</th>
              <th className="num">{ko.common.messages}</th>
              <th className="num">{ko.common.toolCalls}</th>
              <th>{ko.sessions.models}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <SessionRow key={s.key} s={s} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
