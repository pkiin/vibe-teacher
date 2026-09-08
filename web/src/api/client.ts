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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
