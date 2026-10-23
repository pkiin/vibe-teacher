import { describe, expect, it } from 'vitest';
import { buildKnowledgeEntries, extractOccurrences } from '../../src/learner/knowledge';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import { caseA, profileWith, snapshotOf } from '../wiki/helpers';

describe('dynamic learner knowledge', () => {
  it('collects AI-selected concepts without a global catalog or inferring understanding', () => {
    const session = caseA(), snapshot = snapshotOf(session), catalog = loadWikiCatalog(snapshot);
    const occurrences = extractOccurrences({ session, projectName: '프로젝트', snapshot, hits: [], patterns: new Map(), knownConceptIds: new Set(catalog.concepts.keys()) });
    const entries = buildKnowledgeEntries({ sessions: [occurrences], catalog: catalog.concepts, profile: profileWith({}), includeProfileOnly: false });
    expect(entries.some((e) => e.conceptId === 'authorization')).toBe(true);
    expect(entries.every((e) => e.state.state === 'unknown')).toBe(true);
    expect(entries.every((e) => e.reason === '')).toBe(true);
    expect(entries[0]?.sources[0]?.sessionKey).toBe(session.key);
  });
  it('does not replace learner feedback with AI explanations or populate unrelated concepts', () => {
    const session = caseA(), snapshot = snapshotOf(session), catalog = loadWikiCatalog(snapshot);
    const occurrences = extractOccurrences({ session, projectName: '프로젝트', snapshot, hits: [], patterns: new Map(), knownConceptIds: new Set(catalog.concepts.keys()) });
    const profile = profileWith({ authorization: { selfReport: 'known' }, unrelated: { selfReport: 'known' } });
    const entries = buildKnowledgeEntries({ sessions: [occurrences], catalog: catalog.concepts, profile, includeProfileOnly: true });
    expect(entries.find((e) => e.conceptId === 'authorization')?.state.selfReport).toBe('known');
    expect(entries.some((e) => e.conceptId === 'unrelated')).toBe(false);
  });
});
