import { useEffect, useState } from 'react';
import type { WikiAiJobResult, WikiAiPreview, WikiAiStartResponse, WikiResponse } from '@vibe-teacher/shared';
import { apiDelete, apiPost, api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../hooks/useJob';
import { ko } from '../i18n/ko';
import { LlmQuickSwitch } from './LlmProviderPicker';
import { ErrorBox, Notice } from './Notice';

/** 위키 AI 보강 실행·상태·결과 요약. 보내기 전에 전송 내용을 미리 볼 수 있다. */
export function WikiAiPanel({ sessionKey, wiki, onUpdated }: { sessionKey: string; wiki: WikiResponse; onUpdated: () => void }) {
  const enc = encodeURIComponent(sessionKey);
  const { me } = useAuth();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<WikiAiPreview | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const { job } = useJob<WikiAiJobResult>(jobId ? `/api/sessions/${enc}/wiki/ai/jobs/${jobId}` : null);

  useEffect(() => {
    if (job?.state === 'done') {
      setJobId(null);
      onUpdated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.state]);

  const busy = starting || job?.state === 'queued' || job?.state === 'running';
  const available = !!me?.canEnrich && !!me?.llmStatus?.available;
  const reason = !me?.canEnrich ? me?.enrichReason : me?.llmStatus?.reason;
  const ai = wiki.ai;

  const start = async (force: boolean) => {
    setStarting(true);
    setError(null);
    try {
      const res = await apiPost<WikiAiStartResponse>(`/api/sessions/${enc}/wiki/ai`, { force });
      if (res.status === 'done') onUpdated();
      else setJobId(res.jobId);
    } catch (e) {
      setError(e as Error);
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!jobId) return;
    await apiDelete(`/api/sessions/${enc}/wiki/ai/jobs/${jobId}`).catch(() => {});
  };
  const loadPreview = () => {
    if (preview) return;
    api<WikiAiPreview>(`/api/sessions/${enc}/wiki/ai/preview`)
      .then(setPreview)
      .catch((e: Error) => setPreviewError(e));
  };

  return (
    <section className="card wiki-ai">
      <div className="concept-head">
        <strong className="grow">{ko.wikiAi.title}</strong>
        {!busy && (
          <button className="btn btn-primary btn-small" disabled={!available || wiki.stale} onClick={() => start(!!ai)} title={available ? '' : reason}>
            {ai ? ko.wikiAi.rerun : ko.wikiAi.run}
          </button>
        )}
        {busy && (
          <button className="btn btn-small" onClick={cancel}>
            {ko.wikiAi.cancel}
          </button>
        )}
      </div>
      <p className="small">{ko.wikiAi.intro}</p>
      {me?.isAdmin && !busy && <LlmQuickSwitch />}
      {wiki.stale && <Notice kind="warn">{ko.wikiAi.stale}</Notice>}
      {!available && (
        <Notice kind="warn">
          {ko.wikiAi.unavailable}: {reason ?? '…'}
        </Notice>
      )}
      {available && !busy && <div className="small muted">{ko.wikiAi.notice}</div>}
      {available && !wiki.stale && (
        <details className="evidence" onToggle={(e) => (e.target as HTMLDetailsElement).open && loadPreview()}>
          <summary>
            {ko.wikiAi.preview}
            {preview ? ` (${ko.wikiAi.previewChars(preview.chars)})` : ''}
          </summary>
          {previewError && <ErrorBox error={previewError} />}
          {preview && <pre className="wiki-ai-preview">{preview.user}</pre>}
        </details>
      )}
      {busy && <Notice kind="info">{job?.state === 'running' ? ko.wikiAi.running : ko.wikiAi.queued}</Notice>}
      {job?.state === 'error' && (
        <Notice kind="error">
          {ko.wikiAi.error}: {job.error?.message}
        </Notice>
      )}
      {error && <ErrorBox error={error} />}
      {ai && (
        <div className="small wiki-ai-result">
          <div className="muted">{ko.wikiAi.meta(ai.provider, ai.model, Math.round(ai.durationMs / 1000), ai.costUsd)}</div>
          <div>{ko.wikiAi.counts(ai.narratives.length, ai.claims.length, ai.items.length)}</div>
          {ai.rejected.length > 0 && (
            <details className="evidence">
              <summary>{ko.wikiAi.rejected(ai.rejected.length)}</summary>
              <ul>
                {ai.rejected.map((r, i) => (
                  <li key={i}>
                    <code>{r.kind}</code> {r.ref} — {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {ai.proposedConcepts.length > 0 && (
            <div>
              <strong>{ko.wikiAi.proposed}</strong>
              <ul>
                {ai.proposedConcepts.map((p) => (
                  <li key={p.name}>
                    {p.name} — <span className="muted">{p.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
