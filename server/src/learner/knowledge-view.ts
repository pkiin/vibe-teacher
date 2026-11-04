import path from 'node:path';
import type { KnowledgeWikiResponse, ReaderLevel } from '@vibe-teacher/shared';
import { shortId } from '../lib/hash';
import type { WikiStorage } from '../storage/store';

type KnowledgeBase = Omit<KnowledgeWikiResponse, 'text'>;
export interface KnowledgeViewScope {
  level: ReaderLevel;
  projectId?: string;
  sessionKey?: string;
  /** 같은 회원이라도 접근 가능한 계정이 바뀌면 이전 보기를 재사용하지 않는다. */
  accountIds: string[];
}
interface SavedView { version: 1; hash: string; base: KnowledgeBase }

/** 내 지식의 마지막 목록. 원장 대신 사용하지 않고 매번 현재 학습 상태를 다시 입힌다. */
export class KnowledgeViewService {
  constructor(private readonly storage: WikiStorage) {}

  private file(learnerId: string, scope: KnowledgeViewScope): string {
    const key = shortId(JSON.stringify({ level: scope.level, projectId: scope.projectId ?? '', sessionKey: scope.sessionKey ?? '', accountIds: [...scope.accountIds].sort() }), 24);
    return path.join(this.storage.learnerDir(learnerId), 'knowledge-views', `${key}.json`);
  }

  async read(learnerId: string, scope: KnowledgeViewScope): Promise<KnowledgeBase | null> {
    const saved = await this.storage.readJson<SavedView>(this.file(learnerId, scope));
    return saved?.version === 1 ? saved.base : null;
  }

  async save(learnerId: string, scope: KnowledgeViewScope, base: KnowledgeBase): Promise<void> {
    const file = this.file(learnerId, scope);
    const hash = shortId(JSON.stringify(base), 32);
    const current = await this.storage.readJson<SavedView>(file);
    if (current?.version === 1 && current.hash === hash) return;
    await this.storage.lock(`knowledge-view:${shortId(file, 32)}`, async () => {
      const latest = await this.storage.readJson<SavedView>(file);
      if (latest?.version === 1 && (latest.hash === hash || (latest.base.profile.activityRevision ?? latest.base.profile.revision) > (base.profile.activityRevision ?? base.profile.revision))) return;
      await this.storage.writeJson(file, { version: 1, hash, base } satisfies SavedView);
    });
  }
}
