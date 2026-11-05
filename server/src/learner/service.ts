import fs from 'node:fs/promises';
import path from 'node:path';
import type { LearnerEvent, LearnerProfile, QuestionBankEntry, WikiConcept } from '@vibe-teacher/shared';
import { shortId } from '../lib/hash';
import type { WikiStorage } from '../storage/store';
import { isStateEvent, reduceProfile } from './reducer';

/** 인증된 사용자명에서 만든 불투명 학습자 ID. 요청 본문의 값으로 바꿀 수 없다. */
export function learnerIdFor(username: string): string {
  return `l_${shortId(`learner:${username}`, 16)}`;
}

/** app.onError 가 { status, code } 로 409 응답을 만든다 */
export class RevisionConflictError extends Error {
  readonly status = 409;
  readonly code = 'revision_conflict';
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super('다른 곳에서 내 이해 정보가 먼저 바뀌었습니다. 새로 불러온 뒤 다시 시도하세요.');
  }
}

export type EventDraft = LearnerEvent extends infer E ? (E extends LearnerEvent ? Omit<E, 'profileRevision'> : never) : never;

export interface RememberedConcept {
  concept: WikiConcept;
  sources: { projectId: string; sessionKey: string }[];
}

/**
 * 사용자 한 명의 이해 정보 원장 (프로젝트를 가리지 않음):
 *   wiki/learners/<learnerId>/events.jsonl   추가만 하는 원장 (이벤트마다 projectId·sessionKey 를 남김)
 *   wiki/learners/<learnerId>/profile.json   파생 캐시
 *   wiki/learners/<learnerId>/question-bank.jsonl   정답이 공개된 연습 문제 (추가만, 같은 문제는 마지막 줄이 현재)
 * 예전에 프로젝트별로 쓴 learners/<id>/projects/<p>/events.jsonl 도 함께 읽는다.
 */
export class LearnerService {
  constructor(private readonly storage: WikiStorage) {}

  private files(learnerId: string) {
    const dir = this.storage.learnerDir(learnerId);
    return { dir, events: path.join(dir, 'events.jsonl'), profile: path.join(dir, 'profile.json'), bank: path.join(dir, 'question-bank.jsonl') };
  }

  /**
   * 문제 은행에 추가한다. 정답이 이미 공개된 문제만 넣어야 한다 (assessment respond 에서 reveal 뒤에만 호출).
   * 원장과 같은 저장소(회원 모드는 사용자 토큰의 Supabase)에 남는다.
   */
  async saveQuestion(learnerId: string, entry: QuestionBankEntry): Promise<void> {
    await this.storage.appendJsonl(this.files(learnerId).bank, entry);
  }

  /** 문제 은행 (같은 문제·판은 마지막 기록, 최근에 푼 순서) */
  async questionBank(learnerId: string): Promise<QuestionBankEntry[]> {
    const latest = new Map<string, QuestionBankEntry>();
    for (const q of (await this.storage.readJsonl<QuestionBankEntry>(this.files(learnerId).bank)).items) latest.set(`${q.questionId}@${q.version}`, q);
    return [...latest.values()].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt) || a.questionId.localeCompare(b.questionId));
  }

  async events(learnerId: string): Promise<LearnerEvent[]> {
    const files = this.files(learnerId);
    const all = [...(await this.storage.readJsonl<LearnerEvent>(files.events)).items];
    let legacy: string[] = [];
    try {
      legacy = this.storage.backend ? [] : await fs.readdir(path.join(files.dir, 'projects'));
    } catch {
      legacy = [];
    }
    for (const events of await Promise.all(legacy.map((p) => this.storage.readJsonl<LearnerEvent>(path.join(files.dir, 'projects', p, 'events.jsonl'))))) all.push(...events.items);
    const seen = new Set<string>();
    return all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.at.localeCompare(b.at));
  }

  async profile(learnerId: string): Promise<LearnerProfile> {
    return reduceProfile(await this.events(learnerId), learnerId);
  }

  async concepts(learnerId: string): Promise<Record<string, RememberedConcept>> {
    return (await this.storage.readJson<Record<string, RememberedConcept>>(path.join(this.files(learnerId).dir, 'concepts.json'))) ?? {};
  }

  /** 사용자가 접한 개념의 정의와 범위를 보존한다. 최근 세션 검색 범위에서 빠져도 다시 연결한다. */
  async rememberConcepts(learnerId: string, concepts: Iterable<WikiConcept>, source?: { projectId: string; sessionKey: string }): Promise<void> {
    await this.storage.lock(`learner-concepts:${learnerId}`, async () => {
      const saved = await this.concepts(learnerId);
      for (const concept of concepts) {
        const sources = saved[concept.id]?.sources ?? [];
        if (source && !sources.some((s) => s.sessionKey === source.sessionKey && s.projectId === source.projectId)) sources.push(source);
        saved[concept.id] = { concept, sources };
      }
      await this.storage.writeJson(path.join(this.files(learnerId).dir, 'concepts.json'), saved);
    });
  }

  /**
   * 이벤트 하나를 원장에 추가한다.
   * - 상태 이벤트는 baseRevision 이 현재 revision 과 같아야 한다 (오래된 상태 위에 덮어쓰지 않음).
   * - 같은 id 의 이벤트가 이미 있으면 다시 쓰지 않고 그 결과를 돌려준다 (재시도 중복 방지).
   */
  async record(
    learnerId: string,
    baseRevision: number | null,
    draft: EventDraft | ((profile: LearnerProfile) => EventDraft),
  ): Promise<{ event: LearnerEvent; profile: LearnerProfile; duplicate: boolean }> {
    const files = this.files(learnerId);
    return this.storage.lock(`learner:${learnerId}`, async () => {
      const events = await this.events(learnerId);
      const current = reduceProfile(events, learnerId);
      const made = typeof draft === 'function' ? draft(current) : draft;
      const existing = events.find((e) => e.id === made.id);
      if (existing) return { event: existing, profile: current, duplicate: true };
      const event = { ...made, profileRevision: current.revision } as LearnerEvent;
      if (isStateEvent(event) && baseRevision !== current.revision) throw new RevisionConflictError(current.revision, baseRevision ?? -1);
      await this.storage.appendJsonl(files.events, event);
      const profile = reduceProfile([...events, event], learnerId);
      await this.storage.writeJson(files.profile, profile);
      return { event, profile, duplicate: false };
    });
  }
}
