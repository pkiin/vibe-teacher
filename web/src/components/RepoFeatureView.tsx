import { useContext } from 'react';
import { Link } from 'react-router';
import type { RepoFeatureAiCall, RepoFeatureCode, RepoFeatureListResponse, RepoFeaturePromptPart, RepoFeaturePromptSegment, RepoFeatureQuestion, RepoFeatureResponse, RepoSource } from '@vibe-teacher/shared';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';
import { CodeBlock } from './CodeBlock';
import { MiniMarkdown } from './MiniMarkdown';
import { Notice, fmtDate } from './Notice';
import { SourceChips, SourceContext } from './RepoWikiView';

type FileSource = Extract<RepoSource, { kind: 'file' }>;
const at = (s: FileSource) => `${s.path}${s.startLine ? `:${s.startLine}${s.endLine && s.endLine !== s.startLine ? `–${s.endLine}` : ''}` : ''}`;

function FileButton({ source }: { source: FileSource }) {
  const open = useContext(SourceContext);
  return (
    <button type="button" className="repo-source source-link mono" onClick={() => open(source)} title={ko.source.open(source.path)}>
      {at(source)}
    </button>
  );
}

/** 실제로 AI 에 가는 문장. 실행할 때 채워지는 값(slot)은 코드의 식을 그대로 보여 주고 색을 달리한다 */
export function PromptText({ segments }: { segments: RepoFeaturePromptSegment[] }) {
  return (
    <pre className="prompt-text">
      {segments.map((s, i) => (s.kind === 'slot' ? <span key={i} className="prompt-slot" title={ko.feature.slotTitle}>{`{${s.text}}`}</span> : s.text))}
    </pre>
  );
}

