import type { WikiSnapshot } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { InlineText } from './InlineText';

const KIND_PILL: Record<string, string> = { observed_artifact: 'pill-green', agent_reported: 'pill-yellow', inference: 'pill-gray', background: 'pill-outline' };

/** 주장마다 종류(관찰/에이전트 보고/해석)와 근거 발췌를 함께 보여 준다 */
export function ClaimList({ claimIds, snapshot, onJump }: { claimIds: string[]; snapshot: WikiSnapshot; onJump?: (messageIndex: number) => void }) {
  const evidence = new Map(snapshot.evidence.map((e) => [e.id, e]));
  const claims = claimIds.map((id) => snapshot.claims.find((c) => c.id === id)).filter((c) => !!c);
  if (!claims.length) return null;
  return (
    <ul className="claims">
      {claims.map((c) => (
        <li key={c.id}>
          <span className={`pill ${KIND_PILL[c.kind] ?? 'pill-gray'} claim-kind`}>{ko.wiki.claimKind[c.kind] ?? c.kind}</span>
          {c.origin === 'llm' && <span className="pill pill-yellow">{ko.wikiAi.claimBadge}</span>} <InlineText text={c.statement} />
          {c.limits.length > 0 && <div className="small muted">{c.limits.join(' · ')}</div>}
          {c.evidenceIds.length > 0 && (
            <details className="evidence">
              <summary>
                {ko.wiki.evidence} ({c.evidenceIds.length})
              </summary>
              <ul>
                {c.evidenceIds.map((id) => {
                  const e = evidence.get(id);
                  if (!e) return null;
                  return (
                    <li key={id}>
                      <span className="muted">{e.locator}</span> <code>{e.excerpt}</code>
                      {e.sourceKind === 'human_message' && e.messageIndex !== undefined && onJump && (
                        <button className="link" onClick={() => onJump(e.messageIndex as number)}>
                          {ko.wiki.jump}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
