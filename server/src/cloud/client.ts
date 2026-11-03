import { isLoopbackHost } from '../config/env';

export interface CloudConfig {
  url: string;
  key: string;
  deployment: 'local' | 'shared';
  secure: boolean;
  publicUrl?: string;
}

/** 이메일 인증 후 돌아올 앱 주소. 임의의 경로나 토큰을 리다이렉트에 섞지 않는다. */
export function normalizeAppUrl(value: string, deployment: CloudConfig['deployment']): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('인증 후 돌아올 앱 주소를 확인하세요'); }
  const loopback = isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (deployment === 'local' && !loopback) || (deployment === 'shared' && url.protocol !== 'https:')) {
    throw new Error('인증 후 돌아올 주소는 로컬 설치의 loopback 주소 또는 공용 서버의 HTTPS 앱 주소여야 합니다');
  }
  return `${url.origin}/`;
}

export function cloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig | null {
  if (!env.VIBE_TEACHER_AUTH_MODE) return null;
  if (env.VIBE_TEACHER_AUTH_MODE !== 'supabase') throw new Error('VIBE_TEACHER_AUTH_MODE는 supabase 또는 미설정이어야 합니다');
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('Supabase 로그인에는 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY가 필요합니다');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error('SUPABASE_URL은 HTTPS 프로젝트 주소여야 합니다');
  // service_role JWT와 sb_secret_ 키를 일반 설치용 키로 잘못 사용하는 것을 막는다.
  let role: string | undefined;
  try { role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role; } catch { /* 새 공개 키는 JWT가 아니다 */ }
  if (!key.startsWith('sb_publishable_') && role !== 'anon') throw new Error('Supabase 공개 키(publishable 또는 anon)를 사용하세요');
  const deployment = env.VIBE_TEACHER_DEPLOYMENT ?? 'local';
  if (deployment !== 'local' && deployment !== 'shared') throw new Error('VIBE_TEACHER_DEPLOYMENT는 local 또는 shared여야 합니다');
  const publicUrl = env.VIBE_TEACHER_PUBLIC_URL?.trim();
  return { url, key, deployment, secure: deployment === 'shared' || env.VIBE_TEACHER_COOKIE_SECURE === '1', ...(publicUrl ? { publicUrl: normalizeAppUrl(publicUrl, deployment) } : {}) };
}

export class CloudError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** 사용자 토큰으로만 Data API를 호출한다. 관리자 키나 DB 암호를 사용하지 않는다. */
export class CloudClient {
  constructor(readonly config: CloudConfig, public accessToken = '', private readonly request: typeof fetch = fetch) {}

  async call<T>(route: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.key);
    headers.set('content-type', 'application/json');
    if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);
    let response: Response;
    try {
      response = await this.request(`${this.config.url}${route}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) });
    } catch {
      throw new CloudError(503, 'cloud_unavailable', 'Supabase에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요');
    }
    if (!response.ok) {
      // 외부 오류 본문에는 주소·토큰·SQL 정보가 들어갈 수 있어 그대로 노출하지 않는다.
      if (response.status === 429) throw new CloudError(429, 'rate_limited', '요청이 많습니다. 잠시 후 다시 시도하세요');
      if (response.status === 401 || response.status === 403) throw new CloudError(response.status, 'cloud_unauthorized', '로그인 정보 또는 접근 권한을 확인하세요');
      if (route.startsWith('/auth/')) throw new CloudError(400, 'auth_failed', '이메일과 비밀번호를 확인하세요. 가입 후에는 이메일 인증이 필요할 수 있습니다');
      throw new CloudError(503, 'cloud_storage_error', 'Supabase 저장소를 사용할 수 없습니다. 관리자에게 마이그레이션과 권한 설정 확인을 요청하세요');
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  rpc<T>(name: string, body: unknown): Promise<T> {
    return this.call<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