function PromptPart({ part, many }: { part: RepoFeaturePromptPart; many: boolean }) {
  const onlyData = part.segments.every((s) => s.kind === 'slot');
  return (
    <div className="prompt-part">
      {(many || part.call) && <div className="small muted">{ko.feature.promptAt(part.line, part.call)}</div>}
      <PromptText segments={part.segments} />
      {onlyData && <p className="small muted">{ko.feature.promptData}</p>}
      {part.via.length > 0 && <p className="small muted">{ko.feature.promptVia(part.via.join(' → '))}</p>}
      {part.from.length > 0 && (
        <div className="small prompt-from">
          <span className="muted">{ko.feature.promptFrom}</span>
          {part.from.map((w) => (
            <FileButton key={`${w.path}:${w.line}`} source={{ kind: 'file', path: w.path, startLine: w.line, endLine: w.line }} />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptBlock({ label, code }: { label: string; code?: RepoFeatureCode }) {
  const parts = code?.prompts ?? [];
  return (
    <div className="feature-prompt">
      <div className="feature-prompt-head">
        <strong>{label}</strong>
        {code && <FileButton source={code.source} />}
      </div>
      {!code && <div className="small muted">{ko.feature.promptMissing}</div>}
      {code && (
        <>
          {parts.length > 1 && <p className="small muted">{ko.feature.promptMany(parts.length)}</p>}
          {parts.map((part, i) => <PromptPart key={i} part={part} many={parts.length > 1} />)}
          {!parts.length && <p className="small muted">{ko.feature.promptDynamic}</p>}
          {/* 프롬프트를 꺼냈으면 전체 코드는 접어 둔다. 꺼내지 못했으면 코드를 바로 보여 준다 */}
          <details className="feature-code" open={!parts.length}>
            <summary>{ko.feature.showCode}</summary>
            <CodeBlock code={code.text} path={code.source.path} {...(code.source.startLine ? { startLine: code.source.startLine } : {})} />
          </details>
        </>
      )}
    </div>
  );
}

function AiCall({ call }: { call: RepoFeatureAiCall }) {
  return (
    <section className="feature-ai">
      <h4>{call.purpose}</h4>
      <dl className="feature-facts">
        <dt>{ko.feature.aiProvider}</dt>
        <dd>{call.provider || '—'}</dd>
        <dt>{ko.feature.aiModel}</dt>
        <dd>
          {call.model && <code>{call.model}</code>}
          <span className={`pill ${call.modelOrigin === 'unknown' ? 'pill-gray' : 'pill-blue'}`}>{ko.feature.modelOrigin[call.modelOrigin]}</span>
          {call.modelSource && <FileButton source={call.modelSource} />}
        </dd>
        <dt>{ko.feature.aiOutput}</dt>
        <dd>{call.outputHandling || '—'}</dd>
      </dl>
      <PromptBlock label={ko.feature.systemPrompt} code={call.systemPrompt} />
      <PromptBlock label={ko.feature.userPrompt} code={call.userPrompt} />
      <SourceChips sources={call.sources} />
    </section>
  );
}

function Questions({ questions }: { questions: RepoFeatureQuestion[] }) {
  const rounds = [...new Set(questions.map((q) => q.round))].sort((a, b) => a - b);
  return (
    <>
      {rounds.map((round) => {
        const list = questions.filter((q) => q.round === round);
        return (
          <details key={round} className="feature-round" open={round === rounds[0]}>
            <summary>
              {ko.feature.round(round)} · {ko.feature.questionCount(list.length)}
            </summary>
            <ul className="repo-list">
              {list.map((q, i) => (
                <li key={i}>
                  <strong>{q.question}</strong>
                  <MiniMarkdown text={q.answer} />
                  <SourceChips sources={q.sources} />
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </>
  );
}

/** 주요 기능 페이지 본문. 자세한 분석 전에는 레포 위키가 고른 기본 정보만 보여 준다 */
export function RepoFeatureView({ data }: { data: RepoFeatureResponse }) {
  const { feature, page } = data;
  if (!page) {
    return (
      <>
        {feature && (
          <section className="card repo-section">
            <h3>{ko.feature.basicFiles}</h3>
            <ul className="repo-list">
              {feature.files.map((f) => (
                <li key={f.path}>
                  <FileButton source={f} />
                </li>
              ))}
            </ul>
            {feature.sessions.length > 0 && (
              <>
                <h4>{ko.feature.basicSessions}</h4>
                <ul className="repo-list">
                  {feature.sessions.map((s) => (
                    <li key={s.key}>
                      <Link to={`/sessions/${encodeURIComponent(s.key)}?tab=understand`}>{s.title}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <SourceChips sources={feature.sources} />
          </section>
        )}
      </>
    );
  }
  return (
    <>
      {page.warnings.map((w) => (
        <Notice key={w} kind="warn">
          {w}
        </Notice>
      ))}
      {page.overview.length > 0 && (
        <section className="card repo-section" id="feature-overview">
          <h3>{ko.feature.sections.overview}</h3>
          {page.overview.map((p, i) => (
            <MiniMarkdown key={i} text={p} />
          ))}
          <SourceChips sources={page.overviewSources} />
        </section>
      )}
      {page.userFlow.length > 0 && (
        <section className="card repo-section" id="feature-flow">
          <h3>{ko.feature.sections.flow}</h3>
          <ol className="feature-steps">
            {page.userFlow.map((step, i) => (
              <li key={i}>
                <strong>{step.title}</strong>
                <MiniMarkdown text={step.detail} />
                <SourceChips sources={step.sources} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {page.files.length > 0 && (
        <section className="card repo-section" id="feature-files">
          <h3>{ko.feature.sections.files}</h3>
          <ul className="repo-list">
            {page.files.map((f) => (
              <li key={f.path}>
                <FileButton source={{ kind: 'file', path: f.path }} />
                <div className="small">{f.role}</div>
                <SourceChips sources={f.sources} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card repo-section" id="feature-ai">
        <h3>{ko.feature.sections.ai}</h3>
        {page.aiCalls.length ? (
          <>
            <p className="small muted">{ko.feature.verbatim}</p>
            {page.aiCalls.map((call, i) => (
              <AiCall key={i} call={call} />
            ))}
          </>
        ) : (
          <p className="small muted">{ko.feature.noAi}</p>
        )}
      </section>
      {page.questions.length > 0 && (
        <section className="card repo-section" id="feature-questions">
          <h3>{ko.feature.sections.questions}</h3>
          <Questions questions={page.questions} />
        </section>
      )}
      {page.limits.length > 0 && (
        <section className="card repo-section" id="feature-limits">
          <h3>{ko.feature.sections.limits}</h3>
          <ul className="repo-list">
            {page.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** 세션 화면: 레포 위키가 이 세션을 근거로 고른 주요 기능 페이지로 잇는다 */
export function SessionFeatureLinks({ projectId, sessionKey }: { projectId: string; sessionKey: string }) {
  const list = useApi<RepoFeatureListResponse>(`/api/projects/${projectId}/repo-wiki/features`);
  const related = list.data?.features.filter((f) => f.sessions.some((s) => s.key === sessionKey)) ?? [];
  if (!related.length) return null;
  return (
    <div className="small feature-links">
      <span className="muted">{ko.feature.sessionLinks}:</span>
      {related.map((f) => (
        <Link key={f.id} className="pill pill-outline" to={`/projects/${projectId}/features/${f.id}`}>
          {f.name}
        </Link>
      ))}
    </div>
  );
}

export function featureMeta(data: RepoFeatureResponse): string | null {
  const page = data.page;
  if (!page) return null;
  const who = [page.generator.provider ? (ko.sources.llmProvider[page.generator.provider] ?? page.generator.provider) : '', page.generator.model ?? ''].filter(Boolean).join(' · ') || 'AI';
  const cost = page.generator.costUsd !== undefined ? ` · ${ko.feature.cost(page.generator.costUsd)}` : '';
  return `${ko.feature.meta(fmtDate(page.at), who, page.generator.calls, page.generator.rounds)}${cost}`;
}
