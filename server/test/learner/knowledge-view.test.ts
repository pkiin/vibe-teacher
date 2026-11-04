import { describe, expect, it } from 'vitest';
import { KnowledgeViewService, type KnowledgeViewScope } from '../../src/learner/knowledge-view';
import { WikiStorage, type StorageBackend } from '../../src/storage/store';
import { profileWith } from '../wiki/helpers';

function setup() {
  const documents = new Map<string, unknown>();
  let writes = 0;
  const backend: StorageBackend = {
    readJson: async <T>(file: string) => structuredClone(documents.get(file) ?? null) as T | null,
    writeJson: async (file, value) => { documents.set(file, structuredClone(value)); writes++; },
    appendJsonl: async () => {}, readJsonl: async () => ({ items: [], warnings: [] }), lock: (_key, fn) => fn(),
  };
  const storage = new WikiStorage('/synthetic/app', undefined, backend);
  const view = new KnowledgeViewService(storage);
  const scope: KnowledgeViewScope = { level: 'non-dev', accountIds: ['a', 'b'] };
  const base = { concepts: {}, profile: profileWith({}), entries: [], projects: [], scannedSessions: 1, totalSessions: 1 };
  return { view, scope, base, storage, countWrites: () => writes };
}

describe('내 지식 저장된 목록', () => {
  it('같은 목록을 다시 저장하지 않고 서비스 재생성 뒤에도 바로 읽는다', async () => {
    const f = setup();
    expect(await f.view.read('l_one', f.scope)).toBeNull();
    await f.view.save('l_one', f.scope, f.base);
    await f.view.save('l_one', { ...f.scope, accountIds: ['b', 'a'] }, f.base);
    expect(f.countWrites()).toBe(1);
    expect(await new KnowledgeViewService(f.storage).read('l_one', f.scope)).toEqual(f.base);
  });

  it('회원·수준·계정 권한·프로젝트·세션 범위를 섞지 않는다', async () => {
    const f = setup(); await f.view.save('l_one', f.scope, f.base);
    expect(await f.view.read('l_other', f.scope)).toBeNull();
    for (const scope of [{ ...f.scope, level: 'senior' as const }, { ...f.scope, accountIds: ['a'] }, { ...f.scope, projectId: 'p' }, { ...f.scope, sessionKey: 'session' }]) {
      expect(await f.view.read('l_one', scope)).toBeNull();
    }
  });

  it('늦게 끝난 예전 조립이 최근 학습 활동의 목록을 덮어쓰지 않는다', async () => {
    const f = setup();
    const recent = { ...f.base, profile: { ...f.base.profile, revision: 2, activityRevision: 3 } };
    await f.view.save('l_one', f.scope, recent);
    await f.view.save('l_one', f.scope, { ...f.base, profile: { ...f.base.profile, revision: 1, activityRevision: 2 } });
    expect((await f.view.read('l_one', f.scope))?.profile.revision).toBe(2);
    expect(f.countWrites()).toBe(1);
  });
});
