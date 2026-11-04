import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Account, Project, ReaderLevel, RepoFeatureAnalyzeResponse, RepoFeatureJobStatus, RepoFeaturePreview, RepoFeatureResponse, RepoSource } from '@vibe-teacher/shared';
import { api, apiDelete, apiPost } from '../api/client';
import { Breadcrumb } from '../components/Layout';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { ErrorBox, Loading, Notice } from '../components/Notice';
import { ReaderLevelLine, ReaderLevelOptions } from '../components/ReaderLevelPicker';
import { RepoFeatureView, featureMeta } from '../components/RepoFeatureView';
import { RepoSourceViewer } from '../components/RepoSourceViewer';
import { SourceContext } from '../components/RepoWikiView';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useJob } from '../hooks/useJob';
import { JobProgress } from '../components/JobProgress';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';

type FileSource = Extract<RepoSource, { kind: 'file' }>;

function FeaturePreview({ base }: { base: string }) {
  const [preview, setPreview] = useState<RepoFeaturePreview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const load = () => {
    if (preview) return;
    api<RepoFeaturePreview>(`${base}/preview`).then(setPreview).catch((e: Error) => setError(e));
  };
  return (
    <details className="evidence" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>{ko.feature.preview}</summary>
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

export function FeaturePage() {
  const { projectId = '', featureId = '' } = useParams();
  return <Feature key={`${projectId}/${featureId}`} projectId={projectId} featureId={featureId} />;
}

function Feature({ projectId, featureId }: { projectId: string; featureId: string }) {
  const base = `/api/projects/${projectId}/repo-wiki/features/${encodeURIComponent(featureId)}`;
  const project = useApi<Project>(`/api/projects/${projectId}`);
  const account = useApi<Account>(project.data ? `/api/accounts/${project.data.accountId}` : null, [project.data?.accountId]);
  const [data, setData] = useState<RepoFeatureResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [source, setSource] = useState<FileSource | null>(null);
  const { job, error: jobError } = useJob<RepoFeatureJobStatus['result']>(jobId ? `/api/projects/${projectId}/repo-wiki/feature-jobs/${jobId}` : null);
  const { me } = useAuth();
  const reader = useReader();
  const [pick, setPick] = useState<ReaderLevel>(reader.level);

  const load = useCallback(() => {
    api<RepoFeatureResponse>(base)
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
    if (job.state === 'error') setError(new Error(job.error?.message ?? '기능을 분석하지 못했습니다'));
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
      const res = await apiPost<RepoFeatureAnalyzeResponse>(`${base}/analyze`, {});
      if (res.status === 'done') setData(res.response);
      else setJobId(res.jobId);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (jobId) void apiDelete(`/api/projects/${projectId}/repo-wiki/feature-jobs/${jobId}`).catch(() => {});
  };

  const name = data?.page?.name ?? data?.feature?.name ?? '…';
  const summary = data?.feature?.summary ?? data?.page?.summary ?? '';
  const working = busy || !!jobId;
  const canAi = !!me?.canEnrich && !data?.unavailable;
  const meta = data ? featureMeta(data) : null;

  return (
    <div className="page">
      <Breadcrumb
        items={[
          { label: ko.accounts.title, to: '/' },
          { label: account.data?.username ?? '…', to: project.data ? `/accounts/${project.data.accountId}` : undefined },
          { label: project.data?.name ?? '…', to: `/projects/${projectId}?tab=wiki` },
          { label: ko.feature.title },
          { label: name },
        ]}
      />
      {!data && !error && <Loading />}
      {error && !data && <ErrorBox error={error} onRetry={load} />}
      {data && (
        <SourceContext.Provider value={setSource}>
          <div className="repo-wiki feature-page">
            <h1>{name}</h1>
            <div className="card">
              {summary && <MiniMarkdown text={summary} />}
              <p className="small muted">{ko.feature.intro}</p>
              {!data.feature && <Notice kind="warn">{ko.feature.missing}</Notice>}
              {meta ? <Notice kind="info">{meta}</Notice> : <Notice kind="info">{ko.feature.notAnalyzed}</Notice>}
              {data.stale && <Notice kind="warn">{ko.feature.stale(data.staleReasons.join(', '))}</Notice>}
              {data.unavailable && <Notice kind="warn">{ko.feature.unavailable(data.unavailable)}</Notice>}
              {!data.page && <p className="small">{ko.feature.howItWorks(data.limits.rounds)}</p>}
              {reader.available && !reader.chosen && (
                <>
                  <strong>{ko.feature.chooseLevel}</strong>
                  <ReaderLevelOptions value={pick} onChange={setPick} disabled={working} />
                </>
              )}
              {reader.available && reader.chosen && <ReaderLevelLine />}
              {canAi && (
                <div className="feature-actions">
                  <button className="btn btn-primary btn-small" disabled={working} onClick={() => void analyze()}>
                    {working ? ko.repo.building : data.page ? ko.feature.reanalyze : reader.available && !reader.chosen ? ko.feature.analyzeAt(ko.reader.levels[pick]!.label) : ko.feature.analyze}
                  </button>
                </div>
              )}
              <JobProgress job={job} busy={working} preparing={busy} label={ko.feature.analyzing}>
                  {jobId && <button className="btn btn-small" onClick={cancel}>
                    {ko.feature.cancel}
                  </button>}
              </JobProgress>
              {error && <ErrorBox error={error} />}
              {data.feature && <FeaturePreview key={reader.level} base={base} />}
              <div className="small">
                <Link to={`/projects/${projectId}?tab=wiki`}>← {ko.repo.sessionLink}</Link>
              </div>
            </div>
            <RepoFeatureView data={data} />
          </div>
          <RepoSourceViewer projectId={projectId} source={source} onClose={() => setSource(null)} />
        </SourceContext.Provider>
      )}
    </div>
  );
}
