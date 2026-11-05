import {
  LEARNER_SCHEMA_VERSION,
  type Assistance,
  type ConceptEvidenceCounts,
  type LearnerConceptState,
  type LearnerEvent,
  type LearnerProfile,
  type ResponseEvent,
  type TeachingPlan,
} from '@vibe-teacher/shared';

/**
 * 이벤트 원장 → 개념별 상태. 순수 함수이며 원장이 진실이고 profile.json 은 파생 캐시다.
 *
 * policy-0.3 (보수적 규칙, 검증된 숙련 확률이 아님):
 * - 자기보고·노출·건너뛰기·모르겠어요는 상태를 바꾸지 않는다.
 * - 화면의 '알고 있어요'는 OX 확인 문제를 맞혀야 기록된다(assessment self_check). 그래서 자기보고 known 과
 *   처음 풀어 맞힌 문제가 함께 있으면 OX 하나여도 partial 로 본다. 자기보고만으로는 오르지 않는다.
 * - AI 가 만든 문항(candidate)도 처음 풀고 앱 안 도움 없이 낸 응답이면 상태 근거로 센다.
 *   해설을 본 뒤의 재시도, 앱 안 도움을 쓴 응답은 연습 성과로 구분한다.
 * - 질문·연습 성과·직접 선택한 설명 방식은 teaching에 반영하되 숙련 상태로 승격하지 않는다.
 * - 같은 문항은 처음 채점된 한 번만 센다 (같은 원문 반복 수집으로 증거가 늘지 않게).
 * - OX 정답 1개만으로는 올리지 않는다 (추측 가능). 객관식 정답 또는 서로 다른 문항 2개 정답 → partial.
 * - 서로 다른 문항 2개 이상 정답 + 그중 적용(application) 객관식 포함 → demonstrated (범위 표시).
 * - 오답만 있으면 unknown 유지 (오개념으로 확정하지 않음).
 * - 정답과 오답이 함께 있으면 마지막 오답 뒤의 정답만으로 위 규칙을 다시 본다. 그것으로 오르면 그 상태
 *   (다시 풀어 익힌 것), 아니면 conflicting. 예전 오답 하나가 상태를 영구히 묶지 않게 한다.
 * - 사용자 정정이 마지막 채점 증거보다 나중이면 disputed, 긍정 상태는 conflicting 으로 내린다.
 * - '문제가 이상해요'(question_feedback)로 알린 문제의 응답은 상태·정답 수·학습 흐름에 넣지 않는다 (활동 기록에는 남김).
 */
export const POLICY_VERSION = 'policy-0.4';

export function emptyConceptCounts(): ConceptEvidenceCounts {
  return { correct: 0, incorrect: 0, dontKnow: 0, skipped: 0, practice: 0, exposure: 0, practiceCorrect: 0, practiceIncorrect: 0, questions: 0 };
}

export function unknownConcept(conceptId: string): LearnerConceptState {
  return { conceptId, state: 'unknown', evidenceIds: [], counts: emptyConceptCounts(), disputed: false };
}

/** 상태를 바꿀 수 있는 이벤트만 revision 을 올린다 (노출은 기록만). */
export function isStateEvent(e: LearnerEvent): boolean {
  return e.kind !== 'exposure' && e.kind !== 'question';
}

interface ConceptAcc {
  state: LearnerConceptState;
  scored: Map<string, ResponseEvent>;
  lastScoredAt?: string;
  lastCorrectionAt?: string;
}

function isPracticeOnly(e: ResponseEvent): boolean {
  return !e.firstAttempt || e.assistance === 'assisted' || e.target !== 'concept_knowledge';
}

/** 정답 응답으로 오를 수 있는 상태 (오답은 따로 본다). selfKnown: '알고 있어요' 확인을 마친 개념 */
function levelOf(correct: ResponseEvent[], selfKnown: boolean): 'unknown' | 'partial' | 'demonstrated' {
  const hasChoice = correct.some((e) => e.format === 'single_choice');
  const hasApplication = correct.some((e) => e.format === 'single_choice' && e.questionKind === 'application');
  if (correct.length >= 2 && hasApplication) return 'demonstrated';
  if (hasChoice || correct.length >= 2 || (selfKnown && correct.length)) return 'partial';
  return 'unknown';
}

const questionKey = (e: { questionId: string; questionVersion: number }) => `${e.questionId}@${e.questionVersion}`;

