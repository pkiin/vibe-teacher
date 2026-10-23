import { useEffect, useState } from 'react';
import type { ExplanationDepth, KnowledgeItem, LearnerProfile, RenderBundle, WikiConcept, WikiResponse } from '@vibe-teacher/shared';
import type { LearnerActions } from '../hooks/useLearner';
import { ko } from '../i18n/ko';
import { useFocus } from '../context/FocusContext';
import { ClaimList } from './ClaimList';
import { FocusChip } from './FocusChip';
import { InlineText } from './InlineText';
import { QuizCard } from './QuizCard';
import { UnderstandingBadge } from './UnderstandingBadge';

const DEPTHS: ExplanationDepth[] = ['D0', 'D1', 'D2', 'D3'];

export function ConceptBody({ concept, depth, showExample }: { concept: WikiConcept; depth: ExplanationDepth; showExample?: boolean }) {
  const rich = depth === 'D2' || depth === 'D3';
  return (
    <>
      <p className="concept-exp">{depth === 'D0' ? concept.summary : concept.explanation}</p>
      {(rich || showExample) && concept.example && (
        <div className="concept-example">
          <strong>{ko.concepts.example}:</strong> {concept.example}
        </div>
      )}
      {rich && concept.confusions.length > 0 && (
        <div className="wiki-confusions">
          <strong>{ko.wiki.confusions}</strong>
          <ul>
            {concept.confusions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {depth === 'D3' && concept.deep && (
        <div className="wiki-deep">
          <strong>{ko.wiki.deep}</strong>
          <p>{concept.deep}</p>
        </div>
      )}
      {depth === 'D3' && concept.links.length > 0 && (
        <div className="concept-links small">
          {ko.wiki.readMore}:{' '}
          {concept.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">
              {l.title}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function reasonText(codes: string[]): string[] {
  const keys = codes.map((c) => (/^(partial|conflicting|incorrect_response):/.test(c) ? 'weak' : c));
  return [...new Set(keys)].map((k) => ko.wiki.reason[k] ?? '').filter(Boolean);
}

export function WikiItemCard({
  item,
  bundle,
  wiki,
  profile,
  learner,
  projectId,
  sessionKey,
  onJump,
  aiWriting = false,
}: {
  item: KnowledgeItem;
  bundle: RenderBundle | null;
  wiki: WikiResponse;
  profile: LearnerProfile | null;
  learner: LearnerActions;
  projectId: string;
  sessionKey: string;
  onJump?: (i: number) => void;
  aiWriting?: boolean;
}) {
  const planned = bundle?.depth ?? 'D1';
  const [depth, setDepth] = useState<ExplanationDepth>(planned);
  const [overridden, setOverridden] = useState(false);
  const [simple, setSimple] = useState(false);
  const [example, setExample] = useState(false);
  const [glossary, setGlossary] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!overridden) setDepth(planned);
  }, [planned, overridden]);

  const primaryId = item.conceptIds[0];
  const primary = primaryId ? wiki.concepts[primaryId] : undefined;
  const prereqs = bundle?.prerequisites ?? [];
  const related = item.conceptIds.slice(1).filter((id) => !prereqs.some((p) => p.conceptId === id));
  const findings = item.findingIds.map((id) => wiki.snapshot.findings.find((f) => f.id === id)).filter((f) => !!f);
  const name = (id: string) => wiki.concepts[id]?.name ?? id;
  const narrative = wiki.ai?.narratives.find((n) => n.itemId === item.id);
  const focus = useFocus();

  const changeDepth = (next: ExplanationDepth, action: 'deeper' | 'simpler') => {
    setDepth(next);
    setOverridden(true);
    learner.exposure(action, { conceptId: primaryId, itemId: item.id });
  };
  const report = async (value: 'known' | 'unsure') => {
    if (!primaryId) return;
    setBusy(true);
    try {
      await learner.selfReport(primaryId, value);
      setLater(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="wiki-item" id={`item-${item.id}`}>
      <div className="concept-head">
        <h3>{item.title}</h3>
        <span className={`pill ${item.relevance === 'direct' ? 'pill-blue' : 'pill-gray'}`}>{ko.wiki.relevance[item.relevance]}</span>
        {item.origin === 'llm' && <span className="pill pill-yellow">{ko.wikiAi.itemBadge}</span>}
        {findings.map((f) => (
          <a key={f.id} className="pill pill-outline" href={`#finding-${f.id}`}>
            {f.title}
          </a>
        ))}
      </div>
      {/* 저장된 AI 설명을 보여 주고, 생성 중에는 진행 상태를 표시한다 */}
      {!narrative && aiWriting && <div className="concept-why muted knowledge-reason-pending">{ko.wikiAi.writing}</div>}
      {!narrative && !aiWriting && item.why && (
        <div className="concept-why">
          <strong>{ko.wiki.why}:</strong> <InlineText text={item.why} /> {item.origin !== 'llm' && <span className="pill pill-outline small">{ko.wikiAi.ruleWhy}</span>}
        </div>
      )}

      {narrative && (
        <section className="wiki-narrative">
          <div className="concept-head">
            <strong>{ko.wikiAi.narrative}</strong>
            <span className="pill pill-yellow">{ko.wikiAi.narrativeBadge}</span>
          </div>
          <p>
            <InlineText text={narrative.text} />
          </p>
          <details className="evidence">
            <summary>
              {ko.wikiAi.cited} ({narrative.claimIds.length})
            </summary>
            <ClaimList claimIds={narrative.claimIds} snapshot={wiki.snapshot} onJump={onJump} />
          </details>
        </section>
      )}

      {primary && primaryId && (
        <section className="wiki-explain">
          <div className="wiki-explain-head">
            <FocusChip focus={{ kind: 'concept', id: primaryId }} label={primary.name} className="concept-name" />
            <UnderstandingBadge state={profile?.concepts[primaryId]} />
            <span className="pill pill-outline">{ko.wiki.depth[depth]}</span>
          </div>
          {!overridden &&
            bundle &&
            reasonText(bundle.reasonCodes).map((t) => (
              <div key={t} className="small muted">
                {t}
              </div>
            ))}
          <ConceptBody concept={primary} depth={depth} showExample={example} />
          <div className="wiki-buttons">
            <button
              className="btn btn-small"
              aria-expanded={glossary}
              onClick={() => {
                setGlossary((v) => !v);
                if (!glossary) learner.exposure('whats_this', { conceptId: primaryId, itemId: item.id });
              }}
            >
              {ko.wiki.whatsThis}
            </button>
            <button
              className="btn btn-small"
              disabled={simple && DEPTHS.indexOf(depth) <= 1}
              onClick={() => {
                // 더 쉽게 = 기본 설명(D1)으로 낮추고 선행 개념 설명과 예시를 함께 펼친다
                setSimple(true);
                setExample(true);
                changeDepth(DEPTHS.indexOf(depth) > 1 ? 'D1' : depth, 'simpler');
              }}
            >
              {ko.wiki.simpler}
            </button>
            <button className="btn btn-small" disabled={depth === 'D3'} onClick={() => changeDepth(DEPTHS[Math.min(3, DEPTHS.indexOf(depth) + 1)] ?? 'D3', 'deeper')}>
              {ko.wiki.deeper}
            </button>
            {primary.example && (
              <button
                className="btn btn-small"
                aria-pressed={example}
                onClick={() => {
                  setExample((v) => !v);
                  if (!example) learner.exposure('example', { conceptId: primaryId, itemId: item.id });
                }}
              >
                {ko.wiki.example}
              </button>
            )}
          </div>
          {glossary && (
            <dl className="wiki-glossary">
              {item.conceptIds.map((id) => (
                <div key={id}>
                  <dt>{name(id)}</dt>
                  <dd>{wiki.concepts[id]?.summary}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {(prereqs.length > 0 || (bundle?.prerequisiteUnmet.length ?? 0) > 0) && (
        <section>
          <h4>{ko.wiki.prerequisites}</h4>
          <ul className="wiki-prereqs">
            {prereqs.map((p) => {
              const c = wiki.concepts[p.conceptId];
              if (!c) return null;
              const expanded = open.has(p.conceptId) || (simple && !p.recallOnly);
              return (
                <li key={p.conceptId}>
                  <FocusChip focus={{ kind: 'concept', id: p.conceptId }} label={c.name} className="concept-name" /> <UnderstandingBadge state={profile?.concepts[p.conceptId]} /> — {c.summary}
                  <button
                    className="link small"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(p.conceptId)) n.delete(p.conceptId);
                        else n.add(p.conceptId);
                        return n;
                      })
                    }
                  >
                    {expanded ? ko.wiki.collapse : ko.wiki.expand}
                  </button>
                  {expanded && <p className="small">{c.explanation}</p>}
                </li>
              );
            })}
          </ul>
          {bundle && bundle.prerequisiteUnmet.length > 0 && <div className="small muted">{ko.wiki.prerequisiteUnmet(bundle.prerequisiteUnmet.map(name).join(', '))}</div>}
        </section>
      )}

      {related.length > 0 && (
        <div className="small wiki-related">
          {ko.wiki.related}:{' '}
          {related.map((id) => (
            <FocusChip key={id} focus={{ kind: 'concept', id }} label={name(id)} />
          ))}
        </div>
      )}

      <section>
        <h4>{ko.wiki.facts}</h4>
        <ClaimList claimIds={item.claimIds} snapshot={wiki.snapshot} onJump={onJump} />
      </section>
      {item.actions.length > 0 && (
        <section>
          <h4>{ko.wiki.actions}</h4>
          <ul>
            {item.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      {item.unverified.length > 0 && (
        <section>
          <h4>{ko.wiki.unverified}</h4>
          <ul className="muted">
            {item.unverified.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {primary && primaryId && !later && !quiz && (
        <div className="understanding-check">
          <span className="small">{primary.name}</span>
          <button className="btn btn-small" disabled={busy} onClick={() => report('known')}>
            {ko.understanding.known}
          </button>
          <button className="btn btn-small" disabled={busy} onClick={() => report('unsure')}>
            {ko.understanding.unsure}
          </button>
          <button className="btn btn-small" onClick={() => (focus ? focus.show({ kind: 'concept', id: primaryId }, 'quiz') : setQuiz(true))}>
            {ko.understanding.quiz}
          </button>
          {focus && (
            <button className="btn btn-small" onClick={() => focus.show({ kind: 'item', id: item.id }, 'ask')}>
              {ko.help.askAbout}
            </button>
          )}
          <button className="link small" onClick={() => setLater(true)}>
            {ko.understanding.later}
          </button>
        </div>
      )}
      {quiz && primaryId && <QuizCard sessionKey={sessionKey} target={{ conceptId: primaryId }} learner={learner} explanationSeen onClose={() => setQuiz(false)} />}
    </article>
  );
}
