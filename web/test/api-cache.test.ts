import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiPost, clearApiCache, getApiActivity, setToken } from '../src/api/client';

beforeEach(() => clearApiCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); clearApiCache(); });

describe('브라우저 읽기 캐시', () => {
  it('동시 GET을 합치고 결과를 재사용하며 반환값은 서로 수정하지 못한다', async () => {
    const request = vi.fn(async () => Response.json({ value: 1 }));
    vi.stubGlobal('fetch', request);
    const [a, b] = await Promise.all([api<{ value: number }>('/api/projects/p'), api<{ value: number }>('/api/projects/p')]);
    a.value = 100;
    expect(b.value).toBe(1);
    expect(await api('/api/projects/p')).toEqual({ value: 1 });
    expect(request).toHaveBeenCalledOnce();
    expect(getApiActivity()).toEqual({ reads: 0, writes: 0 });
  });

  it('쓰기·계정 변경·명시적 새로고침은 이전 캐시를 사용하지 않는다', async () => {
    let revision = 1;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') revision++;
      return Response.json({ revision });
    });
    vi.stubGlobal('fetch', request);
    await api('/api/me/prefs');
    await apiPost('/api/me/prefs', {});
    expect(await api('/api/me/prefs')).toEqual({ revision: 2 });
    await api('/api/me/prefs', { cache: 'no-store' });
    setToken('synthetic-token');
    await api('/api/me/prefs');
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('이전 계정의 늦은 응답·실패는 캐시를 되살리지 않는다', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) { await waiting; return Response.json({ owner: 'old' }); }
      return Response.json({ owner: 'new' });
    }));
    const old = api('/api/me/profile');
    clearApiCache();
    expect(await api('/api/me/profile')).toEqual({ owner: 'new' });
    finish(); await old;
    expect(await api('/api/me/profile')).toEqual({ owner: 'new' });
    expect(calls).toBe(2);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 401 })));
    await expect(api('/api/fail')).rejects.toMatchObject({ status: 401 });
    expect(getApiActivity()).toEqual({ reads: 0, writes: 0 });
  });

  it('TTL·작업 폴링·인증·원문·전송 미리보기는 새 값을 요청한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const request = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', request);
    await api('/api/projects/p'); await api('/api/projects/p');
    vi.advanceTimersByTime(5_001); await api('/api/projects/p');
    expect(request).toHaveBeenCalledTimes(2);
    const paths = ['/api/auth/me', '/api/jobs/j', '/api/projects/p/repo-wiki/jobs/j', '/api/projects/p/repo-wiki/feature-jobs/j', '/api/projects/p/repo-wiki/source?path=a', '/api/projects/p/repo-wiki/ai/preview'];
    for (const route of paths) { await api(route); await api(route); }
    expect(request).toHaveBeenCalledTimes(2 + paths.length * 2);
  });
});
