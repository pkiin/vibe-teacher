import { useEffect, useRef, useState } from 'react';
import { QUESTION_FEEDBACK_REASONS, type AssessmentResult, type AssessmentStartResponse, type LearnerProfile, type QuestionFeedbackReason, type ResponseStatus } from '@vibe-teacher/shared';
import { ApiError, apiPost } from '../api/client';
import type { LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { Modal } from './Modal';
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
  sessionKey,
  target,
  learner,
  explanationSeen,
  helpUsed = false,
  purpose,
  onClose,
}: {
  /** 세션 화면에서 풀면 그 세션 (전체 지식 위키에서는 없음) */
  sessionKey?: string;
  target: QuizTarget;
  learner: LearnerActions;
  explanationSeen: boolean;
  /** 이 개념을 도움 패널로 물어본 뒤의 응답이면 true — 보조(assisted)로 기록되어 이해 상태 추정에 쓰지 않는다 */
  helpUsed?: boolean;
  /** '알고 있어요' 확인: 첫 문제는 OX 로 내고, 맞히면 서버가 '알고 있어요'를 기록한다. "다른 문제"부터는 일반 문제 */
  purpose?: 'self_check';
  onClose?: () => void;
}) {
  const [start, setStart] = useState<AssessmentStartResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [checking, setChecking] = useState(!!purpose);
  const request = useRef(0);

  /** 처음에는 지정한 문항/개념, "다른 문제"는 같은 개념에서 이미 본 문항을 빼고 고른다 */
  const load = (exclude: string[], conceptId?: string) => {
    const current = ++request.current;
    setStart(null);
    setResult(null);
    setSelected(null);
    setReason('');
    setError(null);
    const selfCheck = !!purpose && !exclude.length;
    setChecking(selfCheck);
    const ctx = { ...(sessionKey ? { sessionKey } : {}), ...(selfCheck ? { purpose } : {}) };
    const body = exclude.length ? { ...ctx, conceptId: target.conceptId ?? conceptId, excludeQuestionIds: exclude } : { ...ctx, ...target };
    apiPost<AssessmentStartResponse>('/api/me/assessments', body)
      .then((s) => {
        if (request.current !== current) return;
        setStart(s);
        setSeen((xs) => [...new Set([...xs, s.question.questionId])]);
      })
      .catch((e: Error) => { if (request.current === current) setError(e); });
  };

  useEffect(() => {
    load([]);
    return () => { request.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, target.conceptId, target.questionId]);

  const submit = async (status: ResponseStatus) => {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      const r = await learner.withRevision((baseRevision) =>
        apiPost<AssessmentResult>(`/api/me/assessments/${start.assessmentId}/responses`, {
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
  if (!start) return <div className="quiz card" aria-busy="true"><Loading text={ko.quiz.preparing} /></div>;
  const q = start.question;
  const name = `quiz-${start.assessmentId}`;

  return (
    <div className="quiz card" role="group" aria-label={checking ? ko.quiz.selfCheckTitle : ko.quiz.title} aria-busy={busy}>
      <div className="concept-head">
        <strong>{checking ? ko.quiz.selfCheckTitle : ko.quiz.title}</strong>
        <span className="pill pill-outline">{ko.quiz.format[q.format]}</span>
        {q.reviewStatus === 'candidate' && <span className="pill pill-outline">{ko.quiz.candidate}</span>}
        {/* 정답을 공개한 문제만 문제 은행에 있으므로 답을 확인한 뒤에만 신고할 수 있다 (건너뛴 문제는 제외) */}
        {result && result.status !== 'skipped' && result.correctOptionIds.length > 0 && (
          <QuestionReport key={`${q.questionId}@${q.version}`} questionId={q.questionId} version={q.version} prompt={q.prompt} learner={learner} />
        )}
      </div>
      <p className="small muted">{checking ? ko.quiz.selfCheckIntro : ko.quiz.intro}</p>
      {q.reviewStatus === 'candidate' && <p className="small muted">{ko.quiz.candidateNote}</p>}
      {!start.firstAttempt && !result && <div className="small muted">{ko.quiz.retry}</div>}
      <p className="quiz-prompt">{q.prompt}</p>
      <fieldset className="quiz-options" disabled={!!result || busy}>
        <legend className="sr-only">{q.prompt}</legend>
        {q.options.map((o) => {
          const isAnswer = result?.correctOptionIds.includes(o.id);
          const isMine = selected === o.id;
          return (
            <label key={o.id} className={`quiz-option ${!result && isMine ? 'is-selected' : ''} ${result && isAnswer ? 'is-answer' : ''} ${result && isMine && !isAnswer ? 'is-wrong' : ''}`}>
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
          <details className="quiz-reason-disclosure">
            <summary className="small muted">{ko.quiz.showReason}</summary>
            <label className="small muted quiz-reason">
              {ko.quiz.reason}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} />
            </label>
          </details>
          <div className="quiz-actions">
            <button className="btn btn-primary btn-small" disabled={!selected || busy} onClick={() => submit('answered')}>
              {busy ? ko.quiz.sending : ko.quiz.submit}
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
            {/* 맞힌 응답만 어디에 기록됐는지 보여 준다. 틀린 응답은 원장에만 남긴다 */}
            {result.grade === 'correct' && <span className={`pill ${result.counted ? 'pill-green' : 'pill-gray'}`}>{result.counted ? ko.quiz.counted : ko.quiz.practice}</span>}
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

type ReportStep = 'write' | 'confirm' | 'done';

/** 사유를 골랐고, '기타'면 이유까지 적어야 제출할 수 있다 */
export function reportReady(reason: QuestionFeedbackReason | null, note: string): boolean {
  return !!reason && (reason !== 'other' || note.trim().length > 0);
}

/**
 * 문제 신고. 카드 오른쪽 위 '신고' 버튼 → 창에서 사유·이유 작성 → "정말 제출하시겠습니까?"를 한 번 더 묻고 보낸다.
 * 보내면 이 문제의 응답은 내 지식 상태·정답 수에서 빠지고, 다음 문제를 만들 때 AI 에 사유를 알려 준다.
 * 정답을 확인한 문제(문제 은행에 있는 문제)만 신고할 수 있어 답을 확인한 뒤에만 버튼을 보인다.
 */
export function QuestionReport({ questionId, version, prompt, learner }: { questionId: string; version: number; prompt: string; learner: LearnerActions }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ReportStep>('write');
  const [reason, setReason] = useState<QuestionFeedbackReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const done = step === 'done';
  const close = () => {
    if (busy) return;
    setOpen(false); setError(null);
    if (!done) setStep('write');
  };
  const send = async () => {
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      const r = await learner.withRevision((baseRevision) => apiPost<{ profile: LearnerProfile }>('/api/me/question-feedback', { baseRevision, questionId, questionVersion: version, reason, ...(note.trim() ? { note: note.trim() } : {}) }));
      learner.profileChanged(r.profile);
      setStep('done');
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  const trimmed = note.trim();
  return (
    <>
      {done && !open
        ? <span className="pill pill-outline quiz-report-trigger" role="status" title={ko.quiz.reportSent}>{ko.quiz.reportDone}</span>
        : (
          <button type="button" className="btn btn-small quiz-report-trigger" aria-haspopup="dialog" aria-label={ko.quiz.reportLabel} onClick={() => setOpen(true)}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 14.5V2" /><path d="M3.5 2.5h8.5l-2 3 2 3H3.5" /></svg>
            {ko.quiz.report}
          </button>
        )}
      {/* 창은 열 때만 그린다 (포털은 서버 렌더링에서 쓸 수 없음) */}
      {open && (
        <Modal open title={ko.quiz.reportTitle} onClose={close} className="quiz-report-modal">
          <div className="quiz-report">
            <p className="quiz-report-question"><span className="small muted">{ko.quiz.reportQuestion}</span>{prompt}</p>
            {step === 'write' && (
              <form onSubmit={(e) => { e.preventDefault(); if (reportReady(reason, note)) setStep('confirm'); }}>
                <fieldset>
                  <legend>{ko.quiz.reportReasonsTitle}</legend>
                  {QUESTION_FEEDBACK_REASONS.map((r) => (
                    <label key={r} className="quiz-report-reason">
                      <input type="radio" name={`report-${questionId}-${version}`} value={r} checked={reason === r} onChange={() => setReason(r)} /> {ko.quiz.reportReasons[r]}
                    </label>
                  ))}
                </fieldset>
                <label className="quiz-report-note">
                  {reason === 'other' ? ko.quiz.reportNoteRequired : ko.quiz.reportNoteLabel}
                  <textarea rows={3} maxLength={500} placeholder={ko.quiz.reportNote} value={note} required={reason === 'other'} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="quiz-actions">
                  <button type="submit" className="btn btn-primary btn-small" disabled={!reportReady(reason, note)}>{ko.quiz.reportSubmit}</button>
                  <button type="button" className="btn btn-small" onClick={close}>{ko.quiz.reportCancel}</button>
                </div>
              </form>
            )}
            {step === 'confirm' && reason && (
              <div aria-busy={busy}>
                {/* 화면 읽기 프로그램이 확인 질문부터 읽도록 초점을 옮긴다 (실수로 바로 제출되지 않게 버튼에는 두지 않음) */}
                <p className="quiz-report-confirm" tabIndex={-1} autoFocus>{ko.quiz.reportConfirm}</p>
                <dl className="quiz-report-summary">
                  <dt>{ko.quiz.reportReasonShort}</dt><dd>{ko.quiz.reportReasons[reason]}</dd>
                  {trimmed && <><dt>{ko.quiz.reportNoteShort}</dt><dd>{trimmed}</dd></>}
                </dl>
                <p className="small muted">{ko.quiz.reportConfirmNote}</p>
                {error && <ErrorBox error={error} />}
                <div className="quiz-actions">
                  <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void send()}>{busy ? ko.quiz.reportSending : ko.quiz.reportYes}</button>
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => { setStep('write'); setError(null); }}>{ko.quiz.reportBack}</button>
                </div>
              </div>
            )}
            {done && (
              <>
                <p role="status">{ko.quiz.reportSent}</p>
                <div className="quiz-actions"><button type="button" className="btn btn-small" autoFocus onClick={close}>{ko.quiz.close}</button></div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
