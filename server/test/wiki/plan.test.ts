import { describe, expect, it } from 'vitest';
import type { LearnerProfile } from '@vibe-teacher/shared';
import { loadQuestionBank } from '../../src/assessment/bank';
import { defaultConfig } from '../../src/config/schema';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import { planWiki } from '../../src/wiki/plan';
import { caseA, profileWith, snapshotOf } from './helpers';

const catalog = loadWikiCatalog();
const settings = defaultConfig().wiki;
const plan = (profile: LearnerProfile | null, over: Partial<typeof settings> = {}, snapshot = snapshotOf(caseA())) =>
  planWiki({ snapshot, profile, concepts: catalog.concepts, graph: catalog.graph, settings: { ...settings, briefTokenBudget: 5000, ...over }, bank: loadQuestionBank() });
const accessBundle = (p: ReturnType<typeof plan>) => p.bundles.find((b) => b.itemId === 'i_access-control')!;

const demonstrated = { state: 'demonstrated' as const, reviewStatus: 'auto_scored' as const, assessmentScope: 'fixture' };

describe('explanation planner — case A profiles (T07, T12)', () => {
  const snapshot = snapshotOf(caseA());
  const p1 = plan(profileWith({ authorization: {}, auth: {} }), {}, snapshot);
  const p2 = plan(profileWith({ auth: demonstrated, authorization: { state: 'partial' } }), {}, snapshot);
  const p3 = plan(profileWith({ auth: demonstrated, authorization: demonstrated, 'client-server-boundary': demonstrated }), {}, snapshot);

  it('keeps project facts and common alerts identical across profiles', () => {
    expect(p1.commonAlertIds).toEqual(['f_security-access-control-unverified']);
    expect(p2.commonAlertIds).toEqual(p1.commonAlertIds);
    expect(p3.commonAlertIds).toEqual(p1.commonAlertIds);
  });

  it('unknown: short D1 with prerequisite explanations', () => {
    const b = accessBundle(p1);
    expect(b.depth).toBe('D1');
    expect(b.reasonCodes).toContain('evidence_unknown');
    expect(b.prerequisites).toContainEqual({ conceptId: 'auth', recallOnly: false });
  });

  it('auth demonstrated + authorization partial: D2 focused on the confusion, auth as a recall', () => {
    const b = accessBundle(p2);
    expect(b.depth).toBe('D2');
    expect(b.reasonCodes).toContain('partial:authorization');
    expect(b.prerequisites).toContainEqual({ conceptId: 'auth', recallOnly: true });
  });

  it('both demonstrated: current-change D1, not hidden, prerequisites as recalls', () => {
    const b = accessBundle(p3);
    expect(b.depth).toBe('D1');
    expect(b.reasonCodes).toContain('demonstrated_awareness_unconfirmed');
    expect(b.prerequisites.every((p) => p.recallOnly)).toBe(true);
  });

  it('falls back to a non-personalized plan without a profile but keeps alerts', () => {
    const p = plan(null, {}, snapshot);
    expect(p.personalized).toBe(false);
    expect(p.commonAlertIds).toEqual(p1.commonAlertIds);
  });

  it('treats "known" self-report as a shorter-explanation preference only', () => {
    const p = plan(profileWith({ authorization: { selfReport: 'known' } }), {}, snapshot);
    expect(accessBundle(p).depth).toBe('D0');
    expect(p.commonAlertIds).toEqual(p1.commonAlertIds);
  });
});

describe('explanation planner — budget (T14, T15)', () => {
  it('marks prerequisites it had to drop as unmet instead of claiming a complete explanation', () => {
    const p = plan(profileWith({}), { maxPrerequisitesPerBundle: 0 });
    const b = accessBundle(p);
    expect(b.prerequisites).toEqual([]);
    expect(b.prerequisiteUnmet).toContain('auth');
    expect(b.reasonCodes).toContain('prerequisite_unmet');
  });

  it('trims depth or defers items with a reason when the brief budget is tight', () => {
    const full = plan(profileWith({}));
    const tight = plan(profileWith({}), { briefTokenBudget: Math.ceil(full.budget.used * 0.5) });
    expect(tight.budget.status).toBe('trimmed');
    expect(tight.budget.used).toBeLessThanOrEqual(tight.budget.limit);
    expect(tight.deferred.length + tight.bundles.filter((b) => b.reasonCodes.includes('trimmed_for_budget')).length).toBeGreaterThan(0);
    expect(tight.deferred.every((d) => d.reason === 'budget')).toBe(true);
    expect(tight.commonAlertIds).toEqual(full.commonAlertIds);
  });

  it('reports mandatory overflow and keeps every alert when alerts alone exceed the budget', () => {
    const p = plan(profileWith({}), { briefTokenBudget: 10 });
    expect(p.budget.status).toBe('mandatory_overflow');
    expect(p.commonAlertIds.length).toBeGreaterThan(0);
    expect(p.bundles).toEqual([]);
    expect(p.deferred.every((d) => d.reason === 'mandatory_overflow')).toBe(true);
  });
});

describe('explanation planner — optional questions', () => {
  it('suggests at most the configured number, skipping demonstrated concepts and answered questions', () => {
    const p = plan(profileWith({}));
    expect(p.optionalQuestionIds.length).toBeLessThanOrEqual(2);
    expect(p.optionalQuestionIds.length).toBeGreaterThan(0);
    const none = plan(profileWith({}), { suggestQuestions: false });
    expect(none.optionalQuestionIds).toEqual([]);
    const snapshot = snapshotOf(caseA());
    const answered = planWiki({ snapshot, profile: profileWith({}), concepts: catalog.concepts, graph: catalog.graph, settings: { ...settings, briefTokenBudget: 5000 }, bank: loadQuestionBank(), answeredQuestionIds: new Set(p.optionalQuestionIds) });
    for (const id of p.optionalQuestionIds) expect(answered.optionalQuestionIds).not.toContain(id);
  });
});
