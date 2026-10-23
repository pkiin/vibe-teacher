import { z } from 'zod';
import { maskSecrets, maskOutput } from './digest';
import { OPENROUTER_BASE_URL } from './models';
import { LlmError, extractJson, type LlmAvailability, type LlmProvider, type LlmRequest, type LlmResult } from './types';

/**
 * OpenAI 호환 Chat Completions 프로토콜을 쓰는 OpenRouter 제공자. SDK 없이 fetch 로 부른다.
 * 출력 형식은 모델이 지원하는 만큼 강제한다: JSON 스키마(structured outputs) → JSON 모드 → 프롬프트 지시.
 * 어느 쪽이든 받은 결과는 zod 스키마로 다시 검사한다.
 */

export type OpenAiCompatId = 'openrouter' | 'openai';
type OutputMode = 'json_schema' | 'json_object' | 'prompt';

const SETUP: Record<OpenAiCompatId, { baseUrl: string; keyEnv: 'OPENROUTER_API_KEY'; label: string }> = {
  openrouter: { baseUrl: OPENROUTER_BASE_URL, keyEnv: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
  openai: { baseUrl: OPENROUTER_BASE_URL, keyEnv: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
};

export interface OpenAiCompatOptions {
  id: OpenAiCompatId;
  model: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** 모델이 JSON 스키마 강제를 지원하는지 (모르면 null — 먼저 시도하고 거절되면 프롬프트 지시로 다시) */
  structured?: (model: string) => Promise<boolean | null>;
}

/** OpenAI strict 스키마 규칙: 모든 객체에 additionalProperties:false, 모든 속성을 required 로 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as Record<string, unknown>;
    if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
      n.additionalProperties = false;
      n.required = Object.keys(n.properties as object);
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(json);
  return json;
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null; annotations?: { type: string; url_citation?: { url: string; title?: string; content?: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number | string };
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly id = 'openrouter' as const;

  constructor(private readonly opts: OpenAiCompatOptions) {
  }

  private get setup() {
    return SETUP[this.opts.id];
  }

  private get key(): string | undefined {
    return (this.opts.env ?? process.env)[this.setup.keyEnv] || undefined;
  }

  async availability(): Promise<LlmAvailability> {
    if (!this.key) return { ok: false, reason: `${this.setup.keyEnv} 환경변수가 없습니다` };
    return { ok: true, detail: this.opts.model };
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (!this.key) throw new LlmError('auth', `${this.setup.keyEnv} 환경변수가 없습니다`);
    const structured = this.opts.id === 'openai' ? true : ((await this.opts.structured?.(this.opts.model)) ?? null);
    const first: OutputMode = structured === false ? 'json_object' : 'json_schema';
    const started = Date.now();
    try {
      return await this.request(req, first, started);
    } catch (err) {
      // 모델이 response_format 을 받지 않으면 프롬프트 지시만으로 한 번 더
      if (err instanceof LlmError && err.kind === 'unknown' && /response_format|structured|json_schema|json mode/i.test(`${err.message} ${err.detail ?? ''}`)) {
        return this.request(req, 'prompt', started);
      }
      throw err;
    }
  }

  private async request<T>(req: LlmRequest<T>, mode: OutputMode, started: number): Promise<LlmResult<T>> {
    const schema = toStrictJsonSchema(req.schema);
    const system =
      mode === 'json_schema'
        ? req.system
        : `${req.system}\n\n반드시 아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하세요. 코드 블록이나 설명 글은 쓰지 마세요.\n${JSON.stringify(schema)}`;
    const body: Record<string, unknown> = {
      model: this.opts.model === 'gpt-5-mini' ? 'openai/gpt-5-mini' : this.opts.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
      // OpenAI 의 추론 모델은 max_tokens 대신 max_completion_tokens 를 받는다
      max_tokens: req.maxTokens,
      ...(req.task === 'research' ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
    };
    if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema } };
    if (mode === 'json_object') body.response_format = { type: 'json_object' };

    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs);
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' };
    headers['x-title'] = 'vibe-teacher';

    let res: Response;
    try {
      res = await (this.opts.fetch ?? globalThis.fetch)(`${this.setup.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      const name = (err as Error).name;
      if (req.signal?.aborted) throw new LlmError('cancelled', '작업이 취소되었습니다');
      if (name === 'TimeoutError' || name === 'AbortError') throw new LlmError('timeout', `${this.setup.label} 응답이 ${Math.round(req.timeoutMs / 1000)}초 안에 오지 않았습니다`);
      throw new LlmError('network', `${this.setup.label}에 연결하지 못했습니다`, (err as Error).message);
    }
    const text = await res.text();
    let data: ChatResponse = {};
    try {
      data = text ? (JSON.parse(text) as ChatResponse) : {};
    } catch {
      // 오류 본문이 JSON 이 아닐 수 있다
    }
    if (!res.ok || data.error) throw this.httpError(res.status, data.error?.message ?? text.slice(0, 300));

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.message?.refusal) throw new LlmError('unknown', '모델이 요청을 거절했습니다', choice.message.refusal);
    if (choice?.finish_reason === 'length') throw new LlmError('parse', '응답이 최대 토큰 수에서 잘렸습니다');
    if (!content) throw new LlmError('parse', `${this.setup.label} 응답에 내용이 없습니다`);
    const validated = req.schema.safeParse(maskOutput(extractJson(content)));
    if (!validated.success) throw new LlmError('parse', 'LLM 응답이 스키마와 맞지 않습니다', validated.error.message.slice(0, 500));
    return {
      data: validated.data,
      provider: 'openrouter',
      model: data.model ?? this.opts.model,
      ...(typeof data.usage?.cost === 'number' ? { costUsd: data.usage.cost } : {}),
      ...(data.usage ? { usage: { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 } } : {}),
      durationMs: Date.now() - started,
      ...(choice?.message?.annotations ? { sources: choice.message.annotations.flatMap((a) => a.type === 'url_citation' && a.url_citation ? [{ title: a.url_citation.title ?? a.url_citation.url, url: a.url_citation.url, ...(a.url_citation.content ? { excerpt: maskSecrets(a.url_citation.content).slice(0, 1200) } : {}) }] : []) } : {}),
    };
  }

  private httpError(status: number, message: string): LlmError {
    const label = this.setup.label;
    if (status === 401 || status === 403) return new LlmError('auth', `${label} 인증 실패 — ${this.setup.keyEnv} 를 확인하세요`, message);
    if (status === 402) return new LlmError('budget', `${label} 크레딧이 부족합니다`, message);
    if (status === 429) return new LlmError('rate_limit', `${label} 요청 한도 초과 (무료 모델은 분당·일일 한도가 낮습니다)`, message);
    if (/data policy|privacy|No endpoints found/i.test(message)) {
      return new LlmError('unknown', `${label}: 이 모델을 쓸 수 있는 공급자가 없습니다. 무료 모델은 OpenRouter 계정 Settings › Privacy 에서 무료 모델 사용을 허용해야 할 수 있습니다`, message);
    }
    return new LlmError('unknown', `${label} 오류 ${status}: ${message.slice(0, 200)}`, message);
  }
}
