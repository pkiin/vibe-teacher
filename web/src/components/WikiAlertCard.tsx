import type { RiskFinding, WikiSnapshot } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { useFocus } from '../context/FocusContext';
import { ClaimList } from './ClaimList';

const IMPACT_PILL: Record<string, string> = { high: 'pill-red', medium: 'pill-yellow', low: 'pill-gray', undetermined: 'pill-outline' };

/** 공통 알림. 색만으로 뜻을 전하지 않도록 영향·근거 상태를 글자로 함께 적는다. */
export function WikiAlertCard({ finding, snapshot, onJump, anchor = true }: { finding: RiskFinding; snapshot: WikiSnapshot; onJump?: (i: number) => void; anchor?: boolean }) {
  const focus = useFocus();
  const inPanel = focus?.focus.kind === 'finding' && focus.focus.id === finding.id;
  return (
    <article className={`wiki-alert impact-${finding.impact}`} id={anchor ? `finding-${finding.id}` : undefined}>
      <div className="concept-head">
        <h3>{finding.title}</h3>
        <span className={`pill ${IMPACT_PILL[finding.impact] ?? 'pill-gray'}`}>{ko.wiki.impact[finding.impact]}</span>
        <span className="pill pill-outline">{ko.wiki.evidenceStatus[finding.evidenceStatus]}</span>
        {focus && !inPanel && (
          <button type="button" className="link small" onClick={() => focus.show({ kind: 'finding', id: finding.id }, 'ask')}>
            {ko.help.askAbout}
          </button>
        )}
      </div>
      <p>{finding.statement}</p>
      {finding.checks.length > 0 && (
        <div className="wiki-checks">
          <strong>{ko.wiki.checks}</strong>
          <ul>
            {finding.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <ClaimList claimIds={finding.claimIds} snapshot={snapshot} onJump={onJump} />
      {finding.missingContext.length > 0 && (
        <div className="small muted">
          {ko.wiki.missing}: {finding.missingContext.join(', ')}
        </div>
      )}
    </article>
  );
}
