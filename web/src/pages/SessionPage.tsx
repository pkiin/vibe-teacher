import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { Account, BuiltSummary, ConceptHit, EnrichmentRecord, NormalizedSession, Project, UserMessagesResult } from '@vibe-teacher/shared';
import { api } from '../api/client';
import { BuiltSummaryView } from '../components/BuiltSummary';
import { ConceptList } from '../components/ConceptList';
import { EnrichPanel } from '../components/EnrichPanel';
import { Breadcrumb } from '../components/Layout';
import { MessageList } from '../components/MessageList';
import { ErrorBox, Loading, Notice, fmtDate, fmtDuration } from '../components/Notice';
import { Tabs } from '../components/Tabs';
import { useAuth } from '../context/AuthContext';
import { WikiTab } from '../components/WikiTab';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

type TabId = 'messages' | 'built' | 'concepts' | 'wiki';

export function SessionPage() {
  const { sessionKey = '' } = useParams();
  const key = decodeURIComponent(sessionKey);
  const enc = encodeURIComponent(key);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'messages';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });

  const session = useApi<NormalizedSession>(`/api/sessions/${enc}`);
  const project = useApi<Project>(session.data ? `/api/projects/${session.data.projectId}` : null, [session.data?.projectId]);
  const account = useApi<Account>(session.data ? `/api/accounts/${session.data.accountId}` : null, [session.data?.accountId]);
  const messages = useApi<UserMessagesResult>(tab === 'messages' ? `/api/sessions/${enc}/user-messages` : null);
  const built = useApi<BuiltSummary>(tab === 'built' ? `/api/sessions/${enc}/built` : null);
  const { me } = useAuth();
  const [concepts, setConcepts] = useState<ConceptHit[] | null>(null);
  const [conceptsErr, setConceptsErr] = useState<Error | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentRecord | null>(null);

  const loadConcepts = useCallback(() => {
    setConceptsErr(null);
    api<ConceptHit[]>(`/api/sessions/${enc}/concepts`)
      .then(setConcepts)
      .catch((e: Error) => setConceptsErr(e));
  }, [enc]);

  useEffect(() => {
    if (tab === 'concepts' && concepts === null) loadConcepts();
  }, [tab, concepts, loadConcepts]);

  useEffect(() => {
    api<EnrichmentRecord>(`/api/sessions/${enc}/enrichment`)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
  }, [enc]);

  const jump = (index: number) => {
    setTab('messages');
    setTimeout(() => {
      const el = document.getElementById(`msg-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1500);
      }
    }, 150);
  };

  const onEnrichResult = (r: EnrichmentRecord) => {
    setEnrichment(r);
    loadConcepts();
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
              { id: 'built', label: ko.session.tabs.built },
              { id: 'concepts', label: ko.session.tabs.concepts, badge: concepts?.length },
              { id: 'wiki', label: ko.wiki.tab },
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
              <EnrichPanel sessionKey={key} llmStatus={me?.llmStatus ?? null} canEnrich={me?.canEnrich ?? false} enrichReason={me?.enrichReason} cached={enrichment} onResult={onEnrichResult} isAdmin={me?.isAdmin ?? false} />
              {built.loading && <Loading />}
              {built.error && <ErrorBox error={built.error} onRetry={built.reload} />}
              {built.data && <BuiltSummaryView built={built.data} onJump={jump} />}
            </div>
          )}
          {tab === 'concepts' && (
            <div className="tab-body">
              <EnrichPanel sessionKey={key} llmStatus={me?.llmStatus ?? null} canEnrich={me?.canEnrich ?? false} enrichReason={me?.enrichReason} cached={enrichment} onResult={onEnrichResult} isAdmin={me?.isAdmin ?? false} />
              {!enrichment && <Notice kind="info">{ko.concepts.ruleBasedOnly}</Notice>}
              {concepts === null && !conceptsErr && <Loading />}
              {conceptsErr && <ErrorBox error={conceptsErr} onRetry={loadConcepts} />}
              {concepts && <ConceptList concepts={concepts} onJump={jump} />}
            </div>
          )}
          {tab === 'wiki' && (
            <div className="tab-body">
              <WikiTab sessionKey={key} projectId={s.projectId} onJump={jump} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
