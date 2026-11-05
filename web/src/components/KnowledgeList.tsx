import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ExplanationDepth, KnowledgeEntry, KnowledgeSource, KnowledgeTextStartResponse, KnowledgeWikiResponse, LearnerProfile, WikiConcept } from '@vibe-teacher/shared';
import { apiPost } from '../api/client';
import { loadKnowledge, retainKnowledgeReasons, type DisplayKnowledge, type DisplayKnowledgeEntry } from '../api/knowledge';
import { useFocus } from '../context/FocusContext';
import { useJob } from '../hooks/useJob';
import { JobProgress } from './JobProgress';
import { useReader } from '../hooks/useReader';
import { useLearnerActions, type LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading, Notice } from './Notice';
import { QuizCard } from './QuizCard';
import { ConceptBody } from './WikiItemCard';
import { LearningHistory } from './LearningHistory';
import { askConceptPath, conceptAnchor, sessionAnalysisPath } from '../lib/session-analysis';

const STATE_PILL: Record<string, string> = { unknown: 'pill-gray', partial: 'pill-blue', demonstrated: 'pill-green', conflicting: 'pill-yellow' };
const DEPTHS: ExplanationDepth[] = ['D0', 'D1', 'D2', 'D3'];

type Open = 'check' | 'quiz' | 'explain' | 'wrong' | null;

/** 개념 → 분석 문서의 해당 개념 → 프로젝트 위키. 접힌 나머지 출처도 모두 열 수 있다. */
export function KnowledgeSourceLinks({ conceptId, sources }: { conceptId: string; sources: KnowledgeSource[] }) {
  const unique = [...new Map(sources.map((source) => [source.sessionKey, source])).values()];
  if (!unique.length) return null;
  const links = (list: KnowledgeSource[]) => <ul>{list.map((src) => <li key={src.sessionKey}>
    <Link to={sessionAnalysisPath(src.sessionKey, conceptAnchor(conceptId))}>{src.sessionTitle}</Link>
    {' · '}<Link className="muted" to={`/projects/${src.projectId}?tab=wiki`}>{src.projectName} {ko.analysis.projectLink}</Link>
  </li>)}</ul>;
  return <div className="small knowledge-sources">
    <strong>{ko.analysis.related}</strong>
    {links(unique.slice(0, 3))}
    {unique.length > 3 && <details className="evidence"><summary>{ko.analysis.moreSources(unique.length - 3)}</summary>{links(unique.slice(3))}</details>}
  </div>;
}

