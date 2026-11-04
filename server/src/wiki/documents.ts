import type { ReaderLevel, SessionAnalysisDocument, SessionAnalysisDocumentsResponse, SessionSummary } from '@vibe-teacher/shared';
import { mapConcurrent } from '../lib/concurrent';
import type { EnrichService } from '../llm/service';
import type { WikiService } from './service';

/** 현재 접근 가능한 프로젝트의 저장된 결과만 읽는다. 세션 원문이나 AI 호출은 필요 없다. */
export async function sessionAnalysisDocuments(sessions: SessionSummary[], wiki: Pick<WikiService, 'current' | 'isStale'>, enrich: Pick<EnrichService, 'getCached'>, level: ReaderLevel): Promise<SessionAnalysisDocumentsResponse> {
  const results = await mapConcurrent(sessions, 6, async (session): Promise<SessionAnalysisDocument | null> => {
    const [snapshot, summary] = await Promise.all([wiki.current(session.projectId, session.key), enrich.getCached(session, level)]);
    const analyzed = snapshot?.generator.kind === 'llm' ? snapshot : null;
    if (!analyzed && !summary) return null;
    const sections: SessionAnalysisDocument['sections'] = [];
    if (summary) sections.push('summary');
    if (analyzed) sections.push('wiki', 'concepts', 'security');
    else if (summary?.data.concepts.length) sections.push('concepts');
    return {
      sessionKey: session.key,
      title: summary?.data.summary.title || session.title,
      ...(summary ? { summary: summary.data.summary.oneLiner } : {}),
      createdAt: [analyzed?.builtAt, summary?.createdAt].filter((at): at is string => !!at).sort().at(-1)!,
      status: analyzed?.status === 'success' && summary ? 'complete' : 'partial',
      stale: !!analyzed && wiki.isStale(analyzed, session),
      sections,
    };
  });
  return { documents: results.filter((doc): doc is SessionAnalysisDocument => !!doc).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), totalSessions: sessions.length };
}
