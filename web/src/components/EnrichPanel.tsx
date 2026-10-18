import { useEffect, useState, type ReactNode } from 'react';
import type { EnrichStartResponse, EnrichmentRecord, LlmStatus } from '@vibe-teacher/shared';
import { apiDelete, apiPost } from '../api/client';
import { useJob } from '../hooks/useJob';
import { ko } from '../i18n/ko';
import { LlmQuickSwitch } from './LlmProviderPicker';
import { Notice } from './Notice';

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 최소 마크다운 렌더러: 제목, 글머리표, 번호 목록, 문단, 인라인 코드/굵게 */
export function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let k = 0;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{renderInline(para.join(' '))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>);
    blocks.push(list.ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(<h4 key={k++}>{renderInline(h[2] ?? '')}</h4>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul?.[1] ?? ol?.[1]) ?? '');
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="markdown">{blocks}</div>;
}

export function EnrichPanel({
  sessionKey,
  llmStatus,
  canEnrich = true,
  enrichReason,
  cached,
  onResult,
  isAdmin = false,
}: {
  sessionKey: string;
  llmStatus: LlmStatus | null;
  canEnrich?: boolean;
  enrichReason?: string;
  isAdmin?: boolean;
  cached: EnrichmentRecord | null;
  onResult: (r: EnrichmentRecord) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { job } = useJob(jobId ? `/api/jobs/${jobId}` : null);
  const result = job?.state === 'done' && job.result ? job.result : cached;

  useEffect(() => {
    if (job?.state === 'done' && job.result) onResult(job.result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.state]);

  const start = async (force: boolean) => {
    setStarting(true);
    setError(null);
    try {
      const res = await apiPost<EnrichStartResponse>(`/api/sessions/${encodeURIComponent(sessionKey)}/enrich${force ? '?force=1' : ''}`);
      if (res.status === 'done') onResult(res.result);
      else setJobId(res.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!jobId) return;
    try {
      await apiDelete(`/api/jobs/${jobId}`);
    } catch {
      // ignore
    }
  };

  const busy = starting || job?.state === 'queued' || job?.state === 'running';
  const available = !!llmStatus?.available && canEnrich;
  const unavailableReason = !canEnrich ? enrichReason : llmStatus?.reason;

  return (
    <section className="enrich">
      <div className="enrich-head">
        <h3>{ko.enrich.title}</h3>
        <div className="enrich-actions">
          {!busy && (
            <button className="btn btn-primary" disabled={!available} onClick={() => start(!!result)} title={available ? '' : unavailableReason}>
              {result ? ko.enrich.rerun : ko.enrich.button}
            </button>
          )}
          {busy && (
            <button className="btn" onClick={cancel}>
              {ko.enrich.cancel}
            </button>
          )}
        </div>
      </div>
      {isAdmin && !busy && <LlmQuickSwitch />}
      {!available && !result && (
        <Notice kind="warn">
          {ko.enrich.unavailable}: {unavailableReason ?? '…'}
        </Notice>
      )}
      {available && !result && !busy && <Notice kind="info">{ko.enrich.notice}</Notice>}
      {busy && <Notice kind="info">{job?.state === 'running' ? ko.enrich.running : ko.enrich.queued}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {job?.state === 'error' && (
        <Notice kind="error">
          {ko.enrich.error}: {job.error?.message}
          {job.error?.detail && <pre className="small">{job.error.detail}</pre>}
        </Notice>
      )}
      {result && (
        <div className="enrich-result">
          <div className="muted small">
            {ko.enrich.cached} · {result.provider}
            {result.model ? ` · ${result.model}` : ''} · {ko.enrich.duration} {Math.round(result.durationMs / 1000)}초
            {result.costUsd != null ? ` · ${ko.enrich.cost} $${result.costUsd.toFixed(3)}` : ''} · {new Date(result.createdAt).toLocaleString('ko-KR')}
          </div>
          <h4 className="enrich-title">{result.data.summary.title}</h4>
          <p className="enrich-oneliner">{result.data.summary.oneLiner}</p>
          <span className={`pill ${result.data.summary.outcome === 'completed' ? 'pill-green' : result.data.summary.outcome === 'partial' ? 'pill-yellow' : 'pill-gray'}`}>
            {ko.enrich.outcome[result.data.summary.outcome]}
          </span>
          <MiniMarkdown text={result.data.summary.narrative} />
          {result.data.summary.features.length > 0 && (
            <div>
              <h4>{ko.enrich.features}</h4>
              <ul className="features">
                {result.data.summary.features.map((f, i) => (
                  <li key={i}>
                    <strong>{f.name}</strong> — {f.detail}
                    {f.evidence.length > 0 && (
                      <div className="chips">
                        {f.evidence.map((e, j) => (
                          <span key={j} className="chip mono">
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.data.summary.nextSteps.length > 0 && (
            <div>
              <h4>{ko.enrich.nextSteps}</h4>
              <ul>
                {result.data.summary.nextSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