/** 지식 항목 하나: 이름 — 상태, 왜 그런지, 근거 세션, 그리고 바로 할 수 있는 확인 */
export function KnowledgeCard({ entry, concept, learner, sessionKey, writing = false }: { entry: DisplayKnowledgeEntry; concept?: WikiConcept; learner: LearnerActions; sessionKey?: string; writing?: boolean }) {
  const focus = useFocus();
  const [open, setOpen] = useState<Open>(null);
  const [depth, setDepth] = useState<ExplanationDepth>(entry.state.teaching?.depth ?? 'D1');
  const [actionError, setActionError] = useState<Error | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const s = entry.state;
  useEffect(() => { setDepth(s.teaching?.depth ?? 'D1'); }, [s.teaching?.depth]);
  const toggle = (o: Open) => setOpen((cur) => (cur === o ? null : o));
  const askSource = entry.sources[0];
  const showExplain = () => (focus ? focus.show({ kind: 'concept', id: entry.conceptId }, 'explain') : setOpen('explain'));
  // "사실 아직 잘 몰라요"(정정)는 문제로 오른 상태가 보일 때만 뜻이 있다. 그 밖에는 "잘 모르겠어요"(자기보고)를 둔다
  const canCorrect = !s.disputed && (s.state === 'partial' || s.state === 'demonstrated');
  // 상태는 배지 하나로만. 확인 기록이 없는 상태(unknown)는 묶음 제목과 학습 기록이 이미 말해 주므로 표시하지 않는다
  const status = [
    s.disputed ? <span key="state" className="pill pill-yellow">{ko.knowledge.disputed}</span>
      : s.state !== 'unknown' ? <span key="state" className={`pill ${STATE_PILL[s.state] ?? 'pill-gray'}`}>{ko.knowledge.state[s.state]}</span> : null,
    s.selfReport ? <span key="self" className="pill pill-outline">{ko.knowledge.selfReport[s.selfReport]}</span> : null,
  ].filter(Boolean);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      setActionError(null);
      await fn();
    } catch (e) {
      setActionError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="knowledge-card">
      <div className="concept-head">
        <h3>{entry.name}</h3>
        {/* 제목 옆에는 개념의 분류만. 내 학습 상태는 아래 학습 기록 줄에 모은다 */}
        <span className="pill pill-outline">{entry.category}</span>
      </div>
      <LearningHistory state={entry.scope?.state ?? s} scope={entry.scope?.kind} teaching={s.teaching} nudge={ko.knowledge.nudge} status={status.length ? status : undefined} />
      <p className="knowledge-reason">{entry.reason || entry.previousReason || entry.summary}</p>
      {entry.previousReason && <p className="small muted">{ko.knowledge.previousReason}</p>}
      {!entry.reason && <p className="small muted" role="status">{writing ? ko.knowledge.writing : entry.reasonOrigin === 'error' ? ko.knowledge.aiError : ko.knowledge.aiMissing}</p>}
      <KnowledgeSourceLinks conceptId={entry.conceptId} sources={entry.sources} />
      {entry.mentions.length > 0 && (
        <details className="evidence">
          <summary>{ko.knowledge.mentions(entry.mentions.length)}</summary>
          <ul>
            {entry.mentions.map((m) => (
              <li key={`${m.sessionKey}:${m.messageIndex}`}>
                <code>{m.snippet}</code> <span className="muted">— {m.sessionTitle}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="wiki-buttons">
        {/* '알고 있어요'는 바로 기록하지 않고 OX 확인 문제를 연다. 맞히면 서버가 기록한다 */}
        {s.selfReport !== 'known' && (
          <button className="btn btn-small" aria-expanded={open === 'check'} onClick={() => toggle('check')}>
            {ko.knowledge.known}
          </button>
        )}
        <button className="btn btn-small" aria-expanded={open === 'quiz'} onClick={() => toggle('quiz')}>
          {ko.knowledge.quiz}
        </button>
        <button className="btn btn-small" aria-expanded={open === 'explain'} onClick={() => (focus ? showExplain() : toggle('explain'))}>
          {ko.knowledge.explain}
        </button>
        {/* 질문은 세션 근거로 답한다. 분석 화면 안이면 도움 패널을, 밖이면 이 개념이 나온 분석 문서의 질문 탭을 연다 */}
        {focus ? (
          <button className="btn btn-small" onClick={() => focus.show({ kind: 'concept', id: entry.conceptId }, 'ask')}>
            {ko.help.askAbout}
          </button>
        ) : askSource && (
          <Link className="btn btn-small" to={askConceptPath(askSource.sessionKey, entry.conceptId)} title={ko.knowledge.askIn(askSource.sessionTitle)}>
            {ko.help.askAbout}
          </Link>
        )}
        {canCorrect ? (
          <button className="btn btn-small" aria-expanded={open === 'wrong'} onClick={() => toggle('wrong')}>
            {ko.knowledge.wrong}
          </button>
        ) : (
          <button className="btn btn-small" disabled={busy || s.selfReport === 'unsure'} onClick={() => run(async () => { await learner.selfReport(entry.conceptId, 'unsure'); showExplain(); })}>
            {ko.knowledge.unsure}
          </button>
        )}
      </div>
      {actionError && <ErrorBox error={actionError} />}
      {open === 'check' && <QuizCard sessionKey={sessionKey} target={{ conceptId: entry.conceptId }} learner={learner} explanationSeen={false} purpose="self_check" onClose={() => setOpen(null)} />}
      {open === 'quiz' && <QuizCard sessionKey={sessionKey} target={{ conceptId: entry.conceptId }} learner={learner} explanationSeen={false} onClose={() => setOpen(null)} />}
      {open === 'explain' && concept && (
        <div className="knowledge-explain">
          <div className="help-depth" role="group">
            {DEPTHS.map((d) => (
              <button key={d} type="button" disabled={busy} className={`btn btn-small ${depth === d ? 'btn-primary' : ''}`} aria-pressed={depth === d} onClick={() => { setDepth(d); void run(() => learner.preference(entry.conceptId, d, d !== 'D0')); }}>
                {ko.wiki.depth[d]}
              </button>
            ))}
          </div>
          <ConceptBody concept={concept} depth={depth} showExample={depth !== 'D0'} />
        </div>
      )}
      {open === 'wrong' && (sent || canCorrect) &&
        (sent ? (
          <div className="small muted">{ko.knowledge.sent}</div>
        ) : (
          <div className="understanding-correct">
            <textarea rows={2} maxLength={500} placeholder={ko.knowledge.wrongPlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await learner.correction(entry.conceptId, note.trim() || undefined);
                  setSent(true);
                })
              }
            >
              {ko.knowledge.send}
            </button>
          </div>
        ))}
    </article>
  );
}

type Group = 'check' | 'confirmed' | 'background';

function groupOf(e: KnowledgeEntry): Group {
  if (e.state.state === 'partial' || e.state.state === 'demonstrated') return e.state.disputed ? 'check' : 'confirmed';
  return e.priority === 'check' || e.state.disputed || e.state.state === 'conflicting' ? 'check' : 'background';
}

/**
 * 사용자 지식 위키 목록. 세션·프로젝트로 좁힐 수 있다. 상태를 바꾸면 onProfile 로 알린다
 * (세션 화면은 이걸 받아 설명 계획을 다시 받는다).
 */
export function KnowledgeList({ sessionKey, projectId, onProfile, refreshKey, showMeta = true, onProjects }: { sessionKey?: string; projectId?: string; onProfile?: (p: LearnerProfile) => void; refreshKey?: unknown; showMeta?: boolean; onProjects?: (projects: KnowledgeWikiResponse['projects']) => void }) {
  const [data, setData] = useState<DisplayKnowledge | null>(null);
  const dataRef = useRef<DisplayKnowledge | null>(null);
  const dataScope = useRef('');
  const request = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // 한 번 보는 동안 카드가 처음 놓인 묶음을 유지한다. 문제를 맞혀 상태가 오를 때 카드가 다른 묶음으로
  // 옮겨지며 다시 그려지면 방금 본 채점 결과·해설이 사라지기 때문이다. 범위·수준이 바뀌면 다시 나눈다
  const placed = useRef({ scope: '', groups: new Map<string, Group>() });
  const concepts = useMemo(() => new Map(Object.entries(data?.concepts ?? {})), [data?.concepts]);
  const query = new URLSearchParams({ ...(sessionKey ? { sessionKey } : {}), ...(projectId ? { projectId } : {}) }).toString();
  // 설명 문장은 읽는 사람 수준별로 저장된다. 수준이 바뀌면 다시 받고, 고르기 전에는 AI 작성을 시작하지 않는다
  const reader = useReader();

  const load = useCallback(() => {
    const id = ++request.current;
    const scope = `${query}|${reader.level}`;
    if (dataScope.current !== scope) { dataRef.current = null; setData(null); dataScope.current = scope; }
    setRefreshing(true);
    const apply = (view: KnowledgeWikiResponse, saved: boolean) => {
      if (request.current !== id) return;
      if (saved && dataRef.current && (view.profile.activityRevision ?? view.profile.revision) < (dataRef.current.profile.activityRevision ?? dataRef.current.profile.revision)) return;
      const display = retainKnowledgeReasons(dataRef.current, view);
      dataRef.current = display;
      setData(display);
      onProjects?.(display.projects);
    };
    void loadKnowledge(query, (view) => apply(view, true), (view) => {
        if (request.current !== id) return;
        apply(view, false);
        setError(null);
      })
      .catch((e: Error) => { if (request.current === id) setError(e); })
      .finally(() => { if (request.current === id) setRefreshing(false); });
  }, [query, reader.level, onProjects]);
  useEffect(() => {
    load();
    return () => { request.current++; };
  }, [load, refreshKey, reader.level]);

  const changed = useCallback(
    (p: LearnerProfile) => {
      load();
      onProfile?.(p);
    },
    [load, onProfile],
  );
  const learner = useLearnerActions(sessionKey, data?.profile.revision ?? 0, changed);

  // 설명 문장: 저장된 AI 문장이 없는 항목이 있으면 자동으로 쓰기 작업을 시작한다.
  // 한 번에 다 못 쓰면 이어서 시작하되, 아무것도 못 쓴 작업 뒤에는 멈춘다 (무한 반복 방지).
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startPending = useRef(false);
  const [textError, setTextError] = useState<string | null>(null);
  const runs = useRef({ scope: '', count: 0, stalled: false });
  const { job, error: jobError } = useJob<{ written: number; remaining: number }>(jobId ? `/api/me/knowledge/text/jobs/${jobId}` : null);
  const startText = useCallback(async (force = false) => {
    if (startPending.current) return;
    startPending.current = true;
    setStarting(true);
    setTextError(null);
    try {
      const res = await apiPost<KnowledgeTextStartResponse>('/api/me/knowledge/text', { force, ...(sessionKey ? { sessionKey } : {}), ...(projectId ? { projectId } : {}) });
      if (res.status === 'done') load();
      else setJobId(res.jobId);
    } catch (e) {
      setTextError((e as Error).message);
    } finally { startPending.current = false; setStarting(false); }
  }, [sessionKey, projectId, load]);
  useEffect(() => {
    const scope = `${query}|${reader.level}`;
    if (runs.current.scope !== scope) runs.current = { scope, count: 0, stalled: false };
    if (!reader.chosen || refreshing || starting || !data?.text.canGenerate || jobId || textError || runs.current.stalled || runs.current.count >= 5) return;
    runs.current.count += 1;
    void startText();
  }, [data, jobId, textError, query, startText, reader.chosen, reader.level, refreshing, starting]);
  useEffect(() => {
    if (!job || job.state === 'queued' || job.state === 'running') return;
    if (job.state === 'error') setTextError(job.error?.message ?? '');
    if (job.state !== 'done' || !job.result?.written) runs.current.stalled = true;
    setJobId(null);
    load();
  }, [job, load]);
  useEffect(() => {
    if (jobError) {
      setTextError(jobError.message);
      setJobId(null);
    }
  }, [jobError]);
  const retryText = () => {
    runs.current = { scope: `${query}|${reader.level}`, count: 0, stalled: false };
    void startText(true);
  };

  if (error && !data) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Loading />;
  const groups: Record<Group, DisplayKnowledgeEntry[]> = { check: [], confirmed: [], background: [] };
  if (placed.current.scope !== dataScope.current) placed.current = { scope: dataScope.current, groups: new Map() };
  for (const e of data.entries) {
    const g = placed.current.groups.get(e.conceptId) ?? groupOf(e);
    placed.current.groups.set(e.conceptId, g);
    groups[g].push(e);
  }

  return (
    <div className="knowledge">
      {refreshing && <p className="small muted" role="status">{ko.knowledge.checkingSaved}</p>}
      {error && <ErrorBox error={error} onRetry={load} />}
      {showMeta && (
        <p className="small muted">
          {ko.knowledge.note} {ko.knowledge.scanned(data.scannedSessions, data.totalSessions)}
        </p>
      )}
      <JobProgress job={job} busy={starting || !!jobId} preparing={starting} label={ko.knowledge.writingAll(data.text.missing)} />
      {textError !== null && (
        <Notice kind="warn">
          <span>{ko.knowledge.textFailed(textError)}</span>
          <button className="btn btn-small" onClick={retryText}>
            {ko.knowledge.retryText}
          </button>
        </Notice>
      )}
      {!refreshing && textError === null && !jobId && data.text.generator.kind === 'unavailable' && data.entries.some((e) => e.reasonOrigin === 'missing') && <Notice kind="warn">{ko.knowledge.ruleNotice(data.text.generator.reason)}</Notice>}
      {!refreshing && !jobId && !textError && data.entries.some((e) => e.reasonOrigin === 'error') && <Notice kind="warn"><span>{ko.knowledge.aiError}</span><button className="btn btn-small" onClick={retryText}>{ko.knowledge.retryText}</button></Notice>}
      {!refreshing && !starting && !jobId && data.text.missing > 0 && data.text.generator.kind === 'llm' && <button className="btn btn-small" onClick={() => void startText()}>{ko.knowledge.writeAi}</button>}
      {!data.entries.length && <div className="muted">{ko.knowledge.empty}</div>}
      {(['check', 'confirmed', 'background'] as Group[]).map((g) =>
        groups[g].length ? (
          <details key={g} className="knowledge-group" open={g !== 'background'}>
            <summary>
              <strong>{ko.knowledge.groups[g]}</strong> <span className="badge">{groups[g].length}</span>
            </summary>
            {groups[g].map((e) => (
              <KnowledgeCard key={e.conceptId} entry={e} concept={concepts.get(e.conceptId)} learner={learner} sessionKey={sessionKey} writing={!!jobId} />
            ))}
          </details>
        ) : null,
      )}
    </div>
  );
}
