import type { EnrichStartResponse, EnrichmentRecord, WikiAiStartResponse, WikiResponse } from '@vibe-teacher/shared';
import { apiPost } from './client';

interface AnalysisActions {
  wikiReady: boolean;
  force: boolean;
  onEnrichment: (result: EnrichmentRecord) => void;
  onEnrichJob: (id: string) => void;
  onWiki: (result?: WikiResponse) => void;
  onWikiJob: (id: string) => void;
}

/** 한 부분이 실패해도 다른 부분의 결과는 보존한다. 최초 분석은 기반 문서도 함께 만든다. */
export async function startSessionAnalysis(sessionKey: string, actions: AnalysisActions): Promise<{ part: 'summary' | 'analysis'; message: string }[]> {
  const base = `/api/sessions/${encodeURIComponent(sessionKey)}`;
  const errors: { part: 'summary' | 'analysis'; message: string }[] = [];
  await Promise.all([
    apiPost<EnrichStartResponse>(`${base}/enrich${actions.force ? '?force=1' : ''}`)
      .then((result) => result.status === 'done' ? actions.onEnrichment(result.result) : actions.onEnrichJob(result.jobId))
      .catch((e: Error) => { errors.push({ part: 'summary', message: e.message }); }),
    (actions.wikiReady
      ? apiPost<WikiAiStartResponse>(`${base}/wiki/ai`, { force: actions.force })
          .then((result) => result.status === 'done' ? actions.onWiki() : actions.onWikiJob(result.jobId))
      : apiPost<WikiResponse>(`${base}/wiki/build`, {})
          .then((result) => { actions.onWiki(result); if (result.generation) actions.onWikiJob(result.generation.jobId); }))
      .catch((e: Error) => { errors.push({ part: 'analysis', message: e.message }); }),
  ]);
  return errors;
}
