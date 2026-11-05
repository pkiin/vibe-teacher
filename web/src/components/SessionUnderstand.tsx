import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { BuiltSummary, ConceptHit, EnrichmentRecord, LearnerProfile, WikiConcept, WikiResponse } from '@vibe-teacher/shared';
import { ApiError, api } from '../api/client';
import { FocusProvider, useFocus } from '../context/FocusContext';
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
import { askedConcept } from '../lib/session-analysis';

/**
 * 세션 (대화 기록) 분석 문서 — 작업·개념·보안 주의사항을 한 화면에 잇고,
 * 오른쪽 도움 패널(설명/질문/퀴즈)이 지금 보고 있는 대상을 따라간다.
 */
export function SessionUnderstand({ sessionKey, projectId, onJump }: { sessionKey: string; projectId: string; onJump?: (i: number) => void }) {
  const enc = encodeURIComponent(sessionKey);
  const built = useApi<BuiltSummary>(`/api/sessions/${enc}/built`);
  const [concepts, setConcepts] = useState<ConceptHit[] | null>(null);
  const [conceptsErr, setConceptsErr] = useState<Error | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentRecord | null>(null);
  const [enrichmentReady, setEnrichmentReady] = useState(false);
  const [wiki, setWiki] = useState<WikiResponse | null>(null);
  const [wikiState, setWikiState] = useState<'loading' | 'missing' | 'ready' | 'error'>('loading');
  const [wikiErr, setWikiErr] = useState<Error | null>(null);
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
    setEnrichmentReady(false);
    let active = true;
    api<EnrichmentRecord>(`/api/sessions/${enc}/enrichment`)
      .then((result) => { if (active) setEnrichment(result); })
      .catch(() => { if (active) setEnrichment(null); })
      .finally(() => { if (active) setEnrichmentReady(true); });
    return () => { active = false; };
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

  const catalog = useMemo(() => ({ ...Object.fromEntries((concepts ?? []).map((c) => [c.id, { ...c, summary: c.explanation, confusions: [], links: c.links ?? [] }])), ...wiki?.concepts }), [concepts, wiki]);
  const data: UnderstandData = { projectId, sessionKey, wiki, built: built.data, concepts: concepts ?? [], catalog, profile, learner, enrichment, onJump };
  const covered = useMemo(() => new Set(wiki?.snapshot.items.flatMap((i) => i.conceptIds) ?? []), [wiki]);
  // 비동기로 문서가 도착한 뒤에도 링크가 가리킨 절·개념으로 이동한다.
  const { hash } = useLocation();
  const scrolled = useRef('');
  useEffect(() => {
    if (!hash) { scrolled.current = ''; return; }
    if (scrolled.current === hash) return;
    if (!enrichmentReady || wikiState === 'loading' || (concepts === null && !conceptsErr)) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id) ?? (id.startsWith('concept-') ? document.getElementById('concepts') : null);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    scrolled.current = hash;
  }, [hash, wiki, concepts, conceptsErr, wikiState, enrichmentReady]);

  return (
    <FocusProvider>
      <OpenAskFromUrl />
      <div className="understand">
        <div className="understand-main">
          <nav className="reading-path" aria-label={ko.reading.path}>
            {(['summary', 'wiki', 'concepts', 'knowledge', 'security'] as const).map((key, index) => (
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
            onWikiUpdated={(result) => {
              if (result) { setWiki(result); setWikiState('ready'); }
              else loadWiki(true);
              loadConcepts();
            }}
            onWikiWriting={setAiWriting}
          />

          <section className="card" id="summary">
            <h3 className="section-title">{ko.understand.summary}</h3>
            <SessionSummaryCard enrichment={enrichment} />
          </section>

          <h2 id="wiki">{ko.understand.wiki}</h2>
          {wikiState === 'loading' && <Loading />}
          {wikiState === 'error' && wikiErr && <ErrorBox error={wikiErr} onRetry={() => loadWiki()} />}
          {(wikiState === 'missing' || wikiState === 'ready') && <WikiHeader wiki={wiki} />}
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
          <KnowledgeList sessionKey={sessionKey} onProfile={onProfile} refreshKey={`${profile?.revision}|${profile?.activityRevision}|${wiki?.ai?.createdAt}|${enrichment?.createdAt}`} showMeta={false} />

          <SecurityReview wiki={wiki} onJump={onJump} />
        </div>
        <HelpPanel data={data} />
      </div>
    </FocusProvider>
  );
}

/** ?ask=<개념 ID> 로 열면 도움 패널을 그 개념의 질문 탭으로 연다 (내 지식·프로젝트 화면의 "질문하기") */
function OpenAskFromUrl() {
  const focus = useFocus();
  const [params] = useSearchParams();
  const id = askedConcept(params);
  const opened = useRef('');
  useEffect(() => {
    if (!focus || !id || opened.current === id) return;
    opened.current = id;
    focus.show({ kind: 'concept', id }, 'ask');
  }, [focus, id]);
  return null;
}
