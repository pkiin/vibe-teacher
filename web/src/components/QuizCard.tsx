import { useEffect, useState } from 'react';
import type { AssessmentResult, AssessmentStartResponse, ResponseStatus } from '@vibe-teacher/shared';
import { ApiError, apiPost } from '../api/client';
import type { LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ErrorBox, Loading } from './Notice';

export interface QuizTarget {
  conceptId?: string;
  questionId?: string;
}

/**
 * 객관식·OX 이해 확인. 정답은 제출한 뒤에만 서버가 알려 준다.
 * 건너뛰기·모르겠어요는 오답이 아니며, 풀지 않아도 위키 이용에 제한이 없다.
 */
export function QuizCard({
  projectId,
  sessionKey,
  target,
  learner,
  explanationSeen,
  helpUsed = false,
  onClose,
}: {
  projectId: string;
  sessionKey: string;
  target: QuizTarget;
  learner: LearnerActions;
  explanationSeen: boolean;
  /** 이 개념을 도움 패널로 물어본 뒤의 응답이면 true — 보조(assisted)로 기록되어 이해 상태 추정에 쓰지 않는다 */
  helpUsed?: boolean;
  onClose?: () => void;
}) {
  const [start, setStart] = useState<AssessmentStartResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);

  /** 처음에는 지정한 문항/개념, "다른 문제"는 같은 개념에서 이미 본 문항을 빼고 고른다 */
  const load = (exclude: string[], conceptId?: string) => {
    setStart(null);
    setResult(null);
    setSelected(null);
    setReason('');
    setError(null);
    const body = exclude.length ? { sessionKey, conceptId: target.conceptId ?? conceptId, excludeQuestionIds: exclude } : { sessionKey, ...target };
    apiPost<AssessmentStartResponse>(`/api/projects/${projectId}/assessments`, body)
      .then((s) => {
        setStart(s);
        setSeen((xs) => [...new Set([...xs, s.question.questionId])]);
      })
      .catch((e: Error) => setError(e));
  };

  useEffect(() => {
    load([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionKey, target.conceptId, target.questionId]);

  const submit = async (status: ResponseStatus) => {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      const r = await learner.withRevision((baseRevision) =>
        apiPost<AssessmentResult>(`/api/projects/${projectId}/assessments/${start.assessmentId}/responses`, {
          baseRevision,
          status,
          ...(status === 'answered' && selected ? { selectedOptionId: selected } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          explanationSeen,
          helpUsed,
        }),
      );
      setResult(r);
      learner.profileChanged(r.profile);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  if (error instanceof ApiError && error.code === 'no_question') return <div className="quiz card small muted">{ko.quiz.noQuestion}</div>;
  if (error && !start) return <ErrorBox error={error} onRetry={() => load([])} />;
  if (!start) return <Loading />;
  const q = start.question;
  const name = `quiz-${start.assessmentId}`;

  return (
    <div className="quiz card" role="group" aria-label={ko.quiz.title}>
      <div className="concept-head">
        <strong>{ko.quiz.title}</strong>
        <span className="pill pill-outline">{q.format === 'true_false' ? 'OX' : '객관식'}</span>
        {q.reviewStatus === 'candidate' && <span className="pill pill-yellow">{ko.quiz.candidate}</span>}
      </div>
      {!start.firstAttempt && !result && <div className="small muted">{ko.quiz.retry}</div>}
      <p className="quiz-prompt">{q.prompt}</p>
      <fieldset className="quiz-options" disabled={!!result || busy}>
        <legend className="sr-only">{q.prompt}</legend>
        {q.options.map((o) => {
          const isAnswer = result?.correctOptionIds.includes(o.id);
          const isMine = selected === o.id;
          return (
            <label key={o.id} className={`quiz-option ${result && isAnswer ? 'is-answer' : ''} ${result && isMine && !isAnswer ? 'is-wrong' : ''}`}>
              <input type="radio" name={name} value={o.id} checked={isMine} onChange={() => setSelected(o.id)} />
              <span>{o.text}</span>
              {result && isAnswer && <span className="pill pill-green">{ko.quiz.answerMark}</span>}
              {result && isMine && <span className="pill pill-outline">{ko.quiz.mineMark}</span>}
            </label>
          );
        })}
      </fieldset>
      {!result && (
        <>
          <label className="small muted quiz-reason">
            {ko.quiz.reason}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} />
          </label>
          <div className="quiz-actions">
            <button className="btn btn-primary btn-small" disabled={!selected || busy} onClick={() => submit('answered')}>
              {ko.quiz.submit}
            </button>
            <button className="btn btn-small" disabled={busy} onClick={() => submit('dont_know')}>
              {ko.quiz.dontKnow}
            </button>
            <button className="btn btn-small" disabled={busy} onClick={() => submit('skipped')}>
              {ko.quiz.skip}
            </button>
            {onClose && (
              <button className="link small" onClick={onClose}>
                {ko.quiz.close}
              </button>
            )}
          </div>
        </>
      )}
      {error && start && <ErrorBox error={error} />}
      {result && (
        <div className="quiz-result" aria-live="polite">
          <div>
            <strong>{result.grade === 'correct' ? ko.quiz.correct : result.grade === 'incorrect' ? ko.quiz.incorrect : ko.quiz.unscorable}</strong>{' '}
            <span className={`pill ${result.counted ? 'pill-blue' : 'pill-gray'}`}>{result.counted ? ko.quiz.counted : ko.quiz.practice}</span>
          </div>
          {result.explanation && <p>{result.explanation}</p>}
          {result.optionFeedback && <p className="small">{result.optionFeedback}</p>}
          <div className="small muted">{result.scopeNote}</div>
          <div className="quiz-actions">
            <button className="btn btn-small" onClick={() => load(seen, q.conceptIds[0])}>
              {ko.quiz.another}
            </button>
            {onClose && (
              <button className="link small" onClick={onClose}>
                {ko.quiz.close}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
