import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BuiltSummary,
  ConceptHit,
  EnrichmentRecord,
  ExplanationDepth,
  FileFact,
  HelpFocus,
  HelpJobStatus,
  HelpMessage,
  HelpThreadsResponse,
  LearnerProfile,
  WikiConcept,
  WikiResponse,
} from '@vibe-teacher/shared';
import { apiDelete, apiPost, api } from '../api/client';
import { useFocus, type PanelTab } from '../context/FocusContext';
import { useJob } from '../hooks/useJob';
import { requestId, type LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ClaimList } from './ClaimList';
import { FocusChip } from './FocusChip';
import { InlineText } from './InlineText';
import { ErrorBox, Notice } from './Notice';
import { QuizCard } from './QuizCard';
import { UnderstandingBadge } from './UnderstandingBadge';
import { WikiAlertCard } from './WikiAlertCard';
import { Tabs } from './Tabs';
import { ConceptBody } from './WikiItemCard';

/** 통합 화면이 도움 패널에 넘기는 재료 */
export interface UnderstandData {
  projectId: string;
  sessionKey: string;
  wiki: WikiResponse | null;
  built: BuiltSummary | null;
  concepts: ConceptHit[];
  catalog: Record<string, WikiConcept>;
  profile: LearnerProfile | null;
  learner: LearnerActions;
  enrichment: EnrichmentRecord | null;
  onJump?: (i: number) => void;
}

const DEPTHS: ExplanationDepth[] = ['D0', 'D1', 'D2', 'D3'];

export function allFiles(built: BuiltSummary | null): { f: FileFact; status: 'created' | 'modified' | 'deleted' }[] {
  if (!built) return [];
  return [
    ...built.filesCreated.map((f) => ({ f, status: 'created' as const })),
    ...built.filesModified.map((f) => ({ f, status: 'modified' as const })),
    ...built.filesDeleted.map((f) => ({ f, status: 'deleted' as const })),
  ];
}

/** 파일과 같은 도구 호출을 근거로 삼는 위키 항목, 같은 경로를 근거로 삼는 개념 */
export function fileLinks(file: FileFact, data: Pick<UnderstandData, 'wiki' | 'concepts'>): { itemIds: string[]; conceptIds: string[] } {
  const shown = file.relPath ?? file.path;
  const calls = new Set(file.evidence.map((e) => e.toolCallId).filter(Boolean));
  const snap = data.wiki?.snapshot;
  const evById = new Map((snap?.evidence ?? []).map((e) => [e.id, e]));
  const claimIds = new Set((snap?.claims ?? []).filter((c) => c.statement.includes(shown) || c.evidenceIds.some((id) => calls.has(evById.get(id)?.toolCallId))).map((c) => c.id));
  return {
    itemIds: (snap?.items ?? []).filter((i) => i.claimIds.some((id) => claimIds.has(id))).map((i) => i.id),
    conceptIds: data.concepts.filter((h) => h.evidence.some((e) => e.snippet.includes(shown))).map((h) => h.id),
  };
}

export function focusLabel(focus: HelpFocus, data: Pick<UnderstandData, 'wiki' | 'concepts' | 'catalog' | 'built'>): string {
  const id = focus.id ?? '';
  if (focus.kind === 'concept') return data.catalog[id]?.name ?? data.concepts.find((c) => c.id === id)?.name ?? id;
  if (focus.kind === 'item') return data.wiki?.snapshot.items.find((i) => i.id === id)?.title ?? id;
  if (focus.kind === 'finding') return data.wiki?.snapshot.findings.find((f) => f.id === id)?.title ?? id;
  if (focus.kind === 'file') {
    const hit = allFiles(data.built).find((x) => x.f.path === id || x.f.relPath === id);
    return hit?.f.relPath ?? id;
  }
  return ko.help.session;
}

