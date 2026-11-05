import { isLoopbackHost } from '../config/env';
import type { CloudTableActivity, Deployment } from '@vibe-teacher/shared';
import { beginActivity } from '../lib/progress';

export interface CloudConfig {
  url: string;
  key: string;
  deployment: Deployment;
  secure: boolean;
  publicUrl?: string;
}

/** 이메일 인증 후 돌아올 앱 주소. 임의의 경로나 토큰을 리다이렉트에 섞지 않는다. */
export function normalizeAppUrl(value: string, deployment: CloudConfig['deployment']): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('인증 후 돌아올 앱 주소를 확인하세요'); }
  const loopback = isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (deployment !== 'shared' && !loopback) || (deployment === 'shared' && url.protocol !== 'https:')) {
    throw new Error('인증 후 돌아올 주소는 로컬 설치·SSH 터널 서버의 loopback 주소 또는 공용 서버의 HTTPS 앱 주소여야 합니다');
  }
  return `${url.origin}/`;
}

export function cloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig | null {
  // SSH 터널 서버를 회원 로그인 없이 띄우면 모든 접속자가 서버 실행 계정으로 보이므로 막는다.
  if (!env.VIBE_TEACHER_AUTH_MODE && env.VIBE_TEACHER_DEPLOYMENT?.trim() === 'ssh') throw new Error('VIBE_TEACHER_DEPLOYMENT=ssh는 회원 로그인(VIBE_TEACHER_AUTH_MODE=supabase)과 함께 사용하세요');
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
  const deployment = env.VIBE_TEACHER_DEPLOYMENT?.trim() || 'local';
  if (deployment !== 'local' && deployment !== 'shared' && deployment !== 'ssh') throw new Error('VIBE_TEACHER_DEPLOYMENT는 local·shared·ssh 중 하나여야 합니다');
  const publicUrl = env.VIBE_TEACHER_PUBLIC_URL?.trim();
  return { url, key, deployment, secure: deployment === 'shared' || env.VIBE_TEACHER_COOKIE_SECURE === '1', ...(publicUrl ? { publicUrl: normalizeAppUrl(publicUrl, deployment) } : {}) };
}

export class CloudError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** 사용자 토큰으로만 Data API를 호출한다. 관리자 키나 DB 암호를 사용하지 않는다. */
export class CloudClient {
  readonly since = new Date().toISOString();
  private readonly activity = new Map<string, CloudTableActivity>();
  constructor(readonly config: CloudConfig, public accessToken = '', private readonly request: typeof fetch = fetch) {}

  async call<T>(route: string, init: RequestInit = {}): Promise<T> {
    const reading = !init.method || init.method === 'GET';
    const table = route.split('?')[0]!.replace('/rest/v1/', '');
    const stat = this.activity.get(table) ?? { table, reads: 0, writes: 0, errors: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 };
    this.activity.set(table, stat);
    if (reading) stat.reads++; else stat.writes++;
    stat.requestBytes += typeof init.body === 'string' ? Buffer.byteLength(init.body) : 0;
    const at = Date.now();
    const end = beginActivity(reading ? 'reading' : 'writing', 'supabase');
    try { return await this.execute<T>(route, init, stat); }
    catch (error) { stat.errors++; throw error; }
    finally { stat.durationMs += Date.now() - at; end(); }
  }

  stats(): CloudTableActivity[] { return [...this.activity.values()].map((row) => ({ ...row })); }

  private async execute<T>(route: string, init: RequestInit, stat: CloudTableActivity): Promise<T> {
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
      // 알려진 오류 코드만 해석하고 외부 메시지·주소·토큰·SQL 상세는 노출하지 않는다.
      const details: unknown = route.startsWith('/auth/') ? await response.json().catch(() => null) : null;
      const code = details && typeof details === 'object' && 'code' in details && typeof details.code === 'string' ? details.code : undefined;
      if (response.status >= 500 && route.startsWith('/auth/')) throw new CloudError(503, 'cloud_unavailable', 'Supabase 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요');
      if (code === 'over_email_send_rate_limit') throw new CloudError(429, 'email_send_rate_limited', '인증 메일 발송 한도에 도달했거나 재요청 간격이 너무 짧습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 메일 발송 설정 확인을 요청하세요');
      if (code === 'email_address_not_authorized') throw new CloudError(400, 'email_delivery_not_configured', '현재 메일 발송 설정으로는 이 주소에 인증 메일을 보낼 수 없습니다. 관리자에게 메일 발송 설정 확인을 요청하세요');
      if (code === 'email_not_confirmed') throw new CloudError(400, 'email_not_confirmed', '이메일 인증을 먼저 완료해 주세요. 메일이 오지 않았다면 인증 메일 재발송을 요청할 수 있습니다');
      if (response.status === 429) throw new CloudError(429, 'rate_limited', '요청이 많습니다. 잠시 후 다시 시도하세요');
      if (response.status === 401 || response.status === 403) throw new CloudError(response.status, 'cloud_unauthorized', '로그인 정보 또는 접근 권한을 확인하세요');
      if (route.startsWith('/auth/v1/resend')) throw new CloudError(400, 'confirmation_resend_failed', '인증 메일을 요청하지 못했습니다. 이메일 주소를 확인하고, 이미 인증을 마쳤다면 로그인해 주세요');
      if (route.startsWith('/auth/')) throw new CloudError(400, 'auth_failed', '이메일과 비밀번호를 확인하세요. 가입 후에는 이메일 인증이 필요할 수 있습니다');
      throw new CloudError(503, 'cloud_storage_error', 'Supabase 저장소를 사용할 수 없습니다. 관리자에게 마이그레이션과 권한 설정 확인을 요청하세요');
    }
    const text = await response.text();
    stat.responseBytes += Buffer.byteLength(text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  rpc<T>(name: string, body: unknown): Promise<T> {
    return this.call<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
