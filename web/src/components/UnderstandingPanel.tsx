import { useState } from 'react';
import type { LearnerConceptState, LearnerProfile, WikiConcept } from '@vibe-teacher/shared';
import type { LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { ErrorBox } from './Notice';
import { UnderstandingBadge } from './UnderstandingBadge';

type Group = 'confirmed' | 'unconfirmed' | 'disputed';

function groupOf(s: LearnerConceptState | undefined): Group {
  if (!s) return 'unconfirmed';
  if (s.disputed || s.state === 'conflicting') return 'disputed';
  if (s.state === 'partial' || s.state === 'demonstrated') return 'confirmed';
  return 'unconfirmed';
}

/**
 * 내 이해 정보 열람·정정 (Open Learner Model). "모르는 영역" 대신
 * 확인된 부분 / 아직 확인되지 않은 부분 / 이견이 있는 부분으로 나눠 근거 범위와 함께 보여 준다.
 */
export function UnderstandingPanel({ conceptIds, concepts, profile, learner }: { conceptIds: string[]; concepts: Record<string, WikiConcept>; profile: LearnerProfile | null; learner: LearnerActions }) {
  const ids = [...new Set([...conceptIds, ...Object.keys(profile?.concepts ?? {})])].filter((id) => concepts[id]);
  const groups: Record<Group, string[]> = { confirmed: [], unconfirmed: [], disputed: [] };
  for (const id of ids) groups[groupOf(profile?.concepts[id])].push(id);

  return (
    <details className="card understanding-panel">
      <summary>
        <strong>{ko.understanding.title}</strong>
      </summary>
      <p className="small muted">{ko.understanding.note}</p>
      {!ids.length && <div className="muted">{ko.understanding.empty}</div>}
      {(['confirmed', 'disputed', 'unconfirmed'] as Group[]).map((g) =>
        groups[g].length ? (
          <div key={g}>
            <h4>{ko.understanding.groups[g]}</h4>
            <ul className="understanding-list">
              {groups[g].map((id) => (
                <ConceptRow key={id} id={id} concept={concepts[id]!} state={profile?.concepts[id]} learner={learner} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </details>
  );
}

function ConceptRow({ id, concept, state, learner }: { id: string; concept: WikiConcept; state?: LearnerConceptState; learner: LearnerActions }) {
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <div className="concept-head">
        <strong>{concept.name}</strong>
        <UnderstandingBadge state={state} />
      </div>
      {state?.assessmentScope && (
        <div className="small muted">
          {ko.understanding.scope}: {state.assessmentScope}
        </div>
      )}
      {state && <div className="small muted">{ko.understanding.counts(state.counts)}</div>}
      <div className="wiki-buttons">
        <button className="btn btn-small" disabled={busy} onClick={() => run(() => learner.selfReport(id, 'known'))}>
          {ko.understanding.known}
        </button>
        <button className="btn btn-small" disabled={busy} onClick={() => run(() => learner.selfReport(id, 'unsure'))}>
          {ko.understanding.unsure}
        </button>
        {state && (state.state !== 'unknown' || state.selfReport) && (
          <button className="link small" onClick={() => setCorrecting((v) => !v)}>
            {ko.understanding.correct}
          </button>
        )}
      </div>
      {correcting && (
        <div className="understanding-correct">
          <textarea rows={2} maxLength={500} placeholder={ko.understanding.correctPlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await learner.correction(id, note.trim() || undefined);
                setCorrecting(false);
                setNote('');
              })
            }
          >
            {ko.understanding.send}
          </button>
        </div>
      )}
      {error && <ErrorBox error={error} />}
    </li>
  );
}
