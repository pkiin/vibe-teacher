import type { WikiConcept, WikiSnapshot } from '@vibe-teacher/shared';
import { buildPrerequisiteGraph, type PrerequisiteGraph } from './graph';

export const CATALOG_VERSION = 'session-generated-1';
export interface WikiCatalog { version: string; concepts: Map<string, WikiConcept>; graph: PrerequisiteGraph }

/** 카탈로그는 각 세션의 AI 결과에서 파생한다. 전역 고정 사전은 읽지 않는다. */
export function loadWikiCatalog(snapshot?: Pick<WikiSnapshot, 'concepts' | 'prerequisites'> | null): WikiCatalog {
  const concepts = new Map((snapshot?.concepts ?? []).map((c) => [c.id, c]));
  const edges = (snapshot?.prerequisites ?? []).map((e) => ({ ...e, minDepth: 'D1' as const, status: 'reviewed' as const }));
  return { version: CATALOG_VERSION, concepts, graph: buildPrerequisiteGraph(CATALOG_VERSION, edges, new Set(concepts.keys())) };
}
