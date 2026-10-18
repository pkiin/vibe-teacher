import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BuiltSummary, ConceptHit, EnrichmentRecord, FileFact, LearnerProfile, UnderstandingResponse, WikiConcept, WikiResponse } from '@vibe-teacher/shared';
import { ApiError, api, apiPost } from '../api/client';
import { FocusProvider } from '../context/FocusContext';
import { useApi } from '../hooks/useApi';
import { useLearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { BuiltSummaryView } from './BuiltSummary';
import { ConceptList } from './ConceptList';
import { FocusChip } from './FocusChip';
import { HelpPanel, fileLinks, type UnderstandData } from './HelpPanel';
import { ErrorBox, Loading } from './Notice';
import { UnderstandingPanel } from './UnderstandingPanel';
import { UnifiedAiPanel } from './UnifiedAiPanel';
import { SessionSummaryCard, WikiBody, WikiCoverage, WikiHeader } from './WikiSections';

/**
 * "이번 세션 이해하기" — 프로젝트 위키·만들어진 것·알아야 할 개념을 한 화면에 잇고,
 * 오른쪽 도움 패널(설명/질문/퀴즈)이 지금 보고 있는 대상을 따라간다.
 */
export function SessionUnderstand({ sessionKey, projectId, onJump }: { sessionKey: string; projectId: string; onJump?: (i: number) => void }) {
  const enc = encodeURIComponent(sessionKey);
  const built = useApi<BuiltSummary>(`/api/sessions/${enc}/built`);
  const catalogList = useApi<WikiConcept[]>('/api/catalog/concepts');
  const [concepts, setConcepts] = useState<ConceptHit[] | null>(null);
  const [conceptsErr, setConceptsErr] = useState<Error | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentRecord | null>(null);
  const [wiki, setWiki] = useState<WikiResponse | null>(null);
  const [wikiState, setWikiState] = useState<'loading' | 'missing' | 'ready' | 'error'>('loading');
  const [wikiErr, setWikiErr] = useState<Error | null>(null);
  const [building, setBuilding] = useState(false);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);

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
    api<EnrichmentRecord>(`/api/sessions/${enc}/enrichment`)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
  }, [enc, loadConcepts, loadWiki]);
  useEffect(() => {
    api<UnderstandingResponse>(`/api/projects/${projectId}/understanding`)
      .then((u) => setProfile(u.profile))
      .catch(() => setProfile(null));
  }, [projectId]);

  // 내 이해 정보가 바뀌면 설명 계획만 다시 받는다 (프로젝트 사실·알림은 그대로)
  const onProfile = useCallback(
    (p: LearnerProfile) => {
      setProfile(p);
      loadWiki(true);
    },
    [loadWiki],
  );
  const learner = useLearnerActions(projectId, sessionKey, profile?.revision ?? wiki?.plan.profileRevision ?? 0, onProfile);

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

  const catalog = useMemo(() => Object.fromEntries((catalogList.data ?? []).map((c) => [c.id, c])), [catalogList.data]);
  const data: UnderstandData = { projectId, sessionKey, wiki, built: built.data, concepts: concepts ?? [], catalog, profile, learner, enrichment, onJump };
  const covered = useMemo(() => new Set(wiki?.snapshot.items.flatMap((i) => i.conceptIds) ?? []), [wiki]);
  const fileExtra = (f: FileFact) => {
    const links = fileLinks(f, { wiki, concepts: concepts ?? [] });
    if (!links.itemIds.length && !links.conceptIds.length) return null;
    return (
      <span className="file-links">
        {links.itemIds.map((id) => (
          <FocusChip key={id} focus={{ kind: 'item', id }} label={wiki?.snapshot.items.find((i) => i.id === id)?.title ?? id} className="pill pill-blue" />
        ))}
        {links.conceptIds.map((id) => (
          <FocusChip key={id} focus={{ kind: 'concept', id }} label={catalog[id]?.name ?? concepts?.find((c) => c.id === id)?.name ?? id} />
        ))}
      </span>
    );
  };
  const understandingConcepts = wiki ? [...new Set(wiki.snapshot.items.flatMap((i) => i.conceptIds.slice(0, 1)))] : (concepts ?? []).map((c) => c.id);

  return (
    <FocusProvider>
      <div className="understand">
        <div className="understand-main">
          <UnifiedAiPanel
            sessionKey={sessionKey}
            wiki={wiki}
            enrichment={enrichment}
            onEnrichment={(r) => {
              setEnrichment(r);
              loadConcepts();
            }}
            onWikiUpdated={() => loadWiki(true)}
          />

          <section className="card">
            <h3 className="section-title">{ko.understand.summary}</h3>
            <SessionSummaryCard enrichment={enrichment} />
          </section>

          <h2 id="wiki">{ko.understand.wiki}</h2>
          {wikiState === 'loading' && <Loading />}
          {wikiState === 'error' && wikiErr && <ErrorBox error={wikiErr} onRetry={() => loadWiki()} />}
          {(wikiState === 'missing' || wikiState === 'ready') && <WikiHeader wiki={wiki} building={building} error={wikiErr} onBuild={build} />}
          {wiki && <WikiBody wiki={wiki} profile={profile} learner={learner} projectId={projectId} sessionKey={sessionKey} onJump={onJump} />}

          <h2 id="built">{ko.understand.built}</h2>
          {built.loading && <Loading />}
          {built.error && <ErrorBox error={built.error} onRetry={built.reload} />}
          {built.data && <BuiltSummaryView built={built.data} onJump={onJump} fileExtra={fileExtra} />}

          <h2 id="concepts">{ko.understand.concepts}</h2>
          {!enrichment && <div className="small muted">{ko.concepts.ruleBasedOnly}</div>}
          {concepts === null && !conceptsErr && <Loading />}
          {conceptsErr && <ErrorBox error={conceptsErr} onRetry={loadConcepts} />}
          {concepts && <ConceptList concepts={concepts} onJump={onJump} coveredIds={covered} />}

          {wiki && (
            <>
              <h2>{ko.wiki.coverage}</h2>
              <WikiCoverage wiki={wiki} />
            </>
          )}
          <UnderstandingPanel conceptIds={understandingConcepts} concepts={catalog} profile={profile} learner={learner} />
        </div>
        <HelpPanel data={data} />
      </div>
    </FocusProvider>
  );
}
