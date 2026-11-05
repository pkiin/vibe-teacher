import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MemorySearchResponse, MyQuestion, MyQuestionsResponse, SolvedQuestion, SolvedQuestionsResponse } from '@vibe-teacher/shared';
import { apiPost } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useTechnicalDetails } from '../hooks/useTechnicalDetails';
import { ko } from '../i18n/ko';
import { askConceptPath, sessionAnalysisPath } from '../lib/session-analysis';
import { ErrorBox, Loading, Notice } from './Notice';

const SHOWN = 5;

/** 처음 몇 개를 보여 주고 나머지는 접어 둔다 */
function Folded<T>({ items, render }: { items: readonly T[]; render: (item: T) => ReactNode }) {
  const shown = items.slice(0, SHOWN), rest = items.slice(SHOWN);
  return (
    <>
      <ul>{shown.map(render)}</ul>
      {rest.length > 0 && (
        <details>
          <summary className="small">{ko.memory.more(rest.length)}</summary>
          <ul>{rest.map(render)}</ul>
        </details>
      )}
    </>
  );
}

function QuestionItem({ q }: { q: MyQuestion }) {
  // 개념에 대해 물은 질문은 그 개념의 질문 탭으로 다시 열어 이어서 물을 수 있게 한다
  const to = q.focus.kind === 'concept' && q.focus.id ? askConceptPath(q.sessionKey, q.focus.id) : sessionAnalysisPath(q.sessionKey);
  return (
    <li>
      <p className="my-question">{q.question}</p>
      <span className="small muted">
        <time dateTime={q.askedAt}>{new Date(q.askedAt).toLocaleDateString('ko-KR')}</time>
        {' · '}
        <Link to={to}>{q.sessionTitle ?? ko.memory.openSession}</Link>
      </span>
      {q.answer && (
        <details className="evidence">
          <summary>{ko.memory.showAnswer}</summary>
          <p>{q.answer}</p>
        </details>
      )}
    </li>
  );
}

/** 내가 한 질문 (답을 받은 것만) */
export function MyQuestionList({ questions }: { questions: readonly MyQuestion[] }) {
  return <Folded items={questions} render={(q) => <QuestionItem key={q.id} q={q} />} />;
}

function SolvedItem({ q }: { q: SolvedQuestion }) {
  return (
    <li>
      <p className="my-question">{q.prompt}</p>
      <span className="small muted">
        <time dateTime={q.answeredAt}>{new Date(q.answeredAt).toLocaleDateString('ko-KR')}</time>
        {q.conceptNames.length > 0 && <> · {q.conceptNames.join(', ')}</>}
      </span>
      {/* 맞힌 문제만 표시하고 틀린 문제는 따로 표시하지 않는다 */}
      {q.grade === 'correct' && !q.feedback && <span className="pill pill-green">{ko.memory.solvedMark}</span>}
      {q.feedback && <span className="pill pill-outline">{ko.memory.flagged}</span>}
      <details className="evidence">
        <summary>{ko.memory.showSolution}</summary>
        <ul className="solved-options">
          {q.options.map((o) => (
            <li key={o.id} className={q.correctOptionIds.includes(o.id) ? 'is-answer' : ''}>
              {o.text} {q.correctOptionIds.includes(o.id) && <span className="pill pill-green">{ko.quiz.answerMark}</span>}
            </li>
          ))}
        </ul>
        <p>{q.explanation}</p>
      </details>
    </li>
  );
}

/** 내가 풀어 본 문제 (문제 은행: 정답이 공개된 문제만) */
export function SolvedList({ questions }: { questions: readonly SolvedQuestion[] }) {
  return <Folded items={questions} render={(q) => <SolvedItem key={`${q.questionId}@${q.version}`} q={q} />} />;
}

/** 기술 정보: 도움 패널 답변이 참고하는 기억 저장소 설정·색인 갱신. 관리자·junior/senior 에게만 */
function MemoryTechnical({ projectId }: { projectId?: string }) {
  const path = `/api/me/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`;
  const status = useApi<MemorySearchResponse>(path, [projectId]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const sync = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ indexed: number; remaining: number; notices: string[] }>('/api/me/memory/sync', { projectId });
      setNote([ko.memory.synced(r.indexed, r.remaining), ...r.notices].join(' · '));
      status.reload();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  const data = status.data;
  return (
    <details className="small memory-technical">
      <summary>{ko.memory.technical}</summary>
      {data && <>
        <p className="muted">{data.configuredBackend === 'mem0' ? ko.memory.mem0Intro : data.configuredBackend === 'supermemory' ? ko.memory.cloudIntro : ko.memory.localIntro}</p>
        <p className="muted">{ko.memory[data.backend]} · {ko.memory.count(data.total)}{data.databaseProvider && <> · {ko.memory.database[data.databaseProvider]}</>}</p>
        {data.notices.map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
        {data.canSync ? <button className="btn btn-small" disabled={busy} onClick={() => void sync()}>{ko.memory.sync}</button> : <p className="muted">{ko.memory.noSync}</p>}
      </>}
      {(status.error || error) && <ErrorBox error={(error ?? status.error)!} />}
      {note && <p role="status">{note}</p>}
    </details>
  );
}

/**
 * 내 기억 검색: 예전에 한 질문과 풀어 본 문제만 보여 준다.
 * 퀴즈 응답·자기보고·열람 같은 내부 학습 기록은 계속 저장되어 도움 패널 답변에 쓰이지만 여기에는 보이지 않는다.
 */
export function MemoryPanel({ projectId }: { projectId?: string }) {
  const technical = useTechnicalDetails();
  // 접혀 있는 동안에는 읽지 않는다 (회원 모드에서는 프로젝트마다 저장소 왕복이 생긴다)
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const params = new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(applied ? { q: applied } : {}) }).toString();
  const questions = useApi<MyQuestionsResponse>(open ? `/api/me/questions${params ? `?${params}` : ''}` : null);
  const solved = useApi<SolvedQuestionsResponse>(open ? `/api/me/solved${params ? `?${params}` : ''}` : null);
  return (
    <details className="memory-panel card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><strong>{ko.memory.title}</strong></summary>
      <p className="small muted">{ko.memory.intro}</p>
      <form onSubmit={(e) => { e.preventDefault(); setApplied(query.trim()); }} className="memory-search">
        <input aria-label={ko.memory.title} placeholder={ko.memory.placeholder} value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-small">{ko.memory.search}</button>
      </form>

      <section className="my-questions">
        <h3>{ko.memory.questionsTitle}{questions.data ? ` (${questions.data.total})` : ''}</h3>
        {questions.loading && <Loading text={ko.memory.loading} />}
        {questions.error && <ErrorBox error={questions.error} onRetry={questions.reload} />}
        {questions.data && (questions.data.questions.length ? <MyQuestionList questions={questions.data.questions} /> : <p className="small muted">{applied ? ko.memory.empty : ko.memory.questionsEmpty}</p>)}
      </section>

      <section className="my-questions">
        <h3>{ko.memory.solvedTitle}{solved.data ? ` (${solved.data.total})` : ''}</h3>
        {solved.loading && <Loading text={ko.memory.loading} />}
        {solved.error && <ErrorBox error={solved.error} onRetry={solved.reload} />}
        {solved.data && (solved.data.questions.length ? <SolvedList questions={solved.data.questions} /> : <p className="small muted">{applied ? ko.memory.empty : ko.memory.solvedEmpty}</p>)}
      </section>

      {technical && open && <MemoryTechnical {...(projectId ? { projectId } : {})} />}
    </details>
  );
}
