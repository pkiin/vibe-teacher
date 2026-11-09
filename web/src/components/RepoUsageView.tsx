import { useCallback, useEffect, useState } from 'react';
import type { ReaderLevel, RepoUsageAnalyzeResponse, RepoUsageJobStatus, RepoUsagePage, RepoUsagePreview, RepoUsageResponse } from '@vibe-teacher/shared';
import { api, apiDelete, apiPost } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../hooks/useJob';
import { useReader } from '../hooks/useReader';
import { useTechnicalDetails } from '../hooks/useTechnicalDetails';
import { ko } from '../i18n/ko';
import { GuideView } from './GuideView';
import { JobProgress } from './JobProgress';
import { MiniMarkdown } from './MiniMarkdown';
import { ErrorBox, Loading, Notice, fmtDate } from './Notice';
import { ReaderLevelLine, ReaderLevelOptions } from './ReaderLevelPicker';
import { Questions } from './RepoFeatureView';
import { SourceChips } from './RepoWikiView';

function UsagePreview({ base }: { base: string }) {
  const [preview, setPreview] = useState<RepoUsagePreview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const load = () => {
    if (preview) return;
    api<RepoUsagePreview>(`${base}/preview`).then(setPreview).catch((e: Error) => setError(e));
  };
  return (
    <details className="evidence" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>{ko.usage.preview}</summary>
      {!preview && !error && <Loading />}
      {error && <ErrorBox error={error} />}
      {preview?.fallbackReason && <Notice kind="warn">{ko.feature.previewFallback(preview.fallbackReason)}</Notice>}
      {preview && (
        <>
          <p className="small muted">{ko.feature.previewNote(preview.limits.rounds, preview.limits.questionsPerRound, preview.limits.maxChars)}</p>
          <div className="small muted">{ko.repo.previewChars(preview.chars)}</div>
          <strong className="small">{ko.feature.systemPrompt}</strong>
          <pre className="wiki-ai-preview">{preview.system}</pre>
          <strong className="small">{ko.feature.userPrompt}</strong>
          <pre className="wiki-ai-preview">{preview.user}</pre>
        </>
      )}
    </details>
  );
}

function usageMeta(page: RepoUsagePage, technical: boolean): string {
  if (!technical) return ko.usage.analyzedAt(fmtDate(page.at));
  const g = page.generator;
  const who = [g.provider ? (ko.sources.llmProvider[g.provider] ?? g.provider) : '', g.model ?? ''].filter(Boolean).join(' · ') || 'AI';
  return `${ko.feature.meta(fmtDate(page.at), who, g.calls, g.rounds)}${g.costUsd !== undefined ? ` · ${ko.feature.cost(g.costUsd)}` : ''}`;
}

/** 레포 위키 '어떻게 사용하나요?': 분석하기를 누르면 AI 가 저장소의 화면 코드를 읽고 사용 방법을 쓴다 (GET 은 AI 를 부르지 않음) */
export function RepoUsageView({ projectId }: { projectId: string }) {
  const base = `/api/projects/${projectId}/repo-wiki/usage`;
  const [data, setData] = useState<RepoUsageResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, error: jobError } = useJob<RepoUsageJobStatus['result']>(jobId ? `/api/projects/${projectId}/repo-wiki/usage-jobs/${jobId}` : null);
  const { me } = useAuth();
  const reader = useReader();
  const technical = useTechnicalDetails();
  const [pick, setPick] = useState<ReaderLevel>(reader.level);

  const load = useCallback(() => {
    api<RepoUsageResponse>(base)
      .then((res) => {
        setData(res);
        if (res.jobId) setJobId(res.jobId);
      })
      .catch((e: Error) => setError(e));
  }, [base]);
  useEffect(() => {
    load();
  }, [load, reader.level]);
  useEffect(() => {
    if (!job || job.state === 'queued' || job.state === 'running') return;
    if (job.state === 'error') setError(new Error(job.error?.message ?? '사용 방법을 분석하지 못했습니다'));
    setJobId(null);
    load();
  }, [job, load]);
  useEffect(() => {
    if (jobError) {
      setError(jobError);
      setJobId(null);
    }
  }, [jobError]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!reader.chosen) await reader.setLevel(pick).catch(() => {});
      const res = await apiPost<RepoUsageAnalyzeResponse>(`${base}/analyze`, {});
      setJobId(res.jobId);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (jobId) void apiDelete(`/api/projects/${projectId}/repo-wiki/usage-jobs/${jobId}`).catch(() => {});
  };

  if (!data && !error) return <Loading />;
  const page = data?.page ?? null;
  const working = busy || !!jobId;
  const canAi = !!me?.canEnrich && !data?.unavailable;

  return (
    <div className="repo-usage">
      <div className="card">
        <p className="small">{ko.usage.intro}</p>
        <Notice kind="info">{page ? usageMeta(page, technical) : ko.usage.notAnalyzed}</Notice>
        {data?.stale && <Notice kind="warn">{ko.usage.stale(data.staleReasons.join(', '))}</Notice>}
        {data?.unavailable && <Notice kind="warn">{ko.usage.unavailable(data.unavailable)}</Notice>}
        {!page && data && <p className="small">{ko.usage.howItWorks(data.limits.rounds)}</p>}
        {reader.available && !reader.chosen && (
          <>
            <strong>{ko.usage.chooseLevel}</strong>
            <ReaderLevelOptions value={pick} onChange={setPick} disabled={working} />
          </>
        )}
        {reader.available && reader.chosen && <ReaderLevelLine />}
        {canAi && (
          <div className="feature-actions">
            <button className="btn btn-primary btn-small" disabled={working} onClick={() => void analyze()}>
              {working ? ko.repo.building : page ? ko.usage.reanalyze : reader.available && !reader.chosen ? ko.usage.analyzeAt(ko.reader.levels[pick]!.label) : ko.usage.analyze}
            </button>
          </div>
        )}
        <JobProgress job={job} busy={working} preparing={busy} label={ko.usage.analyzing}>
          {jobId && <button className="btn btn-small" onClick={cancel}>{ko.usage.cancel}</button>}
        </JobProgress>
        {error && <ErrorBox error={error} />}
        {page?.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
        {!data?.unavailable && <UsagePreview key={reader.level} base={base} />}
      </div>

      {page && (
        <>
          {page.intro.length > 0 && (
            <section className="card repo-section">
              {page.intro.map((p) => <MiniMarkdown key={p} text={p} />)}
              <SourceChips sources={page.introSources} />
            </section>
          )}
          <GuideView idPrefix="usage" steps={page.steps} sections={page.sections} faq={page.faq} placeholder={ko.usage.searchPlaceholder} sources={(s) => <SourceChips sources={s} />} />
          {(page.questions.length > 0 || page.limits.length > 0) && (
            <details className="card repo-section">
              <summary>{ko.usage.checked}</summary>
              <Questions questions={page.questions} />
              {page.limits.length > 0 && (
                <>
                  <h3>{ko.usage.limits}</h3>
                  <ul className="repo-list">{page.limits.map((l) => <li key={l}>{l}</li>)}</ul>
                </>
              )}
            </details>
          )}
        </>
      )}
    </div>
  );
}
