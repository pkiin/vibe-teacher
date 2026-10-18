import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { WikiConcept } from '@vibe-teacher/shared';
import { loadConceptDictionary, type ConceptEntry } from '../analyzers/concepts/dictionary';
import { buildPrerequisiteGraph, type PrerequisiteGraph } from './graph';

/** 위키가 쓰는 개념 카탈로그 버전. concepts.ko.json 의 위키용 필드를 바꾸면 올린다. */
export const CATALOG_VERSION = 'catalog-0.1';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PREREQUISITES_PATH = path.resolve(here, '../../data/prerequisites.json');

const DepthSchema = z.enum(['D0', 'D1', 'D2', 'D3']);

export const PrerequisitesFileSchema = z.object({
  version: z.string(),
  note: z.string().optional(),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      minDepth: DepthSchema.default('D1'),
      status: z.enum(['reviewed', 'proposed']).default('proposed'),
    }),
  ),
});

export interface WikiCatalog {
  version: string;
  concepts: Map<string, WikiConcept>;
  graph: PrerequisiteGraph;
}

export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/s.exec(text.trim());
  return (m?.[1] ?? text).trim();
}

export function toWikiConcept(entry: ConceptEntry): WikiConcept {
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    summary: entry.summary ?? firstSentence(entry.explanation),
    explanation: entry.explanation,
    ...(entry.example ? { example: entry.example } : {}),
    confusions: entry.confusions,
    ...(entry.deep ? { deep: entry.deep } : {}),
    links: entry.links,
  };
}

export function buildCatalog(entries: ConceptEntry[], prerequisites: unknown): WikiCatalog {
  const file = PrerequisitesFileSchema.parse(prerequisites);
  const concepts = new Map(entries.map((e) => [e.id, toWikiConcept(e)]));
  const graph = buildPrerequisiteGraph(file.version, file.edges, new Set(concepts.keys()));
  return { version: `${CATALOG_VERSION}+${file.version}`, concepts, graph };
}

let cached: WikiCatalog | null = null;

export function loadWikiCatalog(): WikiCatalog {
  if (cached) return cached;
  const prerequisites = JSON.parse(fs.readFileSync(DEFAULT_PREREQUISITES_PATH, 'utf8'));
  cached = buildCatalog(loadConceptDictionary(), prerequisites);
  if (cached.graph.quarantined.length) {
    const list = cached.graph.quarantined.map((q) => `${q.edge.from}→${q.edge.to}(${q.reason})`).join(', ');
    console.warn(`[wiki] 검토가 필요한 선행관계를 격리했습니다: ${list}`);
  }
  return cached;
}
