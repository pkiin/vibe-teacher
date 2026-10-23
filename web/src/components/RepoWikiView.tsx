import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ReaderLevel, RepoBlock, RepoSection, RepoSource, RepoWiki, RepoWikiAiPreview, RepoWikiBuildResponse, RepoWikiResponse } from '@vibe-teacher/shared';
import { api, apiDelete, apiPost } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../hooks/useJob';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';
import { MiniMarkdown } from './MiniMarkdown';
import { ErrorBox, Loading, Notice, fmtDate } from './Notice';
import { ReaderLevelLine, ReaderLevelOptions } from './ReaderLevelPicker';
import { ReadingGuide } from './ReadingGuide';
import { Tabs } from './Tabs';
import { RepoFlowView } from './RepoFlowView';
import { RepoSourceViewer } from './RepoSourceViewer';

type FileSource = Extract<RepoSource, { kind: 'file' }>;
const SourceContext = createContext<(source: FileSource) => void>(() => {});

function SourceChips({ sources }: { sources?: RepoSource[] }) {
  const open = useContext(SourceContext);
  if (!sources?.length) return null;
  return (
    <details className="repo-evidence">
      <summary>{ko.reading.evidence(sources.length)}</summary>
      <span className="repo-sources">
        {sources.map((s, i) =>
          s.kind === 'file' ? (
            <button key={i} type="button" className="repo-source source-link mono" onClick={() => open(s)} title={ko.source.open(s.path)}>
              {s.path}{s.startLine ? `:${s.startLine}${s.endLine && s.endLine !== s.startLine ? `–${s.endLine}` : ''}` : ''}
            </button>
          ) : (
            <Link key={i} className="pill pill-outline repo-source" to={`/sessions/${encodeURIComponent(s.key)}?tab=understand`}>
              {ko.repo.session}: {s.title.length > 30 ? `${s.title.slice(0, 30)}…` : s.title}
            </Link>
          ),
        )}
      </span>
    </details>
  );
}

