import type { LearnerConceptState, TeachingPlan } from '@vibe-teacher/shared';
import { Link } from 'react-router';
import { ko } from '../i18n/ko';

/** 연습 성과와 그 근거를 숙련 배지 옆에서 확인한다. */
export function LearningHistory({ state, scope, teaching = state?.teaching }: { state?: LearnerConceptState; scope?: 'project' | 'session'; teaching?: TeachingPlan }) {
  if (!state) return null;
  const c = state.counts;
  return <div className="learning-history small">
    {state.progress && <p><span className="pill pill-outline">{ko.learning.progress[state.progress]}</span></p>}
    <div>{scope ? ko.learning.scopeTitle[scope] : ko.learning.saved}: {ko.learning.practice(c.practiceCorrect ?? 0, c.practiceIncorrect ?? 0)} · {ko.learning.questions(c.questions ?? 0)}</div>
    {teaching && teaching.reason !== 'default' && <p className="muted">{ko.learning.next}: {ko.learning.reason[teaching.reason]}</p>}
    {!!state.activity?.length && <details className="evidence">
      <summary>{ko.learning.recent} ({state.activity.length})</summary>
      <ul>{[...state.activity].reverse().map((a) => <li key={a.id}>
        <time dateTime={a.at}>{new Date(a.at).toLocaleString('ko-KR')}</time> · {ko.learning.kind[a.kind]}{a.grade ? ` · ${ko.learning.grade[a.grade]}` : ''}{a.selfReport ? ` · ${ko.knowledge.selfReport[a.selfReport]}` : ''}
        {a.sessionKey && <> · <Link to={`/sessions/${encodeURIComponent(a.sessionKey)}?tab=understand`}>{ko.memory.source}</Link></>}
      </li>)}</ul>
      <p className="muted">{ko.learning.scope}</p>
    </details>}
  </div>;
}
