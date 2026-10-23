import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BuiltSummary, ConceptHit, EnrichmentRecord, LearnerProfile, WikiConcept, WikiResponse } from '@vibe-teacher/shared';
import { ApiError, api, apiPost } from '../api/client';
import { FocusProvider } from '../context/FocusContext';
import { useApi } from '../hooks/useApi';
import { useLearnerActions } from '../hooks/useLearner';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';
import { ConceptList } from './ConceptList';
import { HelpPanel, type UnderstandData } from './HelpPanel';
import { ErrorBox, Loading } from './Notice';
import { KnowledgeList } from './KnowledgeList';
import { UnifiedAiPanel } from './UnifiedAiPanel';
import { SessionSummaryCard, WikiBody, WikiCoverage, WikiHeader } from './WikiSections';
import { SecurityReview } from './SecurityReview';

/**
 * "이번 세션 이해하기" — 프로젝트 위키·만들어진 것·알아야 할 개념을 한 화면에 잇고,
 * 오른쪽 도움 패널(설명/질문/퀴즈)이 지금 보고 있는 대상을 따라간다.
 */
export function SessionUnderstand({ sessionKey, projectId, onJump }: { sessionKey: string; projectId: string; onJump?: (i: number) => void }) {
  const enc = encodeURIComponent(sessionKey);
  const built = useApi<BuiltSummary>(`/api/sessions/${enc}/built`);
  const [concepts, setConcepts] = useState<ConceptHit[] | null>(null);
  const [conceptsErr, setConceptsErr] = useState<Error | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentRecord | null>(null);
  const [wiki, setWiki] = useState<WikiResponse | null>(null);
  const [wikiState, setWikiState] = useState<'loading' | 'missing' | 'ready' | 'error'>('loading');
  const [wikiErr, setWikiErr] = useState<Error | null>(null);
  const [building, setBuilding] = useState(false);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  // AI 문장(요약·개념 설명·위키 항목 설명)은 읽는 사람 수준별로 저장되므로 수준이 바뀌면 다시 받는다
  const { level } = useReader();

  const loadConcepts = useCallback(() => {
    setConceptsErr(null);
    api<ConceptHit[]>(`/api/sessions/${enc}/concepts`)
      .then(setConcepts)
      .catch((e: Error) => setConceptsErr(e));
  }, [enc]);
  const loadWiki = useCallback(
    (quiet = false) => {
      api<WikiResponse>(`/api/sessions/${enc}/wiki`)
        .then((w) => {
          setWiki(w);
          setWikiState('ready');
        })
        .catch((e: Error) => {
          if (e instanceof ApiError && e.code === 'wiki_not_built') setWikiState('missing');
          else if (!quiet) {
            setWikiErr(e);
            setWikiState('error');
          }
        });
    },
    [enc],
  );

  useEffect(() => {
    loadConcepts();
    loadWiki();
    setEnrichment(null);
    api<EnrichmentRecord>(`/api/sessions/${enc}/enrichment`)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enc, loadConcepts, loadWiki, level]);
  useEffect(() => {
    api<{ profile: LearnerProfile }>('/api/me/profile')
      .then((u) => setProfile(u.profile))
      .catch(() => setProfile(null));
  }, []);

  // 내 이해 정보가 바뀌면 설명 계획만 다시 받는다 (프로젝트 사실·알림은 그대로)
  const onProfile = useCallback(
    (p: LearnerProfile) => {
      setProfile(p);
      loadWiki(true);
    },
    [loadWiki],
  );
  const learner = useLearnerActions(sessionKey, profile?.revision ?? wiki?.plan.profileRevision ?? 0, onProfile);

  const [aiWriting, setAiWriting] = useState(false);
  const build = async () => {
    setBuilding(true);
    setWikiErr(null);
    try {
      setWiki(await apiPost<WikiResponse>(`/api/sessions/${enc}/wiki/build`, {}));
      setWikiState('ready');
    } catch (e) {
      setWikiErr(e as Error);
    } finally {
      setBuilding(false);
    }
  };

  const catalog = useMemo(() => ({ ...Object.fromEntries((concepts ?? []).map((c) => [c.id, { ...c, summary: c.explanation, confusions: [], links: c.links ?? [] }])), ...wiki?.concepts }), [concepts, wiki]);
  const data: UnderstandData = { projectId, sessionKey, wiki, built: built.data, concepts: concepts ?? [], catalog, profile, learner, enrichment, onJump };
  const covered = useMemo(() => new Set(wiki?.snapshot.items.flatMap((i) => i.conceptIds) ?? []), [wiki]);

  return (
    <FocusProvider>
      <div className="understand">
        <div className="understand-main">
          <nav className="reading-path" aria-label={ko.reading.path}>
            {(['summary', 'security', 'wiki', 'concepts', 'knowledge'] as const).map((key, index) => (
              <a key={key} href={`#${key}`}><span aria-hidden="true">{index + 1}</span>{ko.reading[key]}</a>
            ))}
          </nav>
          <UnifiedAiPanel
            sessionKey={sessionKey}
            wiki={wiki}
            enrichment={enrichment}
            onEnrichment={(r) => {
              setEnrichment(r);
              loadConcepts();
            }}
            onWikiUpdated={() => { loadWiki(true); loadConcepts(); }}
            onWikiWriting={setAiWriting}
          />

          <section className="card" id="summary">
            <h3 className="section-title">{ko.understand.summary}</h3>
            <SessionSummaryCard enrichment={enrichment} />
          </section>

          <SecurityReview wiki={wiki} onJump={onJump} />
          <h2 id="wiki">{ko.understand.wiki}</h2>
          {wikiState === 'loading' && <Loading />}
          {wikiState === 'error' && wikiErr && <ErrorBox error={wikiErr} onRetry={() => loadWiki()} />}
          {(wikiState === 'missing' || wikiState === 'ready') && <WikiHeader wiki={wiki} building={building} error={wikiErr} onBuild={build} />}
          {wiki && <WikiBody wiki={wiki} profile={profile} learner={learner} projectId={projectId} sessionKey={sessionKey} onJump={onJump} aiWriting={aiWriting} />}

          <h2 id="concepts">{ko.understand.concepts}</h2>
          {!enrichment && <div className="small muted">{ko.concepts.ruleBasedOnly}</div>}
          {concepts === null && !conceptsErr && <Loading />}
          {conceptsErr && <ErrorBox error={conceptsErr} onRetry={loadConcepts} />}
          {concepts && <ConceptList concepts={concepts} onJump={onJump} coveredIds={covered} />}

          {wiki && (
            <>
              <details className="section-disclosure">
                <summary>{ko.wiki.coverage}</summary>
                <WikiCoverage wiki={wiki} />
              </details>
            </>
          )}
          <h2 id="knowledge">{ko.knowledge.sessionTitle}</h2>
          <KnowledgeList sessionKey={sessionKey} onProfile={onProfile} refreshKey={`${profile?.revision}|${wiki?.ai?.createdAt}|${enrichment?.createdAt}`} showMeta={false} />
        </div>
        <HelpPanel data={data} />
      </div>
    </FocusProvider>
  );
}
