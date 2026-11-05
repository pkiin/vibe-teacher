import type { LearnerEvent, MemoryRecord } from '@vibe-teacher/shared';
import { maskSecrets } from '../llm/digest';
import { truncate } from '../lib/text';

const FEEDBACK_LABEL: Record<string, string> = { wrong_answer: '정답이 틀린 것 같음', ambiguous: '문제가 애매함', off_topic: '이 개념과 상관없음', other: '기타' };

/** 원장 사건의 검색 표현. AI의 해석을 사용자 숙련 사실로 저장하지 않는다. */
export function eventMemory(e: LearnerEvent, names: ReadonlyMap<string, string>): MemoryRecord | null {
  if (e.kind === 'question') return null; // 질문 본문과 답변은 help.jsonl에서 가져온다.
  const ids = e.kind === 'response' || e.kind === 'question_feedback' ? e.conceptIds : e.conceptId ? [e.conceptId] : [];
  if (!ids.length) return null;
  const label = ids.map((id) => names.get(id) ?? id).join(', ');
  let text: string;
  if (e.kind === 'response') text = `${label}: ${e.status === 'answered' ? e.grade === 'correct' ? '정답' : e.grade === 'incorrect' ? '오답' : '채점 불가' : e.status === 'dont_know' ? '모르겠어요' : '건너뜀'}. ${e.questionReview === 'candidate' || !e.firstAttempt || e.assistance === 'assisted' ? '연습 응답' : '검토된 문항 응답'}. ${e.reason ? `사용자가 쓴 이유: ${e.reason}` : ''}`;
  else if (e.kind === 'self_report') text = `${label}: 사용자가 ${e.value === 'known' ? '알고 있어요' : e.value === 'unsure' ? '잘 모르겠어요' : '처음 봐요'}라고 자기보고함. 객관적 숙련 확인과 구분.`;
  else if (e.kind === 'correction') text = `${label}: 이해 추정에 사용자 정정. ${e.note ?? ''}`;
  else if (e.kind === 'question_feedback') text = `${label}: 사용자가 연습 문제가 이상하다고 알림 (${FEEDBACK_LABEL[e.reason]}). 이 문제의 응답은 이해 증거로 쓰지 않음. ${e.note ?? ''}`;
  else if (e.kind === 'preference') text = `${label}: 사용자가 설명 깊이 ${e.depth}, 예시 ${e.examples ? '표시' : '접기'}를 선택함.`;
  else text = `${label}: 설명 열람 (${e.action}). 열람은 이해 증거가 아님.`;
  return { id: e.id, sourceId: e.id, kind: e.kind, at: e.at, conceptIds: ids, text: truncate(maskSecrets(text), 1800), ...(e.projectId ? { projectId: e.projectId } : {}), ...(e.sessionKey ? { sessionKey: e.sessionKey } : {}) };
}

/** 검색어와 글의 관련도 (0이면 관련 없음, 검색어가 없으면 1). 내 기억 검색 화면의 질문·문제 거르기에 쓴다 */
export function queryScore(query: string, text: string): number {
  const q = terms(query);
  if (!q.size) return 1;
  const t = terms(text);
  return [...q].filter((x) => t.has(x)).length / q.size;
}

/** 한국어 조사 차이를 일부 흡수하는 글자쌍 검색. 점수는 관련도이며 숙련 확률이 아니다. */
function terms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return new Set(words.flatMap((w) => /[가-힣]/.test(w) && w.length > 2 ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))] : [w]));
}

export function searchMemories(records: MemoryRecord[], input: { query: string; conceptIds?: string[]; sessionKey?: string; limit?: number }): MemoryRecord[] {
  const query = terms(input.query), ids = new Set(input.conceptIds ?? []);
  return records.map((r) => {
    const text = terms(r.text);
    const matches = [...query].filter((t) => text.has(t)).length;
    const conceptMatch = r.conceptIds.some((id) => ids.has(id));
    const relevant = !query.size && !ids.size || matches > 0 || conceptMatch;
    return { r, score: relevant ? matches / Math.max(1, query.size) + (conceptMatch ? 3 : 0) + (r.sessionKey === input.sessionKey ? 0.25 : 0) : -1 };
  }).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score || b.r.at.localeCompare(a.r.at) || a.r.id.localeCompare(b.r.id))
    .slice(0, input.limit ?? 6).map((x) => x.r);
}
