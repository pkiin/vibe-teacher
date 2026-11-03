import type { EmailConfirmationResponse } from '@vibe-teacher/shared';
import { ApiError, apiPost } from '../api/client';

export type EmailConfirmationResult = 'confirmed' | 'expired' | 'failed' | 'unavailable';
export type EmailConfirmationStatus = 'checking' | EmailConfirmationResult;

const CALLBACK_KEYS = ['access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type', 'error', 'error_code', 'error_description', 'code', 'token_hash', 'provider_token', 'provider_refresh_token'];
function isCallback(params: URLSearchParams): boolean {
  return params.get('type') === 'signup' || CALLBACK_KEYS.some((key) => key !== 'type' && params.has(key));
}

/** React와 라우터를 띄우기 전에 비밀값을 지우고, 인증 결과만 담는 Promise를 넘긴다. */
export function startEmailConfirmation(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'state' | 'replaceState'>,
  verify: (accessToken: string) => Promise<EmailConfirmationResponse> = (accessToken) => apiPost('/api/auth/email-confirmation', { accessToken }),
): Promise<EmailConfirmationResult> | null {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const fragmentCallback = isCallback(fragment);
  if (!fragmentCallback && !isCallback(url.searchParams)) return null;

  const params = fragmentCallback ? fragment : new URLSearchParams(url.searchParams);
  const errorCode = params.get('error_code') ?? url.searchParams.get('error_code');
  const hasError = params.has('error') || params.has('error_code') || url.searchParams.has('error') || url.searchParams.has('error_code');
  for (const key of CALLBACK_KEYS) url.searchParams.delete(key);
  if (fragmentCallback) url.hash = '';
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);

  if (hasError) return Promise.resolve(errorCode === 'otp_expired' ? 'expired' : 'failed');
  // 기존 이메일 가입 흐름만 처리한다. 다른 용도의 토큰을 가입 완료로 표시하지 않는다.
  const accessToken = params.get('access_token');
  if (!fragmentCallback || params.get('type') !== 'signup' || !accessToken || accessToken.length > 16_384 || (params.has('token_type') && params.get('token_type') !== 'bearer')) {
    return Promise.resolve('failed');
  }
  return Promise.resolve().then(() => verify(accessToken)).then((result): EmailConfirmationResult => result?.confirmed === true ? 'confirmed' : 'failed').catch((error: unknown): EmailConfirmationResult => {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return 'expired';
      if (error.status < 500 && error.status !== 429) return 'failed';
    }
    return 'unavailable';
  });
}
