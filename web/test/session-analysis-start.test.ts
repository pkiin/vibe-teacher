import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSessionAnalysis } from '../src/api/session-analysis';
import { clearApiCache } from '../src/api/client';

afterEach(() => { vi.unstubAllGlobals(); clearApiCache(); });
const actions = () => ({ wikiReady: false, force: false, onEnrichment: vi.fn(), onEnrichJob: vi.fn(), onWiki: vi.fn(), onWikiJob: vi.fn() });

describe('분석 시작 한 번으로 문서 작성', () => {
  it('처음 분석하거나 기록이 바뀌었으면 요약과 기반 문서를 함께 요청하고 각각 진행 상황을 받는다', async () => {
    const wiki = { snapshot: { revision: 'r1' }, generation: { jobId: 'analysis-job', status: 'running' } };
    const request = vi.fn(async (url: string) => Response.json(url.endsWith('/wiki/build') ? wiki : { status: 'running', jobId: 'summary-job' }));
    vi.stubGlobal('fetch', request);
    const callbacks = actions();
    expect(await startSessionAnalysis('s:1', callbacks)).toEqual([]);
    expect(request.mock.calls.map(([url]) => url).sort()).toEqual(['/api/sessions/s%3A1/enrich', '/api/sessions/s%3A1/wiki/build']);
    expect(callbacks.onEnrichJob).toHaveBeenCalledWith('summary-job');
    expect(callbacks.onWiki).toHaveBeenCalledWith(wiki);
    expect(callbacks.onWikiJob).toHaveBeenCalledWith('analysis-job');
  });

  it('저장된 동일 결과를 사용하며 명시적 다시 분석일 때만 강제 생성을 요청한다', async () => {
    const result = { sessionKey: 's1' };
    const request = vi.fn(async (url: string, _init: RequestInit) => Response.json(url.includes('/wiki/ai') ? { status: 'done', cached: true } : { status: 'done', cached: true, result }));
    vi.stubGlobal('fetch', request);
    const callbacks = { ...actions(), wikiReady: true };
    await startSessionAnalysis('s1', callbacks);
    expect(callbacks.onEnrichment).toHaveBeenCalledWith(result);
    expect(callbacks.onWiki).toHaveBeenCalledWith();
    expect(callbacks.onEnrichJob).not.toHaveBeenCalled();
    expect(request.mock.calls[1]?.[1].body).toBe(JSON.stringify({ force: false }));
    request.mockClear();
    await startSessionAnalysis('s1', { ...callbacks, force: true });
    expect(request.mock.calls[0]?.[0]).toBe('/api/sessions/s1/enrich?force=1');
    expect(request.mock.calls[1]?.[1].body).toBe(JSON.stringify({ force: true }));
  });

  it('보안·개념 분석이 실패해도 성공한 작업 요약을 보존하고 실패 사유를 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/wiki/build')
      ? Response.json({ error: { code: 'llm_unavailable', message: '연결 실패' } }, { status: 409 })
      : Response.json({ status: 'done', result: { sessionKey: 's1' } })));
    const callbacks = actions();
    expect(await startSessionAnalysis('s1', callbacks)).toEqual([{ part: 'analysis', message: '연결 실패' }]);
    expect(callbacks.onEnrichment).toHaveBeenCalledWith({ sessionKey: 's1' });
    expect(callbacks.onWiki).not.toHaveBeenCalled();
  });
});
