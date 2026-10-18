import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { LlmEffort } from '@vibe-teacher/shared';
import { LlmError, type LlmAvailability, type LlmProvider, type LlmRequest, type LlmResult } from './types';

export interface AnthropicSdkOptions {
  model?: string | null;
  effort?: LlmEffort;
  env?: NodeJS.ProcessEnv;
}

/** 현재 Opus (claude-opus-5 보다 저렴: 입력 $4 / 출력 $20 per 1M 토큰) */
export const DEFAULT_SDK_MODEL = 'claude-opus-5-5';

/** 서버 측 거절 대체(fallbacks: "default")를 받는 모델. 그 외 모델에는 보내지 않는다 (예: Haiku 는 400) */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export class AnthropicSdkProvider implements LlmProvider {
  readonly id = 'anthropic-sdk' as const;
  private client: Anthropic | null = null;
  constructor(private readonly opts: AnthropicSdkOptions) {}

  private get env(): NodeJS.ProcessEnv {
    return this.opts.env ?? process.env;
  }

  async availability(): Promise<LlmAvailability> {
    if (this.env.ANTHROPIC_API_KEY || this.env.ANTHROPIC_AUTH_TOKEN) return { ok: true, detail: this.opts.model ?? DEFAULT_SDK_MODEL };
    return { ok: false, reason: 'ANTHROPIC_API_KEY 환경변수가 없습니다' };
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (!this.client) this.client = new Anthropic();
    const model = this.opts.model ?? DEFAULT_SDK_MODEL;
    const started = Date.now();
    try {
      // claude-opus-5-5 는 생각(adaptive)이 항상 켜져 있으므로 thinking 은 보내지 않고 effort 로만 조절한다.
      // 안전 분류기가 거절하면 서버가 권장 모델로 다시 실행한다 (fallbacks: "default").
      const fallback = SERVER_FALLBACK_MODELS.has(model);
      const response = await this.client.beta.messages.parse(
        {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: this.opts.effort ?? 'medium', format: betaZodOutputFormat(req.schema) },
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { timeout: req.timeoutMs, signal: req.signal },
      );
      // 대체 모델까지 모두 거절했을 때만 refusal 로 끝난다
      if (response.stop_reason === 'refusal') throw new LlmError('unknown', '모델이 요청을 거절했습니다', response.stop_details?.explanation ?? undefined);
      if (response.stop_reason === 'max_tokens') throw new LlmError('parse', '응답이 최대 토큰 수에서 잘렸습니다');
      const parsed = response.parsed_output;
      if (parsed == null) throw new LlmError('parse', 'LLM 응답을 스키마로 해석하지 못했습니다');
      return {
        data: parsed,
        provider: 'anthropic-sdk',
        model: response.model,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new LlmError('auth', 'Anthropic API 인증 실패', err.message);
      if (err instanceof Anthropic.RateLimitError) throw new LlmError('rate_limit', '요청 한도 초과', err.message);
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError('timeout', 'Anthropic API 응답 시간 초과', err.message);
      if (err instanceof Anthropic.APIConnectionError) throw new LlmError('network', 'Anthropic API에 연결하지 못했습니다', err.message);
      if (err instanceof Anthropic.APIError) throw new LlmError('unknown', `Anthropic API 오류 ${err.status}`, err.message);
      if ((err as Error).name === 'AbortError') throw new LlmError('cancelled', '작업이 취소되었습니다');
      throw new LlmError('unknown', (err as Error).message);
    }
  }
}
