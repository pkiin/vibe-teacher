import { Link, useParams } from 'react-router';
import type { Account, AccountSummaryResponse, Project } from '@vibe-teacher/shared';
import { Breadcrumb } from '../components/Layout';
import { ErrorBox, Loading, Notice, fmtDate } from '../components/Notice';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

export function ProjectsPage() {
  const { accountId = '' } = useParams();
  const account = useApi<Account>(`/api/accounts/${accountId}`);
  const projects = useApi<Project[]>(`/api/accounts/${accountId}/projects`);
  const summary = useApi<AccountSummaryResponse>(`/api/accounts/${accountId}/summary`);

  return (
    <div className="page">
      <Breadcrumb items={[{ label: ko.accounts.title, to: '/' }, { label: account.data?.username ?? '…' }]} />
      <h1>
        {account.data?.username ?? ''} <span className="muted h-sub">{ko.projects.title}</span>
      </h1>
      <p className="muted">
        {ko.projects.subtitle} <span className="mono">{account.data?.homePath}</span>
      </p>
      {projects.loading && <Loading />}
      {projects.error && <ErrorBox error={projects.error} onRetry={projects.reload} />}
      {projects.data && projects.data.length === 0 && (
        <Notice kind="warn">
          {ko.projects.empty} <Link to="/sources">{ko.nav.sources}</Link>
        </Notice>
      )}
      {projects.data && projects.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{ko.projects.title}</th>
              <th>경로</th>
              <th>도구</th>
              <th className="num">{ko.common.sessions}</th>
              <th>{ko.common.lastActivity}</th>
            </tr>
          </thead>
          <tbody>
            {projects.data.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${p.id}`} className="session-title">
                    {p.name}
                  </Link>
                  {!p.exists && <span className="pill pill-gray">{ko.projects.folderMissing}</span>}
                </td>
                <td className="mono small">{p.rootPath}</td>
                <td>
                  {p.providers.map((pr) => (
                    <span key={pr} className="pill pill-outline">
                      {ko.provider[pr] ?? pr}
                    </span>
                  ))}
                </td>
                <td className="num">{p.sessionCount}</td>
                <td className="nowrap">{fmtDate(p.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="section">
        <h2>{ko.projects.summaryTitle}</h2>
        {summary.loading && <Loading text={ko.projects.loadSummary} />}
        {summary.error && <ErrorBox error={summary.error} onRetry={summary.reload} />}
        {summary.data && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-num">{summary.data.totals.sessions}</div>
                <div className="stat-label">{ko.common.sessions}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{summary.data.totals.humanMessages}</div>
                <div className="stat-label">{ko.common.messages}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{summary.data.totals.filesCreated}</div>
                <div className="stat-label">{ko.built.filesCreated}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{summary.data.totals.filesModified}</div>
                <div className="stat-label">{ko.built.filesModified}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{summary.data.totals.packages}</div>
                <div className="stat-label">{ko.built.packages}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{summary.data.totals.commits}</div>
                <div className="stat-label">{ko.built.commits}</div>
              </div>
            </div>
            {summary.data.topConcepts.length > 0 && (
              <div>
                <h3>{ko.projects.topConcepts}</h3>
                <div className="chips">
                  {summary.data.topConcepts.map((c) => (
                    <span key={c.id} className="chip">
                      {c.name} <span className="muted small">×{c.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {summary.data.projects.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>{ko.projects.title}</th>
                    <th className="num">{ko.common.sessions}</th>
                    <th className="num">{ko.common.messages}</th>
                    <th className="num">{ko.built.filesCreated}</th>
                    <th className="num">{ko.built.filesModified}</th>
                    <th className="num">{ko.built.packages}</th>
                    <th className="num">{ko.built.commits}</th>
                    <th>{ko.projects.topConcepts}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.projects.map((r) => (
                    <tr key={r.project.id}>
                      <td>
                        <Link to={`/projects/${r.project.id}`}>{r.project.name}</Link>
                      </td>
                      <td className="num">{r.sessions}</td>
                      <td className="num">{r.humanMessages}</td>
                      <td className="num">{r.filesCreated}</td>
                      <td className="num">{r.filesModified}</td>
                      <td className="num">{r.packages}</td>
                      <td className="num">{r.commits}</td>
                      <td className="small">{r.topConcepts.map((c) => c.name).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}
