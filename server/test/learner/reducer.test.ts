import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LearnerEvent, ResponseEvent } from '@vibe-teacher/shared';
import { conceptState, reduceProfile } from '../../src/learner/reducer';
import { LearnerService, RevisionConflictError, learnerIdFor } from '../../src/learner/service';
import { WikiStorage } from '../../src/storage/store';

let n = 0;
const at = () => `2026-10-18T10:00:${String(n).padStart(2, '0')}.000Z`;
const base = () => ({ id: `e${++n}`, at: at(), projectId: 'p', profileRevision: 0 });
const resp = (over: Partial<ResponseEvent> = {}): ResponseEvent => ({
  ...base(),
  kind: 'response',
  responseId: `r${n}`,
  attemptId: `a${n}`,
  questionId: 'q-auth-tf-1',
  questionVersion: 1,
  conceptIds: ['auth'],
  target: 'concept_knowledge',
  questionKind: 'distinction',
  format: 'true_false',
  questionReview: 'reviewed',
  status: 'answered',
  selectedOptionId: 'x',
  assistance: 'unknown',
  explanationSeen: false,
  firstAttempt: true,
  grade: 'correct',
  ...over,
});
const reduce = (events: LearnerEvent[]) => reduceProfile(events, 'l_1', 'p');
const auth = (events: LearnerEvent[]) => conceptState(reduce(events), 'auth');

describe('learner reducer (policy-0.1)', () => {
  it('defaults to unknown with no evidence (T01)', () => {
    const p = reduce([]);
    expect(p.revision).toBe(0);
    expect(conceptState(p, 'authorization').state).toBe('unknown');
  });

  it('stores self-report separately without promoting the state (T03)', () => {
    const s = auth([{ ...base(), kind: 'self_report', conceptId: 'auth', value: 'known' }]);
    expect(s.selfReport).toBe('known');
    expect(s.state).toBe('unknown');
  });

  it('never turns exposure, skip or dont-know into understanding or wrong answers (T24, T30)', () => {
    const s = auth([
      { ...base(), kind: 'exposure', action: 'deeper', conceptId: 'auth' },
      resp({ status: 'skipped', grade: 'unscorable', selectedOptionId: undefined }),
      resp({ status: 'dont_know', grade: 'unscorable', selectedOptionId: undefined, questionId: 'q-auth-sc-1' }),
    ]);
    expect(s.state).toBe('unknown');
    expect(s.counts).toMatchObject({ exposure: 1, skipped: 1, dontKnow: 1, incorrect: 0, correct: 0 });
  });

  it('records a single correct OX as scoped evidence only and treats retries after the explanation as practice (T31)', () => {
    const first = resp();
    const s1 = auth([first]);
    expect(s1.state).toBe('unknown');
    expect(s1.counts.correct).toBe(1);
    expect(s1.evidenceIds).toEqual([first.id]);
    const s2 = auth([first, resp({ firstAttempt: false })]);
    expect(s2.counts).toMatchObject({ correct: 1, practice: 1 });
    expect(s2.state).toBe('unknown');
  });

  it('does not double count the same event or the same question (T16)', () => {
    const r = resp({ format: 'single_choice', questionKind: 'application', questionId: 'q-auth-sc-1' });
    const s = auth([r, r, resp({ format: 'single_choice', questionKind: 'application', questionId: 'q-auth-sc-1' })]);
    expect(s.counts.correct).toBe(1);
    expect(s.state).toBe('partial');
  });

  it('keeps unreviewed questions and in-app assisted answers out of the estimate (T37)', () => {
    const s = auth([resp({ questionReview: 'candidate' }), resp({ questionId: 'q-auth-sc-1', format: 'single_choice', assistance: 'assisted' })]);
    expect(s.state).toBe('unknown');
    expect(s.counts).toMatchObject({ correct: 0, practice: 2 });
  });

  it('reaches demonstrated only with two distinct correct answers including an application question, keeping assistance uncertain (T05)', () => {
    const s = auth([resp(), resp({ questionId: 'q-auth-sc-1', format: 'single_choice', questionKind: 'application' })]);
    expect(s.state).toBe('demonstrated');
    expect(s.assistance).toBe('unknown');
    expect(s.reviewStatus).toBe('auto_scored');
    expect(s.assessmentScope).toContain('문항 2개');
  });

  it('keeps conflicting evidence from both sides (T06) and does not label a lone wrong answer as a misconception', () => {
    const ok = resp();
    const bad = resp({ questionId: 'q-auth-sc-1', format: 'single_choice', grade: 'incorrect', selectedOptionId: 'a' });
    const s = auth([ok, bad]);
    expect(s.state).toBe('conflicting');
    expect(s.evidenceIds).toEqual([ok.id, bad.id]);
    expect(auth([bad]).state).toBe('unknown');
  });

  it('marks a user correction as disputed and lowers positive states to conflicting', () => {
    const s = auth([
      resp(),
      resp({ questionId: 'q-auth-sc-1', format: 'single_choice', questionKind: 'application' }),
      { ...base(), kind: 'correction', conceptId: 'auth', note: '아직 잘 모릅니다' },
    ]);
    expect(s.state).toBe('conflicting');
    expect(s.disputed).toBe(true);
    expect(s.reviewStatus).toBe('disputed');
  });

  it('counts only state events toward the profile revision', () => {
    const p = reduce([{ ...base(), kind: 'exposure', action: 'open_item' }, { ...base(), kind: 'self_report', conceptId: 'auth', value: 'unsure' }, resp()]);
    expect(p.revision).toBe(2);
  });
});

