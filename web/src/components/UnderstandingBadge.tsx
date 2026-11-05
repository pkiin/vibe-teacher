import type { LearnerConceptState } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

const STATE_PILL: Record<string, string> = { unknown: 'pill-gray', partial: 'pill-blue', demonstrated: 'pill-green', conflicting: 'pill-yellow' };

/**
 * 개념별 이해 추정. "완전히 이해함" 같은 표현 없이 상태와 범위만 보여 준다.
 * 내 지식 카드와 같은 문구를 쓰고, 확인 기록이 없는 상태(unknown)는 표시하지 않는다.
 */
export function UnderstandingBadge({ state }: { state?: LearnerConceptState }) {
  const s = state?.state ?? 'unknown';
  if (s === 'unknown' && !state?.selfReport && !state?.disputed) return null;
  return (
    <span className="understanding-badge" title={state?.assessmentScope ?? ''}>
      {s !== 'unknown' && <span className={`pill ${STATE_PILL[s] ?? 'pill-gray'}`}>{ko.knowledge.state[s]}</span>}
      {state?.selfReport && <span className="pill pill-outline">{ko.understanding.selfReport[state.selfReport]}</span>}
      {state?.disputed && <span className="pill pill-yellow">{ko.knowledge.disputed}</span>}
    </span>
  );
}
