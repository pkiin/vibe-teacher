import { useParams, useSearchParams } from 'react-router';
import type { Account, Project, SessionSummary } from '@vibe-teacher/shared';
import { Breadcrumb } from '../components/Layout';
import { ErrorBox, Loading, Notice } from '../components/Notice';
import { KnowledgeList } from '../components/KnowledgeList';
import { RepoWikiView } from '../components/RepoWikiView';
import { SessionRow } from '../components/SessionRow';
import { Tabs } from '../components/Tabs';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

export function SessionsPage() {
  const { projectId = '' } = useParams();
  const project = useApi<Project>(`/api/projects/${projectId}`);
  const account = useApi<Account>(project.data ? `/api/accounts/${project.data.accountId}` : null, [project.data?.accountId]);
  const sessions = useApi<SessionSummary[]>(`/api/projects/${projectId}/sessions`);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'sessions' || params.get('tab') === 'knowledge' ? params.get('tab')! : 'wiki';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });

  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: ko.accounts.title, to: '/' },
          { label: account.data?.username ?? '…', to: project.data ? `/accounts/${project.data.accountId}` : undefined },
          { label: project.data?.name ?? '…' },
        ]}
      />
      <h1>{project.data?.name ?? ''}</h1>
      <p className="muted mono small">{project.data?.rootPath}</p>
      <Tabs
        tabs={[
          { id: 'wiki', label: ko.repo.tab },
          { id: 'sessions', label: ko.repo.sessionsTab, badge: sessions.data?.length },
          { id: 'knowledge', label: ko.repo.knowledgeTab },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'wiki' && (
        <div className="tab-body">
          <RepoWikiView projectId={projectId} />
        </div>
      )}
      {tab === 'knowledge' && (
        <div className="tab-body">
          <KnowledgeList projectId={projectId} />
        </div>
      )}
      {tab === 'sessions' && (
        <div className="tab-body">
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
      )}
    </div>
  );
}
