import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeWikiResponse } from '@vibe-teacher/shared';
import { loadKnowledge, retainKnowledgeReasons } from '../src/api/knowledge';
import { clearApiCache } from '../src/api/client';
import { KnowledgeCard } from '../src/components/KnowledgeList';
import type { LearnerActions } from '../src/hooks/useLearner';
import { profileWith } from '../../server/test/wiki/helpers';
import { unknownConcept } from '../../server/src/learner/reducer';

const reason = '로그인 기능을 만들며 권한 검사를 함께 살펴봤습니다. 이해를 확인할 응답은 아직 없습니다.';
function view(): KnowledgeWikiResponse {
  return { profile: profileWith({}), entries: [{ conceptId: 'auth', name: '인증', category: '보안', summary: '사용자가 누구인지 확인합니다.', state: unknownConcept('auth'), reason, reasonOrigin: 'llm', sources: [{ projectId: 'p', projectName: '앱', sessionKey: 's', sessionTitle: '로그인', via: 'concept_hit' }], mentions: [], priority: 'background' }], projects: [], scannedSessions: 1, totalSessions: 1, text: { generator: { kind: 'llm', provider: 'openrouter' }, missing: 0, canGenerate: false } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => clearApiCache());
afterEach(() => { clearApiCache(); vi.unstubAllGlobals(); });

describe('내 지식 다시 열기', () => {
  it('최신 스캔을 기다리는 동안 저장된 목록을 먼저 표시한다', async () => {
    const fresh = deferred<Response>(), shown = deferred<void>();
    const request = vi.fn(async (path: string) => path.includes('/saved') ? Response.json({ view: view() }) : fresh.promise);
    vi.stubGlobal('fetch', request);
    const order: string[] = [];
    const loading = loadKnowledge('', () => { order.push('saved'); shown.resolve(); }, () => { order.push('fresh'); });
    await shown.promise;
    expect(order).toEqual(['saved']);
    fresh.resolve(Response.json(view())); await loading;
    expect(order).toEqual(['saved', 'fresh']);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every((call) => !call[0].includes('/text'))).toBe(true);
  });

  it('저장된 응답이 뒤늦게 도착해도 최신 화면을 덮어쓰지 않는다', async () => {
    const saved = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/saved') ? saved.promise : Response.json(view())));
    const order: string[] = [];
    await loadKnowledge('', () => { order.push('saved'); }, () => { order.push('fresh'); });
    saved.resolve(Response.json({ view: view() }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['fresh']);
  });

  it('갱신하는 동안 이전 설명을 보여 주되 학습 상태·출처가 바뀌면 재사용하지 않는다', () => {
    const previous = view(), fresh = view();
    fresh.entries[0] = { ...fresh.entries[0]!, reason: '', reasonOrigin: 'missing' };
    const kept = retainKnowledgeReasons(previous, fresh);
    expect(kept.entries[0]?.previousReason).toBe(reason);
    const changed = structuredClone(fresh);
    changed.entries[0]!.state.selfReport = 'unsure';
    expect(retainKnowledgeReasons(previous, changed).entries[0]?.previousReason).toBeUndefined();
    const otherScope = structuredClone(fresh); otherScope.entries[0]!.sources = [];
    expect(retainKnowledgeReasons(previous, otherScope).entries[0]?.previousReason).toBeUndefined();
  });

  it('AI 작성 중에도 기존 설명과 개념 카드를 숨기지 않는다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const entry = view().entries[0]!;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry, writing: true, learner })));
    expect(html).toContain(reason); expect(html).toContain('인증');
    const pending = { ...entry, reason: '', reasonOrigin: 'missing' as const };
    const loading = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: pending, writing: true, learner })));
    expect(loading).toContain(entry.summary); expect(loading).toContain('AI가 설명을 쓰는 중');
  });

  it('상태는 배지 하나로만 보이고, 확인 기록이 없는 상태는 따로 표시하지 않는다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const render = (entry: KnowledgeWikiResponse['entries'][number]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry, learner })));
    const entry = view().entries[0]!;
    const unknown = render(entry);
    expect(unknown).not.toContain('숙련 확인 전');
    expect(unknown).toContain('<h3>인증</h3>');
    const demonstrated = render({ ...entry, state: { ...entry.state, state: 'demonstrated' } });
    expect(demonstrated.match(/푼 문제에서는 확인했어요/g)).toHaveLength(1);
    const disputed = render({ ...entry, state: { ...entry.state, state: 'demonstrated', disputed: true } });
    expect(disputed.match(/이의 제기됨/g)).toHaveLength(1);
    expect(disputed).not.toContain('푼 문제에서는 확인했어요');
  });
});
