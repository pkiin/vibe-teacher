import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import { planWiki } from '../../src/wiki/plan';
import { caseA, profileWith, snapshotOf } from './helpers';
import { reduceProfile } from '../../src/learner/reducer';

describe('AI reading plan', () => {
  it('uses AI order, depth and prerequisite edges without ranking by keyword or learner assumptions', () => {
    const snapshot = snapshotOf(caseA()), catalog = loadWikiCatalog(snapshot);
    const plan = planWiki({ snapshot, profile: profileWith({}), ...catalog, settings: { ...defaultConfig().wiki, briefTokenBudget: 10000 } });
    expect(plan.bundles.map((b) => b.itemId)).toEqual(snapshot.items.map((i) => i.id));
    expect(plan.bundles[0]?.depth).toBe('D2');
    expect(plan.bundles[0]?.prerequisites.map((p) => p.conceptId)).toEqual(['auth']);
    expect(plan.optionalQuestionIds).toEqual([]);
  });
  it('retains every AI warning regardless of learner state or budget', () => {
    const snapshot = snapshotOf(caseA()), catalog = loadWikiCatalog(snapshot);
    const run = (profile: ReturnType<typeof profileWith>) => planWiki({ snapshot, profile, ...catalog, settings: { ...defaultConfig().wiki, briefTokenBudget: 1 } });
    expect(run(profileWith({})).commonAlertIds).toEqual(run(profileWith({ authorization: { state: 'demonstrated' } })).commonAlertIds);
    expect(run(profileWith({})).commonAlertIds).toHaveLength(snapshot.findings.length);
    expect(run(profileWith({})).deferred).toHaveLength(snapshot.items.length);
  });
  it('changes explanation depth from recorded preferences while keeping project facts and warnings identical', () => {
    const snapshot = snapshotOf(caseA()), catalog = loadWikiCatalog(snapshot);
    const original = JSON.stringify(snapshot);
    const planFor = (depth: 'D0' | 'D3') => planWiki({ snapshot, ...catalog, settings: { ...defaultConfig().wiki, briefTokenBudget: 10000 },
      profile: reduceProfile([{ id: 'preference1', at: '2026-10-24T00:00:00Z', kind: 'preference', conceptId: 'authorization', depth, examples: true, profileRevision: 0 }], 'l_1') });
    expect(planFor('D0').bundles[0]?.depth).toBe('D0');
    expect(planFor('D3').bundles[0]?.depth).toBe('D3');
    expect(planFor('D3').personalized).toBe(true);
    expect(planFor('D0').commonAlertIds).toEqual(planFor('D3').commonAlertIds);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
});
