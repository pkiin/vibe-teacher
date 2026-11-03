import { describe, expect, it } from 'vitest';
import { CloudClient, CloudError } from '../../src/cloud/client';

describe('인증 메일 오류 안내', () => {
  it.each([
    [429, 'over_email_send_rate_limit', 429, 'email_send_rate_limited'],
    [400, 'email_address_not_authorized', 400, 'email_delivery_not_configured'],
    [400, 'email_not_confirmed', 400, 'email_not_confirmed'],
    [429, 'over_request_rate_limit', 429, 'rate_limited'],
    [400, 'unknown_provider_error', 400, 'confirmation_resend_failed'],
    [503, 'unknown_provider_error', 503, 'cloud_unavailable'],
  ])('공급자 오류 %s/%s를 안전한 안내 %s/%s로 바꾼다', async (status, providerCode, expectedStatus, expectedCode) => {
    const request: typeof fetch = async () => Response.json({ code: providerCode, msg: 'private-email@example.test private-token sql-detail' }, { status });
    const client = new CloudClient({ url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'local', secure: false }, '', request);
    const error = await client.call('/auth/v1/resend', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ status: expectedStatus, code: expectedCode });
    expect(String(error)).not.toMatch(/private-email|private-token|sql-detail/);
  });

  it('JSON이 아닌 외부 오류도 원문을 노출하지 않는다', async () => {
    const request: typeof fetch = async () => new Response('private-provider-detail', { status: 429 });
    const client = new CloudClient({ url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'local', secure: false }, '', request);
    await expect(client.call('/auth/v1/resend')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
