import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { Account, BuiltSummary, NormalizedSession, Project, UserMessagesResult } from '@vibe-teacher/shared';
import { BuiltSummaryView } from '../components/BuiltSummary';
import { Breadcrumb } from '../components/Layout';
import { MessageList } from '../components/MessageList';
import { ErrorBox, Loading, fmtDate, fmtDuration } from '../components/Notice';
import { SessionUnderstand } from '../components/SessionUnderstand';
import { Tabs } from '../components/Tabs';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

type TabId = 'messages' | 'understand' | 'built';
/** 예전 탭 주소(?tab=concepts 등)는 통합 화면의 해당 절로 연다 */
const LEGACY_SECTIONS: Record<string, string> = { concepts: 'concepts', wiki: 'wiki' };
const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

export function SessionPage() {
  const { sessionKey = '' } = useParams();
  const key = decodeURIComponent(sessionKey);
  const enc = encodeURIComponent(key);
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') ?? 'understand';
  const legacy = LEGACY_SECTIONS[rawTab];
  const tab: TabId = rawTab === 'messages' || rawTab === 'built' ? rawTab : 'understand';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });

  const session = useApi<NormalizedSession>(`/api/sessions/${enc}`);
  const project = useApi<Project>(session.data ? `/api/projects/${session.data.projectId}` : null, [session.data?.projectId]);
  const account = useApi<Account>(session.data ? `/api/accounts/${session.data.accountId}` : null, [session.data?.accountId]);
  const messages = useApi<UserMessagesResult>(tab === 'messages' ? `/api/sessions/${enc}/user-messages` : null);
  const built = useApi<BuiltSummary>(tab === 'built' ? `/api/sessions/${enc}/built` : null);

  useEffect(() => {
    if (!legacy) return;
    const t = setTimeout(() => document.getElementById(legacy)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 400);
    return () => clearTimeout(t);
  }, [legacy]);

  const jump = (index: number) => {
    setTab('messages');
    setTimeout(() => {
      const el = document.getElementById(`msg-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1500);
      }
    }, 150);
  };

  const s = session.data;
  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: ko.accounts.title, to: '/' },
          { label: account.data?.username ?? '…', to: s ? `/accounts/${s.accountId}` : undefined },
          { label: project.data?.name ?? '…', to: s ? `/projects/${s.projectId}` : undefined },
          { label: s?.title ?? '…' },
        ]}
      />
      {session.loading && <Loading />}
      {session.error && <ErrorBox error={session.error} onRetry={session.reload} />}
      {s && (
        <>
          <h1>
            {s.title} {s.isLive && <span className="pill pill-red">{ko.common.live}</span>}
          </h1>
          <div className="session-meta muted small">
            <span className="pill pill-outline">{ko.provider[s.provider] ?? s.provider}</span>
            <span>{fmtDate(s.startedAt)} ~ {fmtDate(s.endedAt)}</span>
            <span>({fmtDuration(s.startedAt, s.endedAt)})</span>
            <span>
              {ko.common.messages} {s.counts.human}
            </span>
            <span>
              {ko.common.toolCalls} {s.counts.toolCalls}
            </span>
            {s.counts.subagents > 0 && <span>서브에이전트 {s.counts.subagents}</span>}
            <span>{s.models.join(', ')}</span>
            {s.gitBranch && <span className="mono">{s.gitBranch}</span>}
          </div>
          <div className="mono small muted">{s.filePath}</div>
          <div className="small">
            <Link to={`/projects/${s.projectId}?tab=wiki`}>{ko.repo.sessionLink} →</Link>
          </div>
          {s.parseWarnings.length > 0 && (
            <details className="evidence">
              <summary>
                {ko.session.warnings} ({s.parseWarnings.length})
              </summary>
              <ul>
                {s.parseWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <Tabs
            tabs={[
              { id: 'messages', label: ko.session.tabs.messages, badge: s.counts.human + s.counts.slashCommands },
              { id: 'understand', label: ko.understand.tab },
              { id: 'built', label: ko.session.tabs.built },
            ]}
            active={tab}
            onChange={setTab}
          />
          {tab === 'messages' && (
            <div className="tab-body">
              {messages.loading && <Loading />}
              {messages.error && <ErrorBox error={messages.error} onRetry={messages.reload} />}
              {messages.data && <MessageList result={messages.data} />}
            </div>
          )}
          {tab === 'built' && (
            <div className="tab-body">
              {built.loading && <Loading />}
              {built.error && <ErrorBox error={built.error} onRetry={built.reload} />}
              {built.data && <BuiltSummaryView built={built.data} onJump={jump} />}
            </div>
          )}
          {tab === 'understand' && (
            <div className="tab-body">
              <SessionUnderstand key={s.key} sessionKey={key} projectId={s.projectId} onJump={jump} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