function Block({ b }: { b: RepoBlock }) {
  const open = useContext(SourceContext);
  if (b.kind === 'flow') return <RepoFlowView graph={b.graph} onOpen={open} />;
  if (b.kind === 'text') return <MiniMarkdown text={b.text} />;
  if (b.kind === 'code') return <pre className="repo-code">{b.text}</pre>;
  if (b.kind === 'table') {
    return (
      <div className="repo-table-wrap">
        <table className="table repo-table">
          <thead>
            <tr>
              {b.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={j === 0 ? 'mono' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ul className="repo-list">
      {b.items.map((it, i) => (
        <li key={i}>
          <MiniMarkdown text={it.text} />
          {it.detail && <div className="small muted">{it.detail}</div>}
          <SourceChips sources={it.sources} />
        </li>
      ))}
    </ul>
  );
}

function Section({ s, mixed }: { s: RepoSection; mixed: boolean }) {
  return (
    <section className="card repo-section" id={`repo-${s.id}`}>
      <h3>
        {s.title}
        {mixed && s.origin === 'rule' && <span className="pill pill-outline small repo-origin">{ko.repo.ruleSection}</span>}
      </h3>
      {s.blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
      <SourceChips sources={s.sources} />
      {s.note && <div className="small muted repo-note">{s.note}</div>}
    </section>
  );
}

function generatorLine(g: RepoWiki['generator']): { kind: 'info' | 'warn'; text: string } {
  if (g.kind === 'llm') {
    const who = [g.provider ? (ko.sources.llmProvider[g.provider] ?? g.provider) : '', g.model ?? ''].filter(Boolean).join(' · ');
    return { kind: 'info', text: ko.repo.byAi(who || 'AI') };
  }
  return { kind: 'warn', text: ko.repo.byRule(g.reason) };
}

function AiPreview({ projectId }: { projectId: string }) {
  const [preview, setPreview] = useState<RepoWikiAiPreview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const load = () => {
    if (preview) return;
    api<RepoWikiAiPreview>(`/api/projects/${projectId}/repo-wiki/ai/preview`)
      .then(setPreview)
      .catch((e: Error) => setError(e));
  };
  return (
    <details className="evidence" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>{ko.repo.preview}</summary>
      {!preview && !error && <Loading />}
      {error && <ErrorBox error={error} />}
      {preview?.fallbackReason && <Notice kind="warn">{ko.repo.previewFallback(preview.fallbackReason)}</Notice>}
      {preview && (
        <>
          <div className="small muted">{ko.repo.previewChars(preview.chars)}</div>
          <pre className="wiki-ai-preview">{preview.user}</pre>
        </>
      )}
    </details>
  );
}

/** 프로젝트(저장소) 단위 위키: 사용자 중심 / 기능·동작 중심 */
export function RepoWikiView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<RepoWikiResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<FileSource | null>(null);
  const [view, setView] = useState<'user' | 'system' | 'security'>('user');
  const [jobId, setJobId] = useState<string | null>(null);
  const jobPath = jobId ? `/api/projects/${projectId}/repo-wiki/jobs/${jobId}` : null;
  const { job, error: jobError } = useJob<unknown>(jobPath);
  const { me } = useAuth();
  const reader = useReader();
  const [pick, setPick] = useState<ReaderLevel>(reader.level);

  // 문장은 읽는 사람 수준별로 저장된다. 수준이 바뀌면 그 수준의 문장을 다시 받는다
  const load = useCallback(() => {
    api<RepoWikiResponse>(`/api/projects/${projectId}/repo-wiki`)
      .then(setData)
      .catch((e: Error) => setError(e));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load, reader.level]);
  useEffect(() => {
    if (!job || job.state === 'queued' || job.state === 'running') return;
    if (job.state === 'error') setError(new Error(job.error?.message ?? '레포 위키를 만들지 못했습니다'));
    setJobId(null);
    load();
  }, [job, load]);
  useEffect(() => {
    if (jobError) {
      setError(jobError);
      setJobId(null);
    }
  }, [jobError]);

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<RepoWikiBuildResponse>(path, body);
      if (res.status === 'done') setData(res.response);
      else setJobId(res.jobId);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  // 처음 만들 때 수준을 아직 안 골랐으면, 고른 수준을 저장한 뒤 만든다
  const build = async () => {
    if (!reader.chosen) await reader.setLevel(pick).catch(() => {});
    await post(`/api/projects/${projectId}/repo-wiki/build`, {});
  };
  const rewrite = () => post(`/api/projects/${projectId}/repo-wiki/text`, { force: true });

  // 이 수준의 AI 문장이 아직 없으면 자동으로 쓴다 (수준을 고른 뒤에만, 판·수준마다 한 번)
  const autoTried = useRef<string | null>(null);
  useEffect(() => {
    const w = data?.wiki;
    if (!w || !data?.text?.canGenerate || !reader.chosen || jobId || busy) return;
    const key = `${w.revision}|${data.text.level}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    void post(`/api/projects/${projectId}/repo-wiki/text`, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, reader.chosen, jobId, busy]);
  const cancel = () => {
    if (jobId) void apiDelete(`/api/projects/${projectId}/repo-wiki/jobs/${jobId}`).catch(() => {});
  };

  if (!data && !error) return <Loading />;
  const wiki = data?.wiki;
  const working = busy || !!jobId;
  const button = (
    <button className="btn btn-primary btn-small" disabled={working} onClick={build}>
      {working ? ko.repo.building : wiki ? ko.repo.update : ko.repo.build}
    </button>
  );
  const progress = jobId && (
    <Notice kind="info">
      <span>{ko.repo.writing}</span>
      <button className="btn btn-small" onClick={cancel}>
        {ko.repo.cancel}
      </button>
    </Notice>
  );
  if (!wiki) {
    return (
      <div className="card">
        <p className="small">{ko.repo.intro}</p>
        <p className="small muted">{ko.repo.readOnly}</p>
        {reader.available && !reader.chosen && (
          <>
            <strong>{ko.repo.chooseLevel}</strong>
            <ReaderLevelOptions value={pick} onChange={setPick} disabled={working} />
          </>
        )}
        {reader.available && reader.chosen && <ReaderLevelLine />}
        <Notice kind="info">
          <span>{ko.repo.notBuilt}</span>
          <button className="btn btn-primary btn-small" disabled={working} onClick={build}>
            {working ? ko.repo.building : reader.available && !reader.chosen ? ko.repo.buildAt(ko.reader.levels[pick]!.label) : ko.repo.build}
          </button>
        </Notice>
        {progress}
        {error && <ErrorBox error={error} />}
        <AiPreview key={reader.level} projectId={projectId} />
      </div>
    );
  }
  const canAi = !!me?.canEnrich && !!me?.llmStatus?.available;
  const sections = view === 'system' ? wiki.system : wiki.user.filter((s) => view === 'security' ? s.id === 'security' : s.id !== 'security');
  const gen = generatorLine(wiki.generator);
  const git = ko.repo.git(wiki.inputs.repo.branch, wiki.inputs.repo.head);

  return (
    <SourceContext.Provider value={setSource}><div className="repo-wiki">
      <ReadingGuide />
      <div className="card">
        <div className="concept-head">
          <span className="small muted grow">
            {ko.repo.meta(fmtDate(wiki.builtAt), wiki.inputs.sessions.length, wiki.inputs.repo.fileCount)}
            {git ? ` · ${git}` : ''}
          </span>
          {button}
        </div>
        <p className="small">{ko.repo.intro}</p>
        {reader.available && <ReaderLevelLine />}
        <Notice kind={gen.kind}>
          <span>{gen.text}</span>
          {canAi && !jobId && (
            <button className="btn btn-small" disabled={working} onClick={() => void rewrite()}>
              {wiki.generator.kind === 'llm' ? ko.repo.rewrite : ko.repo.rewriteWithAi}
            </button>
          )}
        </Notice>
        {progress}
        {data?.stale && <Notice kind="warn">{ko.repo.stale(data.staleReasons.join(', '))}</Notice>}
        {wiki.warnings.map((w) => (
          <Notice key={w} kind="warn">
            {w}
          </Notice>
        ))}
        {error && <ErrorBox error={error} />}
        <details className="evidence" open={wiki.changes[0] !== '처음 만들었습니다.'}>
          <summary>{ko.repo.changes}</summary>
          <ul>
            {wiki.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
        <AiPreview key={reader.level} projectId={projectId} />
      </div>

      <Tabs tabs={(['user', 'system', 'security'] as const).map((id) => ({ id, label: ko.repo.views[id]! }))} active={view} onChange={(id) => setView(id as typeof view)} />
      <p className="small muted">{ko.repo.viewNote[view]}</p>
      {view === 'security' && !sections.length && <Notice kind="warn">{ko.security.oldRepo}</Notice>}
      <nav className="repo-toc small" aria-label={ko.repo.contents}>
        {sections.map((s) => (
          <a key={s.id} href={`#repo-${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      {sections.map((s) => (
        <Section key={s.id} s={s} mixed={wiki.generator.kind === 'llm'} />
      ))}

      {data && data.history.length > 0 && (
        <details className="card repo-history">
          <summary>{ko.repo.history(data.history.length)}</summary>
          <ul className="small">
            {data.history.map((h) => (
              <li key={h.revision}>
                <strong>{fmtDate(h.builtAt)}</strong> <span className="muted">({h.revision})</span>
                <ul>
                  {h.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      <RepoSourceViewer projectId={projectId} source={source} onClose={() => setSource(null)} />
    </div></SourceContext.Provider>
  );
}
