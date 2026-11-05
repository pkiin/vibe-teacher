import type { ReactNode } from 'react';
import type { LearnerConceptState, TeachingPlan } from '@vibe-teacher/shared';
import { Link } from 'react-router';
import { ko } from '../i18n/ko';

/**
 * 맞힌 문제와 최근 활동을 보여 준다. 첫 줄에는 내 학습 상태 배지(status)와 학습 흐름을 함께 둔다.
 * 오답·질문 수는 원장에 남기고 설명 방침에만 쓰며 화면에는 세지 않는다. 맞힌 문제가 없으면 문제 풀기를 권한다.
 * "연습하고 있어요"(practicing)는 상태 배지와 겹치므로 표시하지 않는다.
 */
export function LearningHistory({ state, scope, teaching = state?.teaching, nudge = ko.learning.nudge, status }: { state?: LearnerConceptState; scope?: 'project' | 'session'; teaching?: TeachingPlan; nudge?: string; status?: ReactNode }) {
  if (!state) return null;
  const c = state.counts;
  const solved = c.correct + (c.practiceCorrect ?? 0);
  const progress = state.progress && state.progress !== 'practicing' ? state.progress : undefined;
  return <div className="learning-history small">
    {(status || progress) && <p className="learning-status">{status}{progress && <span className="pill pill-outline">{ko.learning.progress[progress]}</span>}</p>}
    {solved > 0 ? <div>{scope ? ko.learning.scopeTitle[scope] : ko.learning.saved}: {ko.learning.solved(solved)}</div> : <p className="muted">{nudge}</p>}
    {teaching && teaching.reason !== 'default' && <p className="muted">{ko.learning.next}: {ko.learning.reason[teaching.reason]}</p>}
    {!!state.activity?.length && <details className="evidence">
      <summary>{ko.learning.recent} ({state.activity.length})</summary>
      <ul>{[...state.activity].reverse().map((a) => <li key={a.id}>
        <time dateTime={a.at}>{new Date(a.at).toLocaleString('ko-KR')}</time> · {ko.learning.kind[a.kind]}{a.grade === 'correct' ? ` · ${ko.learning.grade.correct}` : ''}{a.selfReport ? ` · ${ko.knowledge.selfReport[a.selfReport]}` : ''}
        {a.sessionKey && <> · <Link to={`/sessions/${encodeURIComponent(a.sessionKey)}?tab=understand`}>{ko.memory.source}</Link></>}
      </li>)}</ul>
    </details>}
  </div>;
}
