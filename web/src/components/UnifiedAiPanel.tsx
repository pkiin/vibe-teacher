import { useEffect, useRef, useState } from 'react';
import type { EnrichmentRecord, WikiAiJobResult, WikiAiPreview, WikiResponse } from '@vibe-teacher/shared';
import { api, apiDelete } from '../api/client';
import { startSessionAnalysis } from '../api/session-analysis';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../hooks/useJob';
import { useReader } from '../hooks/useReader';
import { useTechnicalDetails } from '../hooks/useTechnicalDetails';
import { ko } from '../i18n/ko';
import { LlmQuickSwitch } from './LlmProviderPicker';
import { Notice } from './Notice';
import { ReaderLevelLine } from './ReaderLevelPicker';
import { JobProgress } from './JobProgress';

interface Preview {
  session?: { chars: number; user: string };
  wiki?: WikiAiPreview;
  error?: string;
}

/**
 * 대화 분석 한 번으로 작업 요약·개념·주의사항 문서를 만든다.
 * 기반 snapshot이 없거나 오래되었으면 먼저 갱신한다. 같은 입력은 저장된 결과를 사용한다.
 */
export function UnifiedAiPanel({
  sessionKey,
  wiki,
  enrichment,
  onEnrichment,
  onWikiUpdated,
  onWikiWriting,
}: {
  sessionKey: string;
  wiki: WikiResponse | null;
  enrichment: EnrichmentRecord | null;
  onEnrichment: (r: EnrichmentRecord) => void;
  onWikiUpdated: (wiki?: WikiResponse) => void;
  /** 위키 항목 설명을 쓰는 중인지 (항목 카드가 "쓰는 중"을 보여 준다) */
  onWikiWriting?: (writing: boolean) => void;
}) {
  const enc = encodeURIComponent(sessionKey);
  const { me } = useAuth();
  const reader = useReader();
  const technical = useTechnicalDetails();
  const [enrichJobId, setEnrichJobId] = useState<string | null>(null);
  const [wikiJobId, setWikiJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { job: enrichJob, error: enrichJobError } = useJob<EnrichmentRecord>(enrichJobId ? `/api/jobs/${enrichJobId}` : null);
  const { job: wikiJob, error: wikiJobError } = useJob<WikiAiJobResult>(wikiJobId ? `/api/sessions/${enc}/wiki/ai/jobs/${wikiJobId}` : null);
  const wikiReady = !!wiki && !wiki.stale;
  useEffect(() => {
    if (wiki?.generation?.jobId) setWikiJobId(wiki.generation.jobId);
  }, [wiki?.generation?.jobId]);
  useEffect(() => {
    if (!enrichJobError) return;
    setErrors((errors) => [...errors, enrichJobError.message]);
    setEnrichJobId(null);
  }, [enrichJobError]);
  useEffect(() => {
    if (!wikiJobError) return;
    setErrors((errors) => [...errors, wikiJobError.message]);
    setWikiJobId(null);
  }, [wikiJobError]);

  useEffect(() => {
    if (enrichJob?.state === 'done' && enrichJob.result) onEnrichment(enrichJob.result);
    if (enrichJob?.state === 'error') setErrors((e) => [...e, ko.aiUnified.error(ko.aiUnified.partSession, enrichJob.error?.message ?? '')]);
    if (enrichJob && enrichJob.state !== 'queued' && enrichJob.state !== 'running') setEnrichJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichJob?.state]);
  useEffect(() => {
    if (wikiJob?.state === 'done') onWikiUpdated();
    if (wikiJob?.state === 'error') setErrors((e) => [...e, ko.aiUnified.error(ko.aiUnified.partWiki, wikiJob.error?.message ?? '')]);
    if (wikiJob && wikiJob.state !== 'queued' && wikiJob.state !== 'running') setWikiJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiJob?.state]);

  const available = !!me?.canEnrich && !!me?.llmStatus?.available;
  const reason = !me?.canEnrich ? me?.enrichReason : me?.llmStatus?.reason;
  const running = [enrichJobId ? ko.aiUnified.partSession : null, wikiJobId ? ko.aiUnified.partWiki : null].filter(Boolean).join(' · ');
  const busy = starting || !!running;
  const hasResult = !!enrichment || !!wiki?.ai;
  const autoTried = useRef<string | null>(null);

  const start = async (force: boolean) => {
    setStarting(true);
    setErrors([]);
    if (wikiReady && wiki) autoTried.current = `${sessionKey}|${wiki.snapshot.revision}|${reader.level}`;
    const errs = await startSessionAnalysis(sessionKey, {
      wikiReady, force, onEnrichment, onEnrichJob: setEnrichJobId, onWikiJob: setWikiJobId,
      onWiki: (result) => {
        if (result) autoTried.current = `${sessionKey}|${result.snapshot.revision}|${reader.level}`;
        onWikiUpdated(result);
      },
    });
    setErrors(errs.map((e) => ko.aiUnified.error(e.part === 'summary' ? ko.aiUnified.partSession : ko.aiUnified.partWiki, e.message)));
    setStarting(false);
  };
  // 위키가 있고 AI 결과가 없으면 자동으로 쓴다. 같은 판(revision)에는 한 번만 시도하고, 결과가 저장돼 있으면 서버가 바로 돌려준다
  // 읽는 사람 수준을 고르기 전에는 시작하지 않는다 (상단에서 먼저 묻는다). 수준이 바뀌면 그 수준으로 다시 시도
  const autoKey = wikiReady && wiki ? `${sessionKey}|${wiki.snapshot.revision}|${reader.level}` : null;
  const needsAi = wikiReady && (!enrichment || !wiki?.ai);
  useEffect(() => {
    if (!available || !me?.autoText || !reader.chosen || busy || !autoKey || !needsAi || autoTried.current === autoKey) return;
    autoTried.current = autoKey;
    void start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, me?.autoText, reader.chosen, busy, autoKey, needsAi]);
  const wikiWriting = !!wikiJobId || (starting && wikiReady);
  useEffect(() => {
    onWikiWriting?.(wikiWriting);
  }, [wikiWriting, onWikiWriting]);

  const cancel = () => {
    if (enrichJobId) void apiDelete(`/api/jobs/${enrichJobId}`).catch(() => {});
    if (wikiJobId) void apiDelete(`/api/sessions/${enc}/wiki/ai/jobs/${wikiJobId}`).catch(() => {});
  };
  const loadPreview = async () => {
    if (preview) return;
    try {
      const [session, wikiPreview] = await Promise.all([
        api<{ chars: number; user: string }>(`/api/sessions/${enc}/enrich/preview`),
        api<WikiAiPreview>(`/api/sessions/${enc}/wiki/ai/preview`),
      ]);
      setPreview({ session, ...(wikiPreview ? { wiki: wikiPreview } : {}) });
    } catch (e) {
      setPreview({ error: (e as Error).message });
    }
  };
  const ai = wiki?.ai;

  return (
    <section className="card wiki-ai">
      <div className="concept-head">
        <strong className="grow">{ko.aiUnified.title}</strong>
        {!busy ? (
          <button className="btn btn-primary btn-small" disabled={!available} onClick={() => start(hasResult)} title={available ? '' : reason}>
            {hasResult ? ko.aiUnified.rerun : ko.aiUnified.run}
          </button>
        ) : (
          <button className="btn btn-small" onClick={cancel}>
            {ko.aiUnified.cancel}
          </button>
        )}
      </div>
      <p className="small">{ko.aiUnified.intro}</p>
      {reader.available && <ReaderLevelLine />}
      {technical && !busy && ((me?.isAdmin || me?.canManageInstallation) ? <LlmQuickSwitch /> : me?.llmStatus && <p className="small muted">{ko.sources.llmCurrent}: <strong>{me.llmStatus.resolvedProvider === 'none' ? ko.sources.llmChoice.none.label : ko.sources.llmChoice[me.llmStatus.resolvedProvider].label}</strong></p>)}
      {!available && <Notice kind="warn">{ko.aiUnified.ruleFallback(reason ?? '…')}</Notice>}
      {available && me && !me.autoText && !hasResult && <div className="small muted">{ko.aiUnified.autoOff}</div>}
      {available && wiki?.stale && <div className="small muted">{ko.aiUnified.wikiStale}</div>}
      {technical && available && !busy && <div className="small muted">{ko.aiUnified.notice}</div>}
      {technical && available && (
        <details className="evidence" onToggle={(e) => (e.target as HTMLDetailsElement).open && void loadPreview()}>
          <summary>{ko.aiUnified.preview}</summary>
          {preview?.error && <div className="llm-choice-reason">{preview.error}</div>}
          {preview?.session && (
            <>
              <h4>
                {ko.aiUnified.previewSession} ({ko.wikiAi.previewChars(preview.session.chars)})
              </h4>
              <pre className="wiki-ai-preview">{preview.session.user}</pre>
            </>
          )}
          {preview?.wiki && (
            <>
              <h4>
                {ko.aiUnified.previewWiki} ({ko.wikiAi.previewChars(preview.wiki.chars)})
              </h4>
              <pre className="wiki-ai-preview">{preview.wiki.user}</pre>
            </>
          )}
        </details>
      )}
      <JobProgress jobs={[enrichJob, wikiJob]} busy={busy} preparing={starting} />
      {errors.map((e) => (
        <Notice key={e} kind="error">
          {e}
        </Notice>
      ))}
      {hasResult && !busy && <p className="small muted">{ko.analysis.saved}</p>}
      {technical && (enrichment || ai) && (
        <div className="small wiki-ai-result">
          {enrichment && (
            <div className="muted">
              {ko.aiUnified.partSession}: {enrichment.provider}
              {enrichment.model ? ` · ${enrichment.model}` : ''} · {Math.round(enrichment.durationMs / 1000)}초{enrichment.costUsd != null ? ` · $${enrichment.costUsd.toFixed(3)}` : ''}
            </div>
          )}
          {ai && (
            <>
              <div className="muted">
                {ko.aiUnified.partWiki}: {ko.wikiAi.meta(ai.provider, ai.model, Math.round(ai.durationMs / 1000), ai.costUsd)}
              </div>
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
            </>
          )}
        </div>
      )}
    </section>
  );
}