function later(a: string | undefined, b: string): string {
  return a && a > b ? a : b;
}

export function reduceProfile(events: LearnerEvent[], learnerId: string, projectId?: string): LearnerProfile {
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const acc = new Map<string, ConceptAcc>();
  const get = (conceptId: string): ConceptAcc => {
    let a = acc.get(conceptId);
    if (!a) {
      a = { state: unknownConcept(conceptId), scored: new Map() };
      acc.set(conceptId, a);
    }
    return a;
  };

  // 이상하다고 알린 문제는 순서와 관계없이 (피드백이 응답보다 나중이어도) 처음부터 빼고 센다
  const flagged = new Set(unique.flatMap((e) => (e.kind === 'question_feedback' ? [questionKey(e)] : [])));
  let revision = 0;
  let updatedAt: string | undefined;
  for (const e of unique) {
    if (isStateEvent(e)) revision += 1;
    updatedAt = later(updatedAt, e.at);
    const ids = e.kind === 'response' || e.kind === 'question' || e.kind === 'question_feedback' ? e.conceptIds : e.conceptId ? [e.conceptId] : [];
    const excluded = e.kind === 'response' && flagged.has(questionKey(e));
    for (const id of ids) {
      const s = get(id).state;
      const activity = { id: e.id, at: e.at, kind: e.kind, ...(e.projectId ? { projectId: e.projectId } : {}), ...(e.sessionKey ? { sessionKey: e.sessionKey } : {}),
        ...(e.kind === 'response' && !excluded ? { grade: e.grade, status: e.status, practice: isPracticeOnly(e) } : {}), ...(e.kind === 'self_report' ? { selfReport: e.value } : {}) };
      s.activity = [...(s.activity ?? []), activity].slice(-12);
    }
    switch (e.kind) {
      case 'exposure':
        if (e.conceptId) get(e.conceptId).state.counts.exposure += 1;
        break;
      case 'self_report': {
        const a = get(e.conceptId);
        a.state.selfReport = e.value;
        a.state.lastObservedAt = later(a.state.lastObservedAt, e.at);
        break;
      }
      case 'question':
        for (const id of e.conceptIds) {
          const s = get(id).state;
          s.counts.questions = (s.counts.questions ?? 0) + 1;
          s.lastObservedAt = later(s.lastObservedAt, e.at);
        }
        break;
      case 'preference': {
        const s = get(e.conceptId).state;
        s.preference = { depth: e.depth, examples: e.examples, eventId: e.id };
        s.lastObservedAt = later(s.lastObservedAt, e.at);
        break;
      }
      case 'correction': {
        const a = get(e.conceptId);
        a.lastCorrectionAt = later(a.lastCorrectionAt, e.at);
        break;
      }
      case 'question_feedback':
        for (const id of e.conceptIds) get(id).state.lastObservedAt = later(get(id).state.lastObservedAt, e.at);
        break;
      case 'response':
        if (excluded) break;
        for (const conceptId of e.conceptIds) {
          const a = get(conceptId);
          const c = a.state.counts;
          a.state.lastObservedAt = later(a.state.lastObservedAt, e.at);
          if (e.status === 'dont_know' || e.grade === 'incorrect') a.state.progress = 'revisit';
          else if (e.status === 'answered' && e.grade === 'correct') a.state.progress = c.dontKnow + c.incorrect + (c.practiceIncorrect ?? 0) > 0 || a.state.selfReport === 'unfamiliar' ? 'improving' : 'practicing';
          if (e.status === 'skipped') c.skipped += 1;
          else if (e.status === 'dont_know') c.dontKnow += 1;
          else if (e.grade === 'unscorable') continue;
          else if (isPracticeOnly(e)) {
            c.practice += 1;
            if (e.grade === 'correct') c.practiceCorrect = (c.practiceCorrect ?? 0) + 1;
            else if (e.grade === 'incorrect') c.practiceIncorrect = (c.practiceIncorrect ?? 0) + 1;
          }
          else {
            const k = `${e.questionId}@${e.questionVersion}`;
            if (a.scored.has(k)) {
              c.practice += 1;
              if (e.grade === 'correct') c.practiceCorrect = (c.practiceCorrect ?? 0) + 1;
              else if (e.grade === 'incorrect') c.practiceIncorrect = (c.practiceIncorrect ?? 0) + 1;
              continue;
            }
            a.scored.set(k, e);
            if (e.grade === 'correct') c.correct += 1;
            else c.incorrect += 1;
            a.lastScoredAt = later(a.lastScoredAt, e.at);
            a.state.lastObservedAt = later(a.state.lastObservedAt, e.at);
          }
        }
        break;
    }
  }

  const concepts: Record<string, LearnerConceptState> = {};
  for (const [conceptId, a] of acc) concepts[conceptId] = finalize(a);
  return {
    schemaVersion: LEARNER_SCHEMA_VERSION,
    learnerId,
    ...(projectId ? { projectId } : {}),
    revision,
    activityRevision: unique.length,
    ...(updatedAt ? { updatedAt } : {}),
    policyVersion: POLICY_VERSION,
    concepts,
  };
}

