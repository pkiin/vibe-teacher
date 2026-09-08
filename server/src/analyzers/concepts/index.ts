import type { BuiltSummary, ConceptHit, NormalizedSession } from '@vibe-teacher/shared';
import { loadConceptDictionary, type CompiledConcept } from './dictionary';
import { matchConcepts } from './match';

export function detectConcepts(session: NormalizedSession, built: BuiltSummary, dictionary?: CompiledConcept[]): ConceptHit[] {
  return matchConcepts(session, built, dictionary ?? loadConceptDictionary());
}

export { loadConceptDictionary, compileConcepts } from './dictionary';
