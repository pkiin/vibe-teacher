import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LlmError, type LlmAvailability, type LlmProvider, type LlmRequest, type LlmResult } from './types';

export interface AnthropicSdkOptions {
  model?: string | null;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_SDK_MODEL = 'claude-opus-5';

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
      const response = await this.client.messages.parse(
        {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: zodOutputFormat(req.schema) },
        },
        { timeout: req.timeoutMs, signal: req.signal },
      );
      if (response.stop_reason === 'refusal') throw new LlmError('unknown', '모델이 요청을 거절했습니다', response.stop_details?.explanation ?? undefined);
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
