import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ExplanationDepth, KnowledgeEntry, KnowledgeTextStartResponse, KnowledgeWikiResponse, LearnerProfile, WikiConcept } from '@vibe-teacher/shared';
import { api, apiPost } from '../api/client';
import { useFocus } from '../context/FocusContext';
import { useApi } from '../hooks/useApi';
import { useJob } from '../hooks/useJob';
import { useReader } from '../hooks/useReader';
import { useLearnerActions, type LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading, Notice } from './Notice';
import { QuizCard } from './QuizCard';
import { ConceptBody } from './WikiItemCard';

const STATE_PILL: Record<string, string> = { unknown: 'pill-gray', partial: 'pill-blue', demonstrated: 'pill-green', conflicting: 'pill-yellow' };
const DEPTHS: ExplanationDepth[] = ['D0', 'D1', 'D2', 'D3'];

type Open = 'quiz' | 'explain' | 'wrong' | null;

/** 지식 항목 하나: 이름 — 상태, 왜 그런지, 근거 세션, 그리고 바로 할 수 있는 확인 */
export function KnowledgeCard({ entry, concept, learner, sessionKey, writing = false }: { entry: KnowledgeEntry; concept?: WikiConcept; learner: LearnerActions; sessionKey?: string; writing?: boolean }) {
  const focus = useFocus();
  const [open, setOpen] = useState<Open>(null);
  const [depth, setDepth] = useState<ExplanationDepth>('D1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const s = entry.state;
  const toggle = (o: Open) => setOpen((cur) => (cur === o ? null : o));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const sources = entry.sources;
  const projects = new Set(sources.map((x) => x.projectId));

  return (
    <article className="knowledge-card">
      <div className="concept-head">
        <h3>
          {entry.name} <span className="muted">—</span> <span className="knowledge-state">{s.disputed ? ko.knowledge.disputed : ko.knowledge.state[s.state]}</span>
        </h3>
        <span className={`pill ${STATE_PILL[s.state] ?? 'pill-gray'}`}>{ko.knowledge.state[s.state]}</span>
        {s.selfReport && <span className="pill pill-outline">{ko.knowledge.selfReport[s.selfReport]}</span>}
        <span className="pill pill-outline">{entry.category}</span>
      </div>
      {writing && entry.reasonOrigin !== 'llm' ? (
        <p className="knowledge-reason knowledge-reason-pending muted">{ko.knowledge.writing}</p>
      ) : (
        <p className="knowledge-reason">
          {entry.reason}
          {!entry.reason && <span className="muted">{entry.reasonOrigin === 'error' ? ko.knowledge.aiError : ko.knowledge.aiMissing}</span>}
        </p>
      )}
      {sources.length > 0 && (
        <div className="small knowledge-sources">
          {ko.knowledge.sources}:{' '}
          {sources.slice(0, 3).map((src, i) => (
            <span key={src.sessionKey}>
              {i > 0 && ', '}
              <Link to={`/sessions/${encodeURIComponent(src.sessionKey)}?tab=understand`}>
                {projects.size > 1 ? `${src.projectName} · ` : ''}
                {src.sessionTitle} {ko.knowledge.sessionSuffix}
              </Link>
            </span>
          ))}
          {sources.length > 3 && <span className="muted"> {ko.knowledge.moreSources(sources.length - 3)}</span>}
        </div>
      )}
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
        <button className="btn btn-small" disabled={busy || s.selfReport === 'known'} onClick={() => run(() => learner.selfReport(entry.conceptId, 'known'))}>
          {ko.knowledge.known}
        </button>
        <button className="btn btn-small" aria-expanded={open === 'quiz'} onClick={() => toggle('quiz')}>
          {ko.knowledge.quiz}
        </button>
        <button className="btn btn-small" aria-expanded={open === 'explain'} onClick={() => (focus ? focus.show({ kind: 'concept', id: entry.conceptId }, 'explain') : toggle('explain'))}>
          {ko.knowledge.explain}
        </button>
        <button className="btn btn-small" aria-expanded={open === 'wrong'} onClick={() => toggle('wrong')}>
          {ko.knowledge.wrong}
        </button>
      </div>
      {open === 'quiz' && <QuizCard sessionKey={sessionKey} target={{ conceptId: entry.conceptId }} learner={learner} explanationSeen={false} onClose={() => setOpen(null)} />}
      {open === 'explain' && concept && (
        <div className="knowledge-explain">
          <div className="help-depth" role="group">
            {DEPTHS.map((d) => (
              <button key={d} type="button" className={`btn btn-small ${depth === d ? 'btn-primary' : ''}`} aria-pressed={depth === d} onClick={() => setDepth(d)}>
                {ko.wiki.depth[d]}
              </button>
            ))}
          </div>
          <ConceptBody concept={concept} depth={depth} showExample={depth !== 'D0'} />
        </div>
      )}
      {open === 'wrong' &&
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
export function KnowledgeList({ sessionKey, projectId, onProfile, refreshKey, showMeta = true }: { sessionKey?: string; projectId?: string; onProfile?: (p: LearnerProfile) => void; refreshKey?: unknown; showMeta?: boolean }) {
  const [data, setData] = useState<KnowledgeWikiResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const concepts = useMemo(() => new Map(Object.entries(data?.concepts ?? {})), [data?.concepts]);
  const query = new URLSearchParams({ ...(sessionKey ? { sessionKey } : {}), ...(projectId ? { projectId } : {}) }).toString();
  // 설명 문장은 읽는 사람 수준별로 저장된다. 수준이 바뀌면 다시 받고, 고르기 전에는 AI 작성을 시작하지 않는다
  const reader = useReader();

  const load = useCallback(() => {
    api<KnowledgeWikiResponse>(`/api/me/knowledge${query ? `?${query}` : ''}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e));
  }, [query]);
  useEffect(() => {
    load();
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
  const [textError, setTextError] = useState<string | null>(null);
  const runs = useRef({ scope: '', count: 0, stalled: false });
  const { job, error: jobError } = useJob<{ written: number; remaining: number }>(jobId ? `/api/me/knowledge/text/jobs/${jobId}` : null);
  const startText = useCallback(async (force = false) => {
    setTextError(null);
    try {
      const res = await apiPost<KnowledgeTextStartResponse>('/api/me/knowledge/text', { force, ...(sessionKey ? { sessionKey } : {}), ...(projectId ? { projectId } : {}) });
      if (res.status === 'done') load();
      else setJobId(res.jobId);
    } catch (e) {
      setTextError((e as Error).message);
    }
  }, [sessionKey, projectId, load]);
  useEffect(() => {
    const scope = `${query}|${reader.level}`;
    if (runs.current.scope !== scope) runs.current = { scope, count: 0, stalled: false };
    if (!reader.chosen || !data?.text.canGenerate || jobId || textError || runs.current.stalled || runs.current.count >= 5) return;
    runs.current.count += 1;
    void startText();
  }, [data, jobId, textError, query, startText, reader.chosen, reader.level]);
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

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Loading />;
  const groups: Record<Group, KnowledgeEntry[]> = { check: [], confirmed: [], background: [] };
  for (const e of data.entries) groups[groupOf(e)].push(e);

  return (
    <div className="knowledge">
      {showMeta && (
        <p className="small muted">
          {ko.knowledge.note} {ko.knowledge.scanned(data.scannedSessions, data.totalSessions)}
        </p>
      )}
      {jobId && data.text.missing > 0 && <Notice kind="info">{ko.knowledge.writingAll(data.text.missing)}</Notice>}
      {textError !== null && (
        <Notice kind="warn">
          <span>{ko.knowledge.textFailed(textError)}</span>
          <button className="btn btn-small" onClick={retryText}>
            {ko.knowledge.retryText}
          </button>
        </Notice>
      )}
      {textError === null && !jobId && data.text.generator.kind === 'unavailable' && data.entries.some((e) => e.reasonOrigin === 'missing') && <Notice kind="warn">{ko.knowledge.ruleNotice(data.text.generator.reason)}</Notice>}
      {!jobId && !textError && data.entries.some((e) => e.reasonOrigin === 'error') && <Notice kind="warn"><span>{ko.knowledge.aiError}</span><button className="btn btn-small" onClick={retryText}>{ko.knowledge.retryText}</button></Notice>}
      {!jobId && data.text.missing > 0 && data.text.generator.kind === 'llm' && <button className="btn btn-small" onClick={() => void startText()}>{ko.knowledge.writeAi}</button>}
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