describe('learner service', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const service = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-learner-'));
    dirs.push(d);
    return new LearnerService(new WikiStorage(d));
  };
  const selfReport = (id: string) => ({ id, at: at(), projectId: 'p', kind: 'self_report' as const, conceptId: 'auth', value: 'known' as const });

  it('derives an opaque learner id from the username', () => {
    expect(learnerIdFor('alice')).toMatch(/^l_[0-9a-f]{16}$/);
    expect(learnerIdFor('alice')).not.toContain('alice');
    expect(learnerIdFor('alice')).not.toBe(learnerIdFor('bob'));
  });

  it('rejects writes based on a stale profile revision without touching the ledger (T25)', async () => {
    const s = service();
    const first = await s.record('l_1', 0, selfReport('s1'));
    expect(first.profile.revision).toBe(1);
    await expect(s.record('l_1', 0, selfReport('s2'))).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await s.events('l_1')).toHaveLength(1);
  });

  it('accepts exposure events regardless of revision and dedupes retried event ids', async () => {
    const s = service();
    await s.record('l_1', null, { id: 'x1', at: at(), projectId: 'p', kind: 'exposure', action: 'open_item' });
    const again = await s.record('l_1', 0, selfReport('s1'));
    const retry = await s.record('l_1', 0, selfReport('s1'));
    expect(retry.duplicate).toBe(true);
    expect(retry.profile.revision).toBe(again.profile.revision);
    expect(await s.events('l_1')).toHaveLength(2);
  });

  it('keeps one profile per learner across projects, separate from other learners', async () => {
    const s = service();
    await s.record('l_1', 0, selfReport('s1'));
    await s.record('l_1', 1, { ...selfReport('s2'), projectId: 'other', conceptId: 'testing' });
    const p = await s.profile('l_1');
    expect(p.revision).toBe(2);
    expect(Object.keys(p.concepts).sort()).toEqual(['auth', 'testing']);
    expect((await s.profile('l_2')).revision).toBe(0);
  });

  it('merges events written by the older per-project ledger', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-learner-legacy-'));
    dirs.push(d);
    const storage = new WikiStorage(d);
    await storage.appendJsonl(path.join(storage.learnerProjectDir('l_1', 'p'), 'events.jsonl'), { ...selfReport('old1'), profileRevision: 0 });
    const s = new LearnerService(storage);
    expect((await s.events('l_1')).map((e) => e.id)).toEqual(['old1']);
    const next = await s.record('l_1', 1, selfReport('new1'));
    expect(next.profile.revision).toBe(2);
  });
});
