import type { ConfigStore } from '../config/store';
import type { ResolvedLlm } from './select';
import type { LlmProvider } from './types';

/**
 * 위키 문장을 AI 로 만들 수 있는지 한곳에서 판단한다.
 * AI를 쓸 수 없으면 생성하지 않고 화면에 표시할 사유를 돌려준다.
 */
export type TextGate = { ok: true; provider: LlmProvider } | { ok: false; reason: string };

export async function textGate(input: { store: ConfigStore; resolveProvider: () => Promise<ResolvedLlm>; allowed: { ok: boolean; reason?: string } }): Promise<TextGate> {
  if (!input.allowed.ok) return { ok: false, reason: input.allowed.reason ?? 'AI 사용 권한이 없습니다' };
  const { provider, status } = await input.resolveProvider();
  if (!provider) return { ok: false, reason: status.reason ?? 'AI 제공자를 쓸 수 없습니다' };
  return { ok: true, provider };
}
