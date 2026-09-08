import type { ConceptHit } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

export function ConceptList({ concepts, onJump }: { concepts: ConceptHit[]; onJump?: (i: number) => void }) {
  if (!concepts.length) return <div className="muted">{ko.concepts.empty}</div>;
  return (
    <div className="concepts">
      {concepts.map((c) => (
        <article key={c.id} className="concept">
          <div className="concept-head">
            <h3>{c.name}</h3>
            <span className="pill pill-outline">{c.category}</span>
            <span className={`pill ${c.level === 'beginner' ? 'pill-green' : 'pill-yellow'}`}>{ko.concepts.level[c.level]}</span>
            {c.llm && <span className="pill pill-blue">AI</span>}
          </div>
          <p className="concept-exp">{c.llm?.explanation ?? c.explanation}</p>
          <div className="concept-why">
            <strong>{ko.concepts.whyHere}:</strong> {c.llm?.whyHere ?? c.whyHere}
          </div>
          {c.llm?.example && (
            <div className="concept-example">
              <strong>{ko.concepts.example}:</strong> <code>{c.llm.example}</code>
            </div>
          )}
          {c.evidence.length > 0 && (
            <details className="evidence">
              <summary>
                {ko.common.evidence} ({c.evidence.length})
              </summary>
              <ul>
                {c.evidence.map((e, i) => (
                  <li key={i}>
                    <code>{e.snippet}</code>
                    {e.messageIndex != null && onJump && (
                      <button className="link" onClick={() => onJump(e.messageIndex as number)}>
                        #{e.messageIndex}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {c.links && c.links.length > 0 && (
            <div className="concept-links small">
              {ko.concepts.links}:{' '}
              {c.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
                  {l.title}
                </a>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
