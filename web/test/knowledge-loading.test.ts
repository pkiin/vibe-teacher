import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeWikiResponse } from '@vibe-teacher/shared';
import { loadKnowledge, retainKnowledgeReasons } from '../src/api/knowledge';
import { clearApiCache } from '../src/api/client';
import { KnowledgeCard } from '../src/components/KnowledgeList';
import { QuizCard } from '../src/components/QuizCard';
import { askedConcept } from '../src/lib/session-analysis';
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
    expect(demonstrated.match(/문제로 확인했어요/g)).toHaveLength(1);
    const disputed = render({ ...entry, state: { ...entry.state, state: 'demonstrated', disputed: true } });
    expect(disputed.match(/더 알아보는 중/g)).toHaveLength(1);
    expect(disputed).not.toContain('문제로 확인했어요');
    // 맞힌 문제가 없으면 카운트 대신 퀴즈를 권한다
    expect(unknown).toContain('간단히 확인하기');
    expect(unknown).not.toMatch(/연습 오답|질문 \d/);
  });

  it('문제로 오른 상태에서만 "사실 아직 잘 몰라요"를, 나머지는 "잘 모르겠어요"를 보여 준다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const render = (state: Partial<KnowledgeWikiResponse['entries'][number]['state']>) => {
      const entry = view().entries[0]!;
      return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: { ...entry, state: { ...entry.state, ...state } }, learner })));
    };
    for (const state of ['partial', 'demonstrated'] as const) {
      const html = render({ state });
      expect(html).toContain('사실 아직 잘 몰라요');
      expect(html).not.toContain('잘 모르겠어요');
    }
    for (const html of [render({}), render({ state: 'conflicting' }), render({ state: 'demonstrated', disputed: true })]) {
      expect(html).toContain('잘 모르겠어요');
      expect(html).not.toMatch(/사실 아직 잘 몰라요|추정이 잘못/);
    }
    expect(render({ selfReport: 'unsure' })).toMatch(/disabled=""[^>]*>잘 모르겠어요/);
  });

  it('제목 옆에는 분류만 두고, 내 학습 상태는 학습 기록 줄에 모은다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const entry = view().entries[0]!;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: { ...entry, state: { ...entry.state, state: 'partial', selfReport: 'known', progress: 'practicing' } }, learner })));
    const head = /<div class="concept-head">(.*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(head).toContain('보안');
    expect(head).not.toMatch(/익히는 중|알고 있어요/);
    const row = /<p class="learning-status">(.*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(row).toContain('익히는 중');
    expect(row).toContain('알고 있어요');
    expect(html).not.toContain('연습하고 있어요');
    const improving = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: { ...entry, state: { ...entry.state, progress: 'improving' } }, learner })));
    expect(/<p class="learning-status">(.*?)<\/p>/.exec(improving)?.[1]).toContain('실력이 늘고 있어요');
  });

  it("'알고 있어요'는 바로 기록하지 않고 OX 확인을 열며, 확인을 마치면 버튼을 숨긴다", () => {
    const recorded: string[] = [];
    const learner = { revision: () => 0, selfReport: async (_id: string, v: string) => { recorded.push(v); } } as unknown as LearnerActions;
    const entry = view().entries[0]!;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry, learner })));
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>알고 있어요<\/button>/);
    expect(recorded).toEqual([]);
    const known = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: { ...entry, state: { ...entry.state, selfReport: 'known' } }, learner })));
    expect(known).not.toMatch(/<button[^>]*>알고 있어요<\/button>/);
    const check = renderToStaticMarkup(createElement(QuizCard, { target: { conceptId: 'auth' }, learner, explanationSeen: false, purpose: 'self_check' }));
    expect(check).toContain('나에게 꼭 맞는 문제를 만들고 있어요');
  });

  it('질문하기는 개념이 나온 분석 문서의 질문 탭으로 이어지고, 근거 세션이 없으면 보이지 않는다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const entry = view().entries[0]!;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry, learner })));
    expect(html).toContain('href="/sessions/s/analysis?ask=auth#concept-auth"');
    expect(html).toMatch(/>질문하기<\/a>/);
    const none = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(KnowledgeCard, { entry: { ...entry, sources: [] }, learner })));
    expect(none).not.toContain('질문하기');
    expect(askedConcept(new URLSearchParams('ask=auth'))).toBe('auth');
    expect(askedConcept(new URLSearchParams('ask=../x'))).toBeNull();
    expect(askedConcept(new URLSearchParams(''))).toBeNull();
  });

  it('문제를 만드는 동안 친근한 안내를 보여 준다', () => {
    const learner = { revision: () => 0 } as LearnerActions;
    const html = renderToStaticMarkup(createElement(QuizCard, { target: { conceptId: 'auth' }, learner, explanationSeen: false }));
    expect(html).toContain('나에게 꼭 맞는 문제를 만들고 있어요');
    expect(html).not.toContain('불러오는 중');
  });
});
