import path from 'node:path';
import type { LearnerEvent, LearnerProfile } from '@vibe-teacher/shared';
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

export class LearnerService {
  constructor(private readonly storage: WikiStorage) {}

  private files(learnerId: string, projectId: string) {
    const dir = this.storage.learnerProjectDir(learnerId, projectId);
    return { events: path.join(dir, 'events.jsonl'), profile: path.join(dir, 'profile.json') };
  }

  async events(learnerId: string, projectId: string): Promise<LearnerEvent[]> {
    return (await this.storage.readJsonl<LearnerEvent>(this.files(learnerId, projectId).events)).items;
  }

  async profile(learnerId: string, projectId: string): Promise<LearnerProfile> {
    return reduceProfile(await this.events(learnerId, projectId), learnerId, projectId);
  }

  /**
   * 이벤트 하나를 원장에 추가한다.
   * - 상태 이벤트는 baseRevision 이 현재 revision 과 같아야 한다 (오래된 상태 위에 덮어쓰지 않음).
   * - 같은 id 의 이벤트가 이미 있으면 다시 쓰지 않고 그 결과를 돌려준다 (재시도 중복 방지).
   */
  async record(
    learnerId: string,
    projectId: string,
    baseRevision: number | null,
    draft: EventDraft | ((profile: LearnerProfile) => EventDraft),
  ): Promise<{ event: LearnerEvent; profile: LearnerProfile; duplicate: boolean }> {
    const files = this.files(learnerId, projectId);
    return this.storage.lock(`learner:${learnerId}:${projectId}`, async () => {
      const events = await this.events(learnerId, projectId);
      const current = reduceProfile(events, learnerId, projectId);
      const made = typeof draft === 'function' ? draft(current) : draft;
      const existing = events.find((e) => e.id === made.id);
      if (existing) return { event: existing, profile: current, duplicate: true };
      const event = { ...made, profileRevision: current.revision } as LearnerEvent;
      if (isStateEvent(event) && baseRevision !== current.revision) throw new RevisionConflictError(current.revision, baseRevision ?? -1);
      await this.storage.appendJsonl(files.events, event);
      const profile = reduceProfile([...events, event], learnerId, projectId);
      await this.storage.writeJson(files.profile, profile);
      return { event, profile, duplicate: false };
    });
  }
}
