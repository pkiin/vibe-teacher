import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuth } from '../../src/auth/supabase';
import { CloudError, cloudConfig, normalizeAppUrl, type CloudConfig } from '../../src/cloud/client';

function fixture(overrides: Partial<CloudConfig> = {}) {
  const config: CloudConfig = { url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'local', secure: false, ...overrides };
  const request = vi.fn<typeof fetch>(async () => Response.json({ user: { id: 'synthetic-user' } }));
  const auth = new SupabaseAuth(config, '/synthetic/vibe-teacher', request);
  const app = new Hono();
  app.onError((error, c) => c.json({ error: { message: error.message } }, error instanceof CloudError ? error.status as 422 : 500));
  app.post('/signup', async (c) => {
    const body = await c.req.json<{ email: string; password: string }>();
    return c.json(await auth.signup(c, body.email, body.password), 201);
  });
  app.post('/resend', async (c) => c.json(await auth.resendConfirmation(c, 'user@example.test')));
  const signup = (url: string, origin?: string) => app.request(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ email: 'user@example.test', password: 'synthetic-password' }),
  });
  const redirectTo = () => new URL(String(request.mock.calls[0]?.[0])).searchParams.get('redirect_to');
  const resend = (url: string, origin?: string) => app.request(url, { method: 'POST', headers: { ...(origin ? { origin } : {}) } });
  return { signup, resend, request, redirectTo };
}

describe('이메일 인증 후 앱으로 돌아오기', () => {
  it('재발송도 브라우저의 웹 포트로 돌아오며 비밀번호나 관리자 키를 요구하지 않는다', async () => {
    const f = fixture();
    const response = await f.resend('http://127.0.0.1:3318/resend', 'http://localhost:3317');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requested: true, retryAfterSeconds: 60 });
    expect(f.redirectTo()).toBe('http://localhost:3317/');
    const [input, init] = f.request.mock.calls[0]!;
    expect(new URL(String(input)).pathname).toBe('/auth/v1/resend');
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'signup', email: 'user@example.test' });
    expect(new Headers(init?.headers).get('apikey')).toBe('sb_publishable_test');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('공용 서버의 재발송은 설정한 공개 주소를 사용한다', async () => {
    const f = fixture({ deployment: 'shared', secure: true, publicUrl: 'https://app.example.test/' });
    expect((await f.resend('http://internal:3318/resend', 'https://other.example.test')).status).toBe(200);
    expect(f.redirectTo()).toBe('https://app.example.test/');
  });

  it('재발송에서도 설치 방식과 맞지 않는 주소를 메일 발송 전에 거절한다', async () => {
    for (const [deployment, origin] of [['local', 'https://other.example.test'], ['shared', 'http://localhost:3317']] as const) {
      const f = fixture({ deployment });
      expect((await f.resend('http://127.0.0.1:3318/resend', origin)).status).toBe(422);
      expect(f.request).not.toHaveBeenCalled();
    }
  });

  it.each(['http://127.0.0.1:5173', 'http://localhost:3050', 'http://[::1]:5173'])('웹 Origin %s의 호스트와 포트를 개발 프록시 뒤에서도 보존한다', async (origin) => {
    const f = fixture();
    const response = await f.signup('http://127.0.0.1:8787/signup', origin);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ confirmationRequired: true });
    expect(f.redirectTo()).toBe(`${origin}/`);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('HTTPS 프록시 뒤에서는 설정한 공개 주소를 우선한다', async () => {
    const f = fixture({ deployment: 'shared', secure: true, publicUrl: 'https://app.example.test/' });
    expect((await f.signup('http://internal:8787/signup', 'https://other.example.test')).status).toBe(201);
    expect(f.redirectTo()).toBe('https://app.example.test/');
  });

  it('Origin이 없는 직접 호출은 요청 URL의 앱 주소를 사용한다', async () => {
    const f = fixture();
    expect((await f.signup('http://127.0.0.1:8787/signup')).status).toBe(201);
    expect(f.redirectTo()).toBe('http://127.0.0.1:8787/');
  });

  it('로컬 설치는 외부 주소로 인증 메일을 보내지 않는다', async () => {
    const f = fixture();
    expect((await f.signup('http://127.0.0.1:8787/signup', 'https://other.example.test')).status).toBe(422);
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['http://app.example.test/', 'https://user:password@app.example.test/', 'https://app.example.test/?token=synthetic', 'https://app.example.test/#access_token=synthetic', 'javascript:alert(1)', 'https://app.example.test/nested'])('공용 서버의 잘못된 복귀 주소 %s를 거절한다', (url) => {
    expect(() => normalizeAppUrl(url, 'shared')).toThrow();
  });

  it('환경변수의 복귀 주소도 설치 방식에 맞게 검사한다', () => {
    const env = { VIBE_TEACHER_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
    expect(cloudConfig({ ...env, VIBE_TEACHER_PUBLIC_URL: 'http://localhost:5173' })).toMatchObject({ publicUrl: 'http://localhost:5173/' });
    expect(() => cloudConfig({ ...env, VIBE_TEACHER_PUBLIC_URL: 'https://other.example.test' })).toThrow();
  });
});