/** 이 대상과 묶인 대표 개념 (문제 풀이에 씀) */
function conceptOf(focus: HelpFocus, data: UnderstandData): string | undefined {
  if (focus.kind === 'concept') return focus.id;
  if (focus.kind === 'item') return data.wiki?.snapshot.items.find((i) => i.id === focus.id)?.conceptIds[0];
  if (focus.kind === 'finding') return data.wiki?.snapshot.findings.find((f) => f.id === focus.id)?.relatedConceptIds[0];
  if (focus.kind === 'file') {
    const file = allFiles(data.built).find((x) => x.f.path === focus.id || x.f.relPath === focus.id)?.f;
    if (file) {
      const links = fileLinks(file, data);
      return links.conceptIds[0] ?? data.wiki?.snapshot.items.find((i) => i.id === links.itemIds[0])?.conceptIds[0];
    }
  }
  return undefined;
}

function ExplainView({ data }: { data: UnderstandData }) {
  const f = useFocus()!;
  const { focus } = f;
  const [depth, setDepth] = useState<ExplanationDepth>('D1');
  const [example, setExample] = useState(false);
  useEffect(() => {
    setDepth('D1');
    setExample(false);
  }, [focus.kind, focus.id]);
  const snap = data.wiki?.snapshot;

  if (focus.kind === 'concept' && focus.id) {
    const id = focus.id;
    const concept = data.catalog[id];
    const hit = data.concepts.find((c) => c.id === id);
    const items = (snap?.items ?? []).filter((i) => i.conceptIds.includes(id));
    if (!concept && !hit) return <div className="muted small">{ko.help.notFound}</div>;
    return (
      <div className="help-explain">
        <div className="concept-head">
          <strong>{concept?.name ?? hit?.name}</strong>
          <UnderstandingBadge state={data.profile?.concepts[id]} />
        </div>
        {concept ? (
          <>
            <div className="help-depth" role="group" aria-label={ko.help.depth}>
              {DEPTHS.map((d) => (
                <button key={d} type="button" className={`btn btn-small ${depth === d ? 'btn-primary' : ''}`} aria-pressed={depth === d} onClick={() => setDepth(d)}>
                  {ko.wiki.depth[d]}
                </button>
              ))}
              {concept.example && (
                <button type="button" className="btn btn-small" aria-pressed={example} onClick={() => setExample((v) => !v)}>
                  {ko.wiki.example}
                </button>
              )}
            </div>
            <ConceptBody concept={concept} depth={depth} showExample={example} />
          </>
        ) : (
          <p>{hit?.explanation}</p>
        )}
        {hit && (
          <div className="concept-why">
            <strong>{ko.help.inThisSession}:</strong> {hit.llm?.whyHere ?? hit.whyHere}
          </div>
        )}
        {hit?.llm && (
          <div className="small">
            <span className="pill pill-yellow">{ko.help.aiNote}</span> {hit.llm.explanation}
            {hit.llm.example && <div className="muted">{hit.llm.example}</div>}
          </div>
        )}
        {items.length > 0 && (
          <div className="small help-related">
            {ko.help.relatedItems}:{' '}
            {items.map((i) => (
              <FocusChip key={i.id} focus={{ kind: 'item', id: i.id }} label={i.title} />
            ))}
          </div>
        )}
        <div className="wiki-buttons">
          <button className="btn btn-small" onClick={() => data.learner.selfReport(id, 'known')}>
            {ko.understanding.known}
          </button>
          <button className="btn btn-small" onClick={() => data.learner.selfReport(id, 'unsure')}>
            {ko.understanding.unsure}
          </button>
          <button className="btn btn-small" onClick={() => f.setTab('ask')}>
            {ko.help.askAbout}
          </button>
          <button className="btn btn-small" onClick={() => f.setTab('quiz')}>
            {ko.help.quizAbout}
          </button>
        </div>
      </div>
    );
  }

  if (focus.kind === 'item') {
    const item = snap?.items.find((i) => i.id === focus.id);
    if (!item || !snap) return <div className="muted small">{ko.help.notFound}</div>;
    const narrative = data.wiki?.ai?.narratives.find((n) => n.itemId === item.id);
    return (
      <div className="help-explain">
        <strong>{item.title}</strong>
        <div className="concept-why">
          <strong>{ko.wiki.why}:</strong> <InlineText text={item.why} />
        </div>
        {narrative && (
          <div className="wiki-narrative small">
            <span className="pill pill-yellow">{ko.wikiAi.narrativeBadge}</span> <InlineText text={narrative.text} />
          </div>
        )}
        <div className="small help-related">
          {ko.help.relatedConcepts}:{' '}
          {item.conceptIds.map((c) => (
            <FocusChip key={c} focus={{ kind: 'concept', id: c }} label={data.catalog[c]?.name ?? c} />
          ))}
        </div>
        <h4>{ko.wiki.facts}</h4>
        <ClaimList claimIds={item.claimIds} snapshot={snap} onJump={data.onJump} />
        {item.actions.length > 0 && (
          <>
            <h4>{ko.wiki.actions}</h4>
            <ul className="small">
              {item.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
        {item.unverified.length > 0 && (
          <>
            <h4>{ko.wiki.unverified}</h4>
            <ul className="small muted">
              {item.unverified.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (focus.kind === 'finding') {
    const finding = snap?.findings.find((x) => x.id === focus.id);
    if (!finding || !snap) return <div className="muted small">{ko.help.notFound}</div>;
    return <WikiAlertCard finding={finding} snapshot={snap} onJump={data.onJump} anchor={false} />;
  }

  if (focus.kind === 'file') {
    const hit = allFiles(data.built).find((x) => x.f.path === focus.id || x.f.relPath === focus.id);
    if (!hit) return <div className="muted small">{ko.help.notFound}</div>;
    const links = fileLinks(hit.f, data);
    return (
      <div className="help-explain">
        <div className="concept-head">
          <strong className="mono">{hit.f.relPath ?? hit.f.path}</strong>
          <span className="pill pill-outline">{ko.help.fileStatus[hit.status]}</span>
          {hit.f.language && <span className="pill pill-outline">{hit.f.language}</span>}
        </div>
        <ul className="small">
          {hit.f.evidence.map((e, i) => (
            <li key={i}>
              <code>{e.snippet}</code>
            </li>
          ))}
        </ul>
        {links.itemIds.length > 0 && (
          <div className="small help-related">
            {ko.help.relatedItems}:{' '}
            {links.itemIds.map((id) => (
              <FocusChip key={id} focus={{ kind: 'item', id }} label={snap?.items.find((i) => i.id === id)?.title ?? id} />
            ))}
          </div>
        )}
        {links.conceptIds.length > 0 && (
          <div className="small help-related">
            {ko.help.relatedConcepts}:{' '}
            {links.conceptIds.map((id) => (
              <FocusChip key={id} focus={{ kind: 'concept', id }} label={data.catalog[id]?.name ?? data.concepts.find((c) => c.id === id)?.name ?? id} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="help-explain small">
      {data.enrichment && <p className="enrich-oneliner">{data.enrichment.data.summary.oneLiner}</p>}
      <p className="muted">{ko.help.explainSession}</p>
    </div>
  );
}

function AnswerView({ m, data, onFollowUp }: { m: HelpMessage; data: UnderstandData; onFollowUp: (q: string) => void }) {
  const f = useFocus()!;
  const a = m.answer;
  if (!a) return null;
  return (
    <div className="help-answer">
      <div className="small muted">{m.mode === 'fallback' ? ko.help.fallback : ko.help.llm(m.provider ?? '', m.model)}</div>
      {m.notices.map((n) => (
        <div key={n} className="small llm-choice-reason">
          {n}
        </div>
      ))}
      <p>
        <InlineText text={a.answer} />
      </p>
      {a.projectConnection && (
        <div>
          <strong className="small">{ko.help.connection}</strong>
          <p className="small">
            <InlineText text={a.projectConnection} />
          </p>
          {data.wiki && a.claimIds.length > 0 && (
            <details className="evidence">
              <summary>
                {ko.help.evidence} ({a.claimIds.length})
              </summary>
              <ClaimList claimIds={a.claimIds} snapshot={data.wiki.snapshot} onJump={data.onJump} />
            </details>
          )}
        </div>
      )}
      {a.generalNote && (
        <div className="small">
          <strong>{ko.help.general}</strong>
          <p className="muted">{a.generalNote}</p>
        </div>
      )}
      {a.unverified.length > 0 && (
        <div className="small">
          <strong>{ko.help.unverified}</strong>
          <ul className="muted">
            {a.unverified.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
      {a.conceptIds.length > 0 && (
        <div className="small help-related">
          {ko.help.relatedConcepts}:{' '}
          {a.conceptIds.map((c) => (
            <FocusChip key={c} focus={{ kind: 'concept', id: c }} label={data.catalog[c]?.name ?? c} />
          ))}
        </div>
      )}
      {a.followUps.length > 0 && (
        <div className="small help-related">
          {ko.help.followUps}:{' '}
          {a.followUps.map((q) => (
            <button key={q} type="button" className="pill pill-outline focus-chip" onClick={() => onFollowUp(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <button className="link small" onClick={() => f.show(m.focus, 'explain')}>
        {ko.help.focusKind[m.focus.kind]}: {focusLabel(m.focus, data)}
      </button>
    </div>
  );
}

function PendingAnswer({ m, data, onDone }: { m: HelpMessage; data: UnderstandData; onDone: (m: HelpMessage) => void }) {
  const { job } = useJob<HelpMessage>(m.jobId ? `/api/projects/${data.projectId}/help/jobs/${m.jobId}` : null);
  useEffect(() => {
    if (job?.result && job.state === 'done') onDone(job.result);
    else if (job && (job.state === 'error' || job.state === 'cancelled')) onDone({ ...m, status: job.state, error: job.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.state]);
  return (
    <div className="small muted">
      {ko.help.asking}{' '}
      <button className="link small" onClick={() => m.jobId && apiDelete(`/api/projects/${data.projectId}/help/jobs/${m.jobId}`).catch(() => {})}>
        {ko.help.cancel}
      </button>
    </div>
  );
}

function AskView({ data }: { data: UnderstandData }) {
  const f = useFocus()!;
  const { focus } = f;
  const key = `${focus.kind}:${focus.id ?? ''}`;
  const [threads, setThreads] = useState<HelpThreadsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const draft = drafts[key] ?? '';
  const setDraft = useCallback((v: string) => setDrafts((d) => ({ ...d, [key]: v })), [key]);

  useEffect(() => {
    api<HelpThreadsResponse>(`/api/projects/${data.projectId}/help?sessionKey=${encodeURIComponent(data.sessionKey)}`)
      .then(setThreads)
      .catch((e: Error) => setError(e));
  }, [data.projectId, data.sessionKey]);

  const replace = (m: HelpMessage) => setThreads((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? m : x)) } : t));
  const send = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    const concept = conceptOf(focus, data);
    if (concept) f.markHelped([concept]);
    try {
      const res = await apiPost<{ message: HelpMessage }>(`/api/projects/${data.projectId}/help`, { sessionKey: data.sessionKey, requestId: requestId(), question, focus });
      setThreads((t) => (t ? { ...t, messages: [...t.messages, res.message] } : t));
      if (res.message.answer?.conceptIds.length) f.markHelped(res.message.answer.conceptIds);
      setDraft('');
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const label = focusLabel(focus, data);
  return (
    <div className="help-ask">
      {threads && !threads.llm.available && <Notice kind="warn">{ko.help.noLlm(threads.llm.reason ?? '')}</Notice>}
      {!data.wiki && <div className="small muted">{ko.help.noWiki}</div>}
      <div className="help-thread">
        {threads?.messages.length === 0 && <div className="small muted">{ko.help.empty}</div>}
        {threads?.messages.map((m) => (
          <div key={m.id} className={`help-msg ${m.focus.kind === focus.kind && m.focus.id === focus.id ? 'current' : ''}`}>
            <div className="help-q">
              <strong>Q.</strong> {m.question}
            </div>
            {m.status === 'pending' && <PendingAnswer m={m} data={data} onDone={replace} />}
            {m.status === 'done' && <AnswerView m={m} data={data} onFollowUp={setDraft} />}
            {(m.status === 'error' || m.status === 'cancelled') && (
              <div className="small">
                <span className="llm-choice-reason">{m.error?.message ?? m.status}</span>{' '}
                <button className="link small" onClick={() => setDraft(m.question)}>
                  {ko.help.retry}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <ErrorBox error={error} />}
      <textarea
        className="help-input"
        rows={3}
        maxLength={2000}
        placeholder={ko.help.askPlaceholder(label)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(draft);
        }}
        aria-label={ko.help.askPlaceholder(label)}
      />
      <div className="quiz-actions">
        <button className="btn btn-primary btn-small" disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          {ko.help.ask}
        </button>
      </div>
    </div>
  );
}

function QuizView({ data }: { data: UnderstandData }) {
  const f = useFocus()!;
  const [picked, setPicked] = useState<string | null>(null);
  // 제출 후 설명 계획이 바뀌어도 방금 푼 문제의 해설을 유지한다.
  const [suggested, setSuggested] = useState(data.wiki?.plan.optionalQuestionIds ?? []);
  useEffect(() => {
    const incoming = data.wiki?.plan.optionalQuestionIds ?? [];
    if (!suggested.length && incoming.length) setSuggested(incoming);
  }, [data.wiki, suggested.length]);
  const concept = conceptOf(f.focus, data);
  if (concept) {
    return <QuizCard key={concept} sessionKey={data.sessionKey} target={{ conceptId: concept }} learner={data.learner} explanationSeen={f.focus.kind !== 'session'} helpUsed={f.helped.has(concept)} />;
  }
  const questionId = picked && suggested.includes(picked) ? picked : suggested[0];
  return (
    <div>
      <div className="small muted">{ko.help.quizPick}</div>
      {suggested.length > 0 && (
        <>
          <h4>{ko.help.quizSuggested}</h4>
          <div className="quiz-steps" role="group" aria-label={ko.quiz.pickQuestion}>
            {suggested.map((qid, index) => (
              <button key={qid} type="button" className={`btn btn-small ${questionId === qid ? 'btn-primary' : ''}`} aria-pressed={questionId === qid} onClick={() => setPicked(qid)}>
                {ko.quiz.questionNumber(index + 1, suggested.length)}
              </button>
            ))}
          </div>
          {questionId && <QuizCard key={questionId} sessionKey={data.sessionKey} target={{ questionId }} learner={data.learner} explanationSeen={false} />}
        </>
      )}
    </div>
  );
}

/** 통합 화면 오른쪽의 도움 패널 (좁은 화면에서는 아래 서랍) */
export function HelpPanel({ data }: { data: UnderstandData }) {
  const f = useFocus()!;
  const label = useMemo(() => focusLabel(f.focus, data), [f.focus, data]);
  return (
    <aside className={`help-panel ${f.drawerOpen ? 'open' : ''}`} aria-label={ko.help.title}>
      <div className="help-head">
        <button type="button" className="help-toggle" onClick={() => f.setDrawerOpen(!f.drawerOpen)} aria-expanded={f.drawerOpen}>
          <strong>{ko.help.title}</strong> · <span className="small">{ko.help.focusKind[f.focus.kind]}: {label}</span>
        </button>
        {f.focus.kind !== 'session' && (
          <button type="button" className="link small" onClick={() => f.show({ kind: 'session' }, f.tab)}>
            {ko.help.reset}
          </button>
        )}
      </div>
      <div className="help-body">
        <Tabs className="help-tabs" tabs={(['explain', 'ask', 'quiz'] as PanelTab[]).map((id) => ({ id, label: ko.help.tabs[id]! }))} active={f.tab} onChange={(id) => f.setTab(id as PanelTab)} />
        <div className="help-tab-body">
          {f.tab === 'explain' && <ExplainView data={data} />}
          {f.tab === 'ask' && <AskView data={data} />}
          {f.tab === 'quiz' && <QuizView data={data} />}
        </div>
      </div>
    </aside>
  );
}
