export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'vibe-teacher.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  clearApiCache();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

const cache = new Map<string, { value: unknown; until: number; bytes: number }>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;
let cacheBytes = 0;
const MAX_BYTES = 8 * 1024 * 1024;
export function clearApiCache(): void { cache.clear(); pending.clear(); cacheBytes = 0; generation++; }

export interface ApiActivity { reads: number; writes: number }
let activity: ApiActivity = { reads: 0, writes: 0 };
const activityListeners = new Set<Listener>();
export function onApiActivity(listener: Listener): () => void { activityListeners.add(listener); return () => activityListeners.delete(listener); }
export function getApiActivity(): ApiActivity { return activity; }
function changeActivity(kind: keyof ApiActivity, delta: number) {
  activity = { ...activity, [kind]: Math.max(0, activity[kind] + delta) };
  activityListeners.forEach((listener) => listener());
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const reading = !init.method || init.method === 'GET';
  const eligible = reading && !init.signal && !init.headers && !init.body && init.cache !== 'no-store'
    && !/\/auth(?:\/|$)|\/jobs(?:\/|$)|-jobs(?:\/|$)|\/source(?:\?|$)|\/preview(?:\?|$)|\/health$|\/storage$/.test(path);
  if (eligible) {
    const hit = cache.get(path);
    if (hit && hit.until > Date.now()) return structuredClone(hit.value) as T;
    const existing = pending.get(path);
    if (existing) return structuredClone(await existing) as T;
  }
  if (!reading) clearApiCache();
  const version = generation;
  const kind = reading ? 'reads' : 'writes';
  // 폴링 자체는 화면의 데이터 대기 표시를 깜빡이게 하지 않는다.
  const visible = !/\/jobs(?:\/|$)|-jobs(?:\/|$)|\/storage$/.test(path);
  if (visible) changeActivity(kind, 1);
  const request = requestApi<T>(path, init).then((value) => {
    if (eligible && generation === version) {
      const bytes = (JSON.stringify(value)?.length ?? 0) * 2;
      const old = cache.get(path);
      if (old) cacheBytes -= old.bytes;
      cache.delete(path);
      if (bytes <= MAX_BYTES) {
        cache.set(path, { value: structuredClone(value), until: Date.now() + 5_000, bytes });
        cacheBytes += bytes;
      }
      while (cache.size > 150 || cacheBytes > MAX_BYTES) {
        const first = cache.keys().next().value!;
        cacheBytes -= cache.get(first)!.bytes;
        cache.delete(first);
      }
    }
    return value;
  }).finally(() => {
    if (pending.get(path) === request) pending.delete(path);
    if (!reading) clearApiCache();
    if (visible) changeActivity(kind, -1);
  });
  if (eligible) pending.set(path, request);
  return structuredClone(await request);
}

async function requestApi<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401) { clearApiCache(); unauthorizedListeners.forEach((fn) => fn()); }
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
