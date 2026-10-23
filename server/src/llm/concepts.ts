import type { ConceptHit, ConceptLink, WikiConcept } from '@vibe-teacher/shared';
import { shortId } from '../lib/hash';

/** AI가 정한 개념 이름을 세션 간 재사용 가능한 안전한 식별자로 바꾼다. */
export function conceptId(id: string | null | undefined, name: string): string {
  const slug = (id ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug && slug.length <= 64 ? slug : `concept-${shortId(name.trim().toLowerCase(), 16)}`;
}

export function safeLinks(links: ConceptLink[], allowed?: ReadonlySet<string>): ConceptLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    try {
      const u = new URL(l.url);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || seen.has(u.href) || (allowed && !allowed.has(u.href))) return false;
      seen.add(u.href);
      return true;
    } catch { return false; }
  }).slice(0, 5);
}

export function conceptFromHit(hit: ConceptHit): WikiConcept {
  return { id: hit.id, name: hit.name, category: hit.category, summary: hit.explanation, explanation: hit.explanation,
    confusions: [], links: hit.links ?? [], whyHere: hit.whyHere, level: hit.level, ...(hit.llm?.example ? { example: hit.llm.example } : {}) };
}
