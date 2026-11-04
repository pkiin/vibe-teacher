import type { KnowledgeEntry, KnowledgeWikiResponse, SavedKnowledgeResponse } from '@vibe-teacher/shared';
import { api } from './client';

export interface DisplayKnowledgeEntry extends KnowledgeEntry { previousReason?: string }
export type DisplayKnowledge = Omit<KnowledgeWikiResponse, 'entries'> & { entries: DisplayKnowledgeEntry[] };

/** 최신 학습 상태와 허용된 출처가 그대로일 때만 이전 설명을 보조로 남긴다. */
export function retainKnowledgeReasons(previous: DisplayKnowledge | null, fresh: KnowledgeWikiResponse): DisplayKnowledge {
  const old = new Map(previous?.entries.map((entry) => [entry.conceptId, entry]));
  return { ...fresh, entries: fresh.entries.map((entry) => {
    const before = old.get(entry.conceptId);
    const reason = before?.reasonOrigin === 'llm' ? before.reason : before?.previousReason;
    if (entry.reason || entry.reasonOrigin === 'error' || !before || !reason || entry.summary !== before.summary || JSON.stringify(entry.state) !== JSON.stringify(before.state)) return entry;
    const sources = new Set(entry.sources.map((source) => `${source.projectId}\0${source.sessionKey}`));
    if (!before.sources.every((source) => sources.has(`${source.projectId}\0${source.sessionKey}`))) return entry;
    return { ...entry, previousReason: reason };
  }) };
}

/** 저장된 보기와 최신 조회를 병렬로 시작하고 늦은 캐시 응답이 새 화면을 되돌리지 못하게 한다. */
export async function loadKnowledge(query: string, onSaved: (view: KnowledgeWikiResponse) => void, onFresh: (view: KnowledgeWikiResponse) => void): Promise<void> {
  const suffix = query ? `?${query}` : '';
  let freshReceived = false;
  void api<SavedKnowledgeResponse>(`/api/me/knowledge/saved${suffix}`).then(({ view }) => {
    if (view && !freshReceived) onSaved(view);
  }).catch(() => { /* 보기 캐시 장애는 최신 조회로 계속한다. */ });
  const fresh = await api<KnowledgeWikiResponse>(`/api/me/knowledge${suffix}`);
  freshReceived = true;
  onFresh(fresh);
}
