import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudClient, type CloudConfig } from '../src/cloud/client';
import { CloudStorage } from '../src/cloud/storage';

const config: CloudConfig = { url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'shared', secure: true };
const root = '/synthetic/wiki';
const file = (key: string) => path.join(root, key);
afterEach(() => vi.useRealTimers());

function remoteStore() {
  const docs = new Map<string, unknown>();
  const events: { seq: number; value: unknown }[] = [];
  const calls: { url: URL; body: unknown; token: string | null }[] = [];
  let fail = false;
  let hold: Promise<void> | undefined;
  const request = (async (input, init) => {
    const url = new URL(String(input));
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, token: new Headers(init?.headers).get('authorization') });
    if (fail) return Response.json({}, { status: 503 });
    if (url.pathname.endsWith('vt_lock')) return Response.json(true);
    if (url.pathname.endsWith('vt_unlock')) return new Response(null, { status: 204 });
    if (init?.method === 'POST') {
      if (url.pathname.endsWith('/vt_events')) events.push({ seq: events.length + 1, value: (body as { value: unknown }).value });
      else for (const row of (Array.isArray(body) ? body : [body]) as { key: string; value: unknown }[]) docs.set(row.key, row.value);
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/vt_events')) return Response.json(events.filter((row) => row.seq > Number(url.searchParams.get('seq')!.slice(3))).slice(0, 500));
    const filter = url.searchParams.get('key')!;
    // in 값은 JSON 문자열과 같은 이스케이프를 쓴다.
    const keys: string[] = filter.startsWith('eq.') ? [filter.slice(3)] : JSON.parse(`[${filter.slice(4, -1)}]`);
    const rows = keys.flatMap((key) => docs.has(key) ? [{ key, value: docs.get(key) }] : []);
    const response = Response.json(rows);
    await hold;
    return response;
  }) as typeof fetch;
  const backend = (userId = 'synthetic-user') => new CloudStorage(new CloudClient(config, `${userId}-token`, request), userId, root);
  return { docs, events, calls, backend, set fail(value: boolean) { fail = value; }, set hold(value: Promise<void> | undefined) { hold = value; } };
}

describe('Supabase 왕복·캐시 회귀', () => {
  it('80개 문서와 중복 읽기를 2회로 모으고 누락 문서도 짧게 캐시한다', async () => {
    const remote = remoteStore(), storage = remote.backend();
    for (let n = 0; n < 79; n++) remote.docs.set(`d${n}.json`, { n });
    const results = await Promise.all(Array.from({ length: 80 }, (_, n) => storage.readJson(file(`d${n}.json`))));
    expect(results[0]).toEqual({ n: 0 }); expect(results[79]).toBeNull();
    expect(remote.calls).toHaveLength(2);
    await Promise.all([storage.readJson(file('d0.json')), storage.readJson(file('d79.json'))]);
    expect(remote.calls).toHaveLength(2);
    const [a, b] = await Promise.all([storage.readJson(file('new.json')), storage.readJson(file('new.json'))]);
    expect([a, b]).toEqual([null, null]); expect(remote.calls).toHaveLength(3);
    expect(storage.activity().cache).toMatchObject({ hits: 2, coalesced: 1, batches: 3 });
  });

  it('문서 여러 개를 한 쓰기로 저장하고 캐시 반환값 수정이 저장값을 바꾸지 않는다', async () => {
    const remote = remoteStore(), storage = remote.backend();
    await storage.writeJsonBatch([{ file: file('a'), value: { n: 1 } }, { file: file('b'), value: { n: 2 } }]);
    expect(remote.calls).toHaveLength(1);
    const a = await storage.readJson<{ n: number }>(file('a'));
    a!.n = 100;
    expect(await storage.readJson(file('a'))).toEqual({ n: 1 });
    expect(remote.calls.every((call) => call.url.searchParams.get('user_id') === 'eq.synthetic-user' || !!call.body)).toBe(true);
    expect(storage.activity().tables.find((row) => row.table === 'vt_documents')).toMatchObject({ reads: 1, writes: 1, errors: 0 });
  });

  it('다른 기기의 문서 변경은 TTL 뒤에 읽고 잠금 안에서는 즉시 최신 값을 읽는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const remote = remoteStore(), storage = remote.backend();
    remote.docs.set('a', { revision: 1 });
    await storage.readJson(file('a'));
    remote.docs.set('a', { revision: 2 });
    expect(await storage.readJson(file('a'))).toEqual({ revision: 1 });
    expect(await storage.lock('test', () => storage.readJson(file('a')))).toEqual({ revision: 2 });
    await storage.readJson(file('a'));
    remote.docs.set('a', { revision: 3 });
    vi.advanceTimersByTime(5_001);
    expect(await storage.readJson(file('a'))).toEqual({ revision: 3 });
  });

  it('쓰기와 겹친 예전 읽기 응답이 최신 값을 캐시에 덮어쓰지 않는다', async () => {
    const remote = remoteStore(), storage = remote.backend();
    remote.docs.set('a', { revision: 1 });
    let release!: () => void;
    remote.hold = new Promise((resolve) => { release = resolve; });
    const old = storage.readJson(file('a'));
    await Promise.resolve();
    await storage.writeJson(file('a'), { revision: 2 });
    release(); await old;
    remote.hold = undefined;
    expect(await storage.readJson(file('a'))).toEqual({ revision: 2 });
  });

  it('추가 전용 원장은 500행 페이지를 빠짐없이 읽고 다음 조회에는 새 행만 가져온다', async () => {
    const remote = remoteStore(), storage = remote.backend();
    for (let n = 0; n < 1002; n++) remote.events.push({ seq: n + 1, value: { n } });
    expect((await storage.readJsonl(file('events.jsonl'))).items).toHaveLength(1002);
    expect(remote.calls).toHaveLength(3);
    expect((await storage.readJsonl(file('events.jsonl'))).items).toHaveLength(1002);
    expect(remote.calls).toHaveLength(3);
    await storage.appendJsonl(file('events.jsonl'), { n: 1002 });
    expect((await storage.readJsonl(file('events.jsonl'))).items).toHaveLength(1003);
    expect(remote.calls.at(-1)!.url.searchParams.get('seq')).toBe('gt.1002');
  });

  it('저장 실패는 성공 캐시로 숨기지 않고 재시도하며 사용자별 캐시를 분리한다', async () => {
    const remote = remoteStore(), alice = remote.backend('alice'), bob = remote.backend('bob');
    await alice.readJson(file('a'));
    await bob.readJson(file('a'));
    expect(remote.calls.map((call) => call.token)).toEqual(['Bearer alice-token', 'Bearer bob-token']);
    remote.fail = true;
    await expect(alice.writeJson(file('a'), 3)).rejects.toMatchObject({ status: 503 });
    await expect(alice.readJson(file('a'))).rejects.toMatchObject({ status: 503 });
    remote.fail = false; remote.docs.set('a', 4);
    expect(await alice.readJson(file('a'))).toBe(4);
    expect(alice.activity().tables[0]).toMatchObject({ errors: 2 });
  });

  it('여러 키의 PostgREST 필터에서 예약 문자·따옴표를 보존한다', async () => {
    const remote = remoteStore(), storage = remote.backend();
    const keys = ['a,(b).json', 'a"quote.json', '역슬래시\\a.json'];
    for (const key of keys) remote.docs.set(key, key);
    expect(await Promise.all(keys.map((key) => storage.readJson(file(key))))).toEqual(keys);
    expect(remote.calls).toHaveLength(1);
  });
});