function finalize(a: ConceptAcc): LearnerConceptState {
  const s = a.state;
  const scored = [...a.scored.values()];
  const correct = scored.filter((e) => e.grade === 'correct');
  const incorrect = scored.filter((e) => e.grade === 'incorrect');

  if (correct.length && incorrect.length) {
    // 채점 순서대로 들어 있다. 마지막 오답 뒤에 다시 맞힌 것만으로 오를 수 있으면 그 상태로 본다
    let lastWrong = -1;
    scored.forEach((e, i) => { if (e.grade === 'incorrect') lastWrong = i; });
    const relearned = levelOf(scored.slice(lastWrong + 1).filter((e) => e.grade === 'correct'), s.selfReport === 'known');
    s.state = relearned === 'unknown' ? 'conflicting' : relearned;
  } else s.state = correct.length ? levelOf(correct, s.selfReport === 'known') : 'unknown';

  if (scored.length) {
    s.evidenceIds = scored.map((e) => e.id);
    s.reviewStatus = 'auto_scored';
    s.assistance = scored.reduce<Assistance>((acc, e) => (e.assistance === 'unknown' || acc === 'unknown' ? 'unknown' : acc), 'none');
    // 화면(배지 설명)과 AI 사실에 들어간다. 오답 수는 원장에만 두고 여기에 쓰지 않는다
    s.assessmentScope = `처음 풀어 맞힌 서로 다른 문제 ${correct.length}개 · 자동 채점${s.assistance === 'unknown' ? ' · 앱 밖 도움 여부는 확인할 수 없음' : ''}`;
  }

  if (a.lastCorrectionAt && (!a.lastScoredAt || a.lastCorrectionAt >= a.lastScoredAt)) {
    s.disputed = true;
    s.reviewStatus = 'disputed';
    if (s.state === 'partial' || s.state === 'demonstrated') s.state = 'conflicting';
  }
  s.teaching = teachingPlan(s);
  return s;
}

/** 설명 선택에만 쓰는 개발 정책. 이해 상태나 공통 위험 알림은 바꾸지 않는다. */
export function teachingPlan(s: LearnerConceptState): TeachingPlan {
  const evidence = (s.activity ?? []).map((e) => e.id).slice(-5);
  if (s.preference) return { depth: s.preference.depth, examples: s.preference.examples, reason: 'preference', evidenceIds: [s.preference.eventId] };
  if (s.disputed || s.state === 'conflicting') return { depth: 'D2', examples: true, reason: 'review', evidenceIds: evidence };
  if ((s.counts.questions ?? 0) >= 2) return { depth: 'D2', examples: true, reason: 'repeated_questions', evidenceIds: evidence };
  const lastResponse = [...(s.activity ?? [])].reverse().find((e) => e.kind === 'response');
  if (lastResponse?.grade === 'incorrect' || lastResponse?.status === 'dont_know') return { depth: 'D2', examples: true, reason: 'review', evidenceIds: [lastResponse.id] };
  if (s.selfReport === 'unsure' || s.selfReport === 'unfamiliar') return { depth: 'D2', examples: true, reason: 'self_report', evidenceIds: evidence };
  if (s.state === 'demonstrated' || s.selfReport === 'known') return { depth: 'D0', examples: false, reason: s.state === 'demonstrated' ? 'demonstrated' : 'self_report', evidenceIds: evidence };
  if (s.counts.practice > 0) return { depth: 'D1', examples: true, reason: 'practice', evidenceIds: evidence };
  return { depth: 'D1', examples: false, reason: 'default', evidenceIds: [] };
}

export function conceptState(profile: LearnerProfile | null | undefined, conceptId: string): LearnerConceptState {
  return profile?.concepts[conceptId] ?? unknownConcept(conceptId);
}
