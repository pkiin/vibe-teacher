import {
  LEARNER_SCHEMA_VERSION,
  type Assistance,
  type ConceptEvidenceCounts,
  type LearnerConceptState,
  type LearnerEvent,
  type LearnerProfile,
  type ResponseEvent,
} from '@vibe-teacher/shared';

/**
 * 이벤트 원장 → 개념별 상태. 순수 함수이며 원장이 진실이고 profile.json 은 파생 캐시다.
 *
 * policy-0.1 (보수적 규칙, 검증된 숙련 확률이 아님):
 * - 자기보고·노출·건너뛰기·모르겠어요는 상태를 바꾸지 않는다.
 * - 검토 전(candidate) 문항, 해설을 본 뒤의 재시도, 앱 안 도움을 쓴 응답은 연습으로만 센다.
 * - 같은 문항은 처음 채점된 한 번만 센다 (같은 원문 반복 수집으로 증거가 늘지 않게).
 * - OX 정답 1개만으로는 올리지 않는다 (추측 가능). 객관식 정답 또는 서로 다른 문항 2개 정답 → partial.
 * - 서로 다른 문항 2개 이상 정답 + 그중 적용(application) 객관식 포함 → demonstrated (범위 표시).
 * - 오답만 있으면 unknown 유지 (오개념으로 확정하지 않음). 정답과 오답이 함께 있으면 conflicting.
 * - 사용자 정정이 마지막 채점 증거보다 나중이면 disputed, 긍정 상태는 conflicting 으로 내린다.
 */
export const POLICY_VERSION = 'policy-0.1';

export function emptyConceptCounts(): ConceptEvidenceCounts {
  return { correct: 0, incorrect: 0, dontKnow: 0, skipped: 0, practice: 0, exposure: 0 };
}

export function unknownConcept(conceptId: string): LearnerConceptState {
  return { conceptId, state: 'unknown', evidenceIds: [], counts: emptyConceptCounts(), disputed: false };
}

/** 상태를 바꿀 수 있는 이벤트만 revision 을 올린다 (노출은 기록만). */
export function isStateEvent(e: LearnerEvent): boolean {
  return e.kind !== 'exposure';
}

interface ConceptAcc {
  state: LearnerConceptState;
  scored: Map<string, ResponseEvent>;
  lastScoredAt?: string;
  lastCorrectionAt?: string;
}

function isPracticeOnly(e: ResponseEvent): boolean {
  return e.questionReview !== 'reviewed' || !e.firstAttempt || e.assistance === 'assisted' || e.target !== 'concept_knowledge';
}

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

  let revision = 0;
  let updatedAt: string | undefined;
  for (const e of unique) {
    if (isStateEvent(e)) revision += 1;
    updatedAt = later(updatedAt, e.at);
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
      case 'correction': {
        const a = get(e.conceptId);
        a.lastCorrectionAt = later(a.lastCorrectionAt, e.at);
        break;
      }
      case 'response':
        for (const conceptId of e.conceptIds) {
          const a = get(conceptId);
          const c = a.state.counts;
          if (e.status === 'skipped') c.skipped += 1;
          else if (e.status === 'dont_know') c.dontKnow += 1;
          else if (e.grade === 'unscorable') continue;
          else if (isPracticeOnly(e)) c.practice += 1;
          else {
            const k = `${e.questionId}@${e.questionVersion}`;
            if (a.scored.has(k)) {
              c.practice += 1;
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

  if (correct.length && incorrect.length) s.state = 'conflicting';
  else if (correct.length) {
    const hasChoice = correct.some((e) => e.format === 'single_choice');
    const hasApplication = correct.some((e) => e.format === 'single_choice' && e.questionKind === 'application');
    if (correct.length >= 2 && hasApplication) s.state = 'demonstrated';
    else if (hasChoice || correct.length >= 2) s.state = 'partial';
    else s.state = 'unknown';
  } else s.state = 'unknown';

  if (scored.length) {
    s.evidenceIds = scored.map((e) => e.id);
    s.reviewStatus = 'auto_scored';
    s.assistance = scored.reduce<Assistance>((acc, e) => (e.assistance === 'unknown' || acc === 'unknown' ? 'unknown' : acc), 'none');
    s.assessmentScope = `서로 다른 문항 ${scored.length}개 (정답 ${correct.length} · 오답 ${incorrect.length}) · 자동 채점${s.assistance === 'unknown' ? ' · 앱 밖 도움 여부는 확인할 수 없음' : ''}`;
  }

  if (a.lastCorrectionAt && (!a.lastScoredAt || a.lastCorrectionAt >= a.lastScoredAt)) {
    s.disputed = true;
    s.reviewStatus = 'disputed';
    if (s.state === 'partial' || s.state === 'demonstrated') s.state = 'conflicting';
  }
  return s;
}

export function conceptState(profile: LearnerProfile | null | undefined, conceptId: string): LearnerConceptState {
  return profile?.concepts[conceptId] ?? unknownConcept(conceptId);
}
