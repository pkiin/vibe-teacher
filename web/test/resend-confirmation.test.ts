import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendConfirmation, resendSecondsRemaining } from '../src/components/ResendConfirmation';
import { EmailConfirmationPage } from '../src/pages/EmailConfirmationPage';

afterEach(() => { vi.useRealTimers(); });

describe('인증 메일 재발송 화면', () => {
  it('로그인에서 열 수 있는 도움 버튼을 표시하고 처음부터 메일을 보내지 않는다', () => {
    const html = renderToStaticMarkup(createElement(ResendConfirmation));
    expect(html).toContain('인증 메일이 안 왔어요');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('<form');
  });

  it('열린 폼은 이메일만 받고 이미 인증한 계정·스팸함·발송 제한을 안내한다', () => {
    const html = renderToStaticMarkup(createElement(ResendConfirmation, { initiallyOpen: true, initialEmail: 'user@example.test' }));
    expect(html).toContain('value="user@example.test"');
    expect(html).toContain('type="email"');
    expect(html).toContain('인증 메일 다시 받기');
    expect(html).toContain('스팸함');
    expect(html).toContain('이미 인증했다면 바로 로그인');
    expect(html).toContain('메일 발송 한도');
    expect(html).not.toContain('type="password"');
  });

  it('가입 요청 직후에는 재발송 버튼 대신 대기 시간을 표시한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));
    const requestedAt = Date.now();
    const html = renderToStaticMarkup(createElement(ResendConfirmation, { initiallyOpen: true, requestedAt }));
    expect(html).toContain('60초 후 다시 요청할 수 있어요');
    expect(html).toContain('disabled=""');
    vi.advanceTimersByTime(60_000);
    const ready = renderToStaticMarkup(createElement(ResendConfirmation, { initiallyOpen: true, requestedAt }));
    expect(ready).toContain('인증 메일 다시 받기');
    expect(ready).not.toContain('disabled=""');
  });

  it('대기 시간이 끝나기 직전에는 조기 재요청을 허용하지 않는다', () => {
    expect(resendSecondsRemaining(60_000, 59_999)).toBe(1);
    expect(resendSecondsRemaining(60_000, 60_000)).toBe(0);
    expect(resendSecondsRemaining(60_000, 61_000)).toBe(0);
  });

  it.each(['expired', 'failed'] as const)('인증 %s 화면에서 로그인과 재발송을 모두 제공한다', (status) => {
    const html = renderToStaticMarkup(createElement(EmailConfirmationPage, { status }));
    expect(html).toContain('로그인하러 가기');
    expect(html).toContain('인증 메일 다시 받기');
    expect(html).toContain('type="email"');
  });
});
