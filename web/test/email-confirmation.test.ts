import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EmailConfirmationResponse } from '@vibe-teacher/shared';
import { ApiError } from '../src/api/client';
import { startEmailConfirmation, type EmailConfirmationStatus } from '../src/auth/email-confirmation';
import { EmailConfirmationPage } from '../src/pages/EmailConfirmationPage';
import { App } from '../src/App';

const callback = 'http://localhost:3317/#access_token=synthetic-access&refresh_token=synthetic-refresh&token_type=bearer&type=signup';
function browser(href = callback) {
  const location = { href };
  const history = { state: { retained: true }, replaceState: vi.fn((_state: unknown, _title: string, next?: string | URL | null) => { location.href = new URL(String(next), location.href).href; }) };
  return { location, history };
}

describe('메일 인증 결과 처리', () => {
  it('요청 전에 토큰을 주소에서 지우고 서버에서 확인한 결과만 완료로 표시한다', async () => {
    const b = browser();
    const verify = vi.fn(async (accessToken: string): Promise<EmailConfirmationResponse> => {
      expect(b.location.href).toBe('http://localhost:3317/');
      expect(accessToken).toBe('synthetic-access');
      return { confirmed: true };
    });
    const result = startEmailConfirmation(b.location, b.history, verify);
    expect(verify).not.toHaveBeenCalled();
    expect(b.history.replaceState).toHaveBeenCalledWith({ retained: true }, '', '/');
    expect(await result).toBe('confirmed');
    expect(verify).toHaveBeenCalledExactlyOnceWith('synthetic-access');
    expect(startEmailConfirmation(b.location, b.history, verify)).toBeNull();
  });

  it('기존 앱 경로와 일반 쿼리는 보존하고 쿼리에 섞인 인증 비밀값도 지운다', async () => {
    const b = browser('https://app.example.test/?keep=1&refresh_token=query-secret#access_token=synthetic-access&type=signup&refresh_token=synthetic-refresh');
    expect(await startEmailConfirmation(b.location, b.history, async () => ({ confirmed: true }))).toBe('confirmed');
    expect(b.location.href).toBe('https://app.example.test/?keep=1');
  });

  it('실제 클라이언트는 access token만 POST 본문으로 보내고 저장소에는 남기지 않는다', async () => {
    const b = browser();
    const request = vi.fn<typeof fetch>(async () => Response.json({ confirmed: true }));
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('localStorage', storage);
    try {
      expect(await startEmailConfirmation(b.location, b.history)).toBe('confirmed');
      expect(request).toHaveBeenCalledTimes(1);
      const [url, init] = request.mock.calls[0]!;
      expect(url).toBe('/api/auth/email-confirmation');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ accessToken: 'synthetic-access' });
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['#error=access_denied&error_code=otp_expired&error_description=private-detail', 'expired'],
    ['?error=access_denied&error_code=otp_expired&error_description=private-detail', 'expired'],
    ['#error=access_denied&error_description=private-detail', 'failed'],
  ])('외부 오류 %s를 안전한 결과로 바꾸고 원문은 URL에서 제거한다', async (suffix, expected) => {
    const b = browser(`http://localhost:3317/${suffix}`);
    const verify = vi.fn();
    expect(await startEmailConfirmation(b.location, b.history, verify)).toBe(expected);
    expect(verify).not.toHaveBeenCalled();
    expect(b.location.href).toBe('http://localhost:3317/');
  });

  it.each([
    '#type=signup',
    '#refresh_token=synthetic-refresh&type=signup',
    '#access_token=synthetic-access',
    '#access_token=synthetic-access&type=recovery',
    '#access_token=synthetic-access&type=invite',
    '#access_token=synthetic-access&type=signup&token_type=other',
    '?code=synthetic-code',
    '?access_token=synthetic-access&type=signup',
  ])('확인할 수 없는 콜백 %s를 성공으로 표시하거나 로그인에 사용하지 않는다', async (suffix) => {
    const b = browser(`http://localhost:3317/${suffix}`);
    const verify = vi.fn();
    expect(await startEmailConfirmation(b.location, b.history, verify)).toBe('failed');
    expect(verify).not.toHaveBeenCalled();
    expect(b.location.href).toBe('http://localhost:3317/');
  });

  it.each([
    [new ApiError(401, 'cloud_unauthorized', 'private-detail'), 'expired'],
    [new ApiError(403, 'cloud_unauthorized', 'private-detail'), 'expired'],
    [new ApiError(422, 'email_not_confirmed', 'private-detail'), 'failed'],
    [new ApiError(503, 'cloud_unavailable', 'private-detail'), 'unavailable'],
    [new ApiError(429, 'rate_limited', 'private-detail'), 'unavailable'],
    [new TypeError('Failed to fetch'), 'unavailable'],
  ])('검증 실패와 연결 장애를 구분한다: %s', async (error, expected) => {
    const b = browser();
    expect(await startEmailConfirmation(b.location, b.history, async () => { throw error; })).toBe(expected);
    expect(b.location.href).toBe('http://localhost:3317/');
  });

  it('서버가 완료를 확인하지 않은 응답을 성공으로 바꾸지 않는다', async () => {
    const b = browser();
    expect(await startEmailConfirmation(b.location, b.history, async () => ({ confirmed: false } as unknown as EmailConfirmationResponse))).toBe('failed');
  });

  it('일반 방문이나 URL의 완료 주장만으로 결과 화면을 만들지 않는다', () => {
    for (const href of ['http://localhost:3317/', 'http://localhost:3317/accounts#section', 'http://localhost:3317/?confirmed=true']) {
      const b = browser(href);
      const verify = vi.fn();
      expect(startEmailConfirmation(b.location, b.history, verify)).toBeNull();
      expect(b.history.replaceState).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    }
  });
});

describe('메일 인증 결과 화면', () => {
  const render = (status: EmailConfirmationStatus) => renderToStaticMarkup(createElement(EmailConfirmationPage, { status }));

  it('완료 안내와 비밀번호 로그인으로 이어지는 버튼을 표시한다', () => {
    const html = render('confirmed');
    expect(html).toContain('메일 인증이 완료되었습니다');
    expect(html).toContain('가입하신 이메일과 비밀번호로 다시 로그인해 주세요.');
    expect(html).toContain('로그인하러 가기');
    expect(html).toContain('href="/"');
    expect(html).toContain('회원가입 진행 단계');
    expect(html).not.toContain('type="password"');
  });

  it('검증 중에는 완료를 표시하지 않고 기다리는 상태를 알린다', () => {
    const html = render('checking');
    expect(html).toContain('메일 인증을 확인하고 있습니다');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('메일 인증이 완료되었습니다');
    expect(html).not.toContain('로그인하러 가기');
  });

  it('로그인 상태 조회를 기다리지 않고 앱 진입부터 인증 결과 화면을 연다', () => {
    const html = renderToStaticMarkup(createElement(App, { emailConfirmation: Promise.resolve('confirmed' as const) }));
    expect(html).toContain('메일 인증을 확인하고 있습니다');
    expect(html).not.toContain('서버에 연결하지 못했습니다');
    expect(html).not.toContain('type="password"');
  });

  it.each(['expired', 'failed', 'unavailable'] as const)('%s 상태는 완료와 구분하고 로그인 화면으로 이어진다', (status) => {
    const html = render(status);
    expect(html).toContain('role="alert"');
    expect(html).toContain('로그인하러 가기');
    expect(html).not.toContain('메일 인증이 완료되었습니다');
    expect(html).not.toContain('synthetic-access');
    expect(html).not.toContain('synthetic-refresh');
    expect(html).not.toContain('private-detail');
  });
});
