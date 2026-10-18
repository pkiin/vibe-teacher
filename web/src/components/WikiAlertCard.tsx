import type { RiskFinding, WikiSnapshot } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { ClaimList } from './ClaimList';

const IMPACT_PILL: Record<string, string> = { high: 'pill-red', medium: 'pill-yellow', low: 'pill-gray', undetermined: 'pill-outline' };

/** 공통 알림. 색만으로 뜻을 전하지 않도록 영향·근거 상태를 글자로 함께 적는다. */
export function WikiAlertCard({ finding, snapshot, onJump }: { finding: RiskFinding; snapshot: WikiSnapshot; onJump?: (i: number) => void }) {
  return (
    <article className={`wiki-alert impact-${finding.impact}`} id={`finding-${finding.id}`}>
      <div className="concept-head">
        <h3>{finding.title}</h3>
        <span className={`pill ${IMPACT_PILL[finding.impact] ?? 'pill-gray'}`}>{ko.wiki.impact[finding.impact]}</span>
        <span className="pill pill-outline">{ko.wiki.evidenceStatus[finding.evidenceStatus]}</span>
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
