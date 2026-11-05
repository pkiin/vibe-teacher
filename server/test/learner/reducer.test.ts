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

describe('learner reducer (policy-0.3)', () => {
  it('defaults to unknown with no evidence (T01)', () => {
    const p = reduce([]);
    expect(p.revision).toBe(0);
    expect(conceptState(p, 'authorization').state).toBe('unknown');
  });

  it("lifts a confirmed '알고 있어요' with one first-try correct answer to partial, but never by self-report alone", () => {
    const known = { ...base(), kind: 'self_report' as const, conceptId: 'auth', value: 'known' as const };
    expect(auth([resp(), known]).state).toBe('partial');
    expect(auth([resp()]).state).toBe('unknown');
    expect(auth([known]).state).toBe('unknown');
    expect(auth([resp({ assistance: 'assisted' }), known]).state).toBe('unknown');
  });

  it("leaves out answers to questions the learner flagged as broken, even when the flag comes later", () => {
    const right = resp({ questionId: 'q-ai-1', format: 'single_choice', questionKind: 'application' });
    const wrong = resp({ questionId: 'q-ai-2', format: 'single_choice', grade: 'incorrect' });
    const flag = { ...base(), kind: 'question_feedback' as const, questionId: 'q-ai-2', questionVersion: 1, conceptIds: ['auth'], reason: 'wrong_answer' as const };
    expect(auth([right, wrong]).state).toBe('conflicting');
    const s = auth([right, wrong, flag]);
    expect(s.state).toBe('partial');
    expect(s.counts).toMatchObject({ correct: 1, incorrect: 0, practice: 0 });
    expect(s.progress).toBe('practicing');
    expect(s.activity?.find((a) => a.id === wrong.id)?.grade).toBeUndefined();
    expect(s.activity?.at(-1)?.kind).toBe('question_feedback');
    expect(reduce([right, wrong, flag]).revision).toBe(3);
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

  it('counts first-try AI (candidate) questions but keeps in-app assisted answers as practice (T37)', () => {
    const s = auth([resp({ questionReview: 'candidate' }), resp({ questionId: 'q-auth-sc-1', format: 'single_choice', assistance: 'assisted' })]);
    expect(s.state).toBe('unknown');
    expect(s.counts).toMatchObject({ correct: 1, practice: 1, practiceCorrect: 1 });
    const choice = auth([resp({ questionReview: 'candidate', questionId: 'q-ai-sc', format: 'single_choice' })]);
    expect(choice.state).toBe('partial');
    const mastered = auth([resp({ questionReview: 'candidate' }), resp({ questionReview: 'candidate', questionId: 'q-ai-apply', format: 'single_choice', questionKind: 'application' })]);
    expect(mastered.state).toBe('demonstrated');
  });

  it('reaches demonstrated only with two distinct correct answers including an application question, keeping assistance uncertain (T05)', () => {
    const s = auth([resp(), resp({ questionId: 'q-auth-sc-1', format: 'single_choice', questionKind: 'application' })]);
    expect(s.state).toBe('demonstrated');
    expect(s.assistance).toBe('unknown');
    expect(s.reviewStatus).toBe('auto_scored');
    expect(s.assessmentScope).toContain('문제 2개');
    expect(s.assessmentScope).not.toContain('오답');
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

  it('adapts after difficulty and lets later correct answers lift an old wrong answer', () => {
    const correct = resp({ questionReview: 'candidate' });
    const incorrect = resp({ questionId: 'q-new', questionReview: 'candidate', grade: 'incorrect' });
    const s = auth([correct, incorrect]);
    expect(s.state).toBe('conflicting');
    expect(s.counts).toMatchObject({ correct: 1, incorrect: 1, practice: 0 });
    expect(s.teaching).toMatchObject({ depth: 'D2', examples: true, reason: 'review' });
    expect(s.activity?.map((a) => a.id)).toEqual([correct.id, incorrect.id]);
    // 오답 뒤 OX 하나만으로는 오르지 않는다
    const oneMore = auth([correct, incorrect, resp({ questionId: 'q-newer', questionReview: 'candidate' })]);
    expect(oneMore.progress).toBe('improving');
    expect(oneMore.state).toBe('conflicting');
    // 오답 뒤에 다시 맞힌 것만으로 규칙을 채우면 그 상태로 오른다
    const relearned = auth([correct, incorrect, resp({ questionId: 'q-newer', questionReview: 'candidate' }), resp({ questionId: 'q-apply2', questionReview: 'candidate', format: 'single_choice', questionKind: 'application' })]);
    expect(relearned.state).toBe('demonstrated');
    expect(relearned.progress).toBe('improving');
    // 정답이 오답보다 먼저였다면 다시 맞힌 것으로 보지 않는다
    expect(auth([resp({ questionId: 'q-a', format: 'single_choice' }), resp({ questionId: 'q-b', format: 'single_choice', grade: 'incorrect' })]).state).toBe('conflicting');
  });

  it('uses repeated questions to change teaching, retains mastery and honors an explicit preference', () => {
    const events: LearnerEvent[] = [resp(), resp({ questionId: 'q-apply', format: 'single_choice', questionKind: 'application' }),
      { ...base(), kind: 'question', conceptIds: ['auth'], messageId: 'h1' },
      { ...base(), kind: 'question', conceptIds: ['auth'], messageId: 'h2' }];
    const before = reduce(events);
    expect(before.concepts.auth?.state).toBe('demonstrated');
    expect(before.concepts.auth?.counts.questions).toBe(2);
    expect(before.concepts.auth?.teaching?.reason).toBe('repeated_questions');
    expect(before.revision).toBe(2);
    expect(before.activityRevision).toBe(4);
    events.push({ ...base(), kind: 'preference', conceptId: 'auth', depth: 'D3', examples: true });
    expect(reduce(events).concepts.auth?.teaching).toMatchObject({ depth: 'D3', reason: 'preference' });
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
