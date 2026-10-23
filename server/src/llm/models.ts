import type { LlmModelInfo } from '@vibe-teacher/shared';

/**
 * 모델 선택 목록. OpenRouter 는 공개 모델 목록(키 불필요), OpenAI 는 계정 모델 목록(키 필요)을 읽어
 * 1시간 동안 메모리에 둔다. 사용자 데이터는 보내지 않는다.
 */

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5-mini';
/** 예전 설정 응답과의 호환용. 모든 API 요청은 OpenRouter를 사용한다. */
export const DEFAULT_OPENAI_MODEL = DEFAULT_OPENROUTER_MODEL;

const TTL_MS = 60 * 60 * 1000;

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
  supported_parameters?: string[];
}

/** "0.000001"(토큰당) → 1M 토큰당 달러. 음수(라우터 가변 가격)나 숫자가 아니면 없음 */
function perMillion(v: string | undefined): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1e6 * 1000) / 1000;
}

export function parseOpenRouterModels(raw: unknown): LlmModelInfo[] {
  const data = (raw as { data?: OpenRouterModel[] })?.data;
  if (!Array.isArray(data)) throw new Error('OpenRouter 모델 목록 형식이 올바르지 않습니다');
  const models: LlmModelInfo[] = [];
  for (const m of data) {
    if (!m?.id) continue;
    const out = m.architecture?.output_modalities;
    if (out && !out.includes('text')) continue;
    const prompt = perMillion(m.pricing?.prompt);
    const completion = perMillion(m.pricing?.completion);
    const params = m.supported_parameters ?? [];
    models.push({
      id: m.id,
      name: m.name ?? m.id,
      free: prompt === 0 && completion === 0,
      ...(m.context_length ? { contextLength: m.context_length } : {}),
      structured: params.includes('structured_outputs'),
      ...(prompt !== undefined ? { promptPrice: prompt } : {}),
      ...(completion !== undefined ? { completionPrice: completion } : {}),
      ...(m.description ? { description: m.description.slice(0, 300) } : {}),
    });
  }
  // 기본 무료 라우터 → 무료 모델 → 나머지 (이름순)
  return models.sort(
    (a, b) => Number(b.id === DEFAULT_OPENROUTER_MODEL) - Number(a.id === DEFAULT_OPENROUTER_MODEL) || Number(b.free) - Number(a.free) || a.name.localeCompare(b.name),
  );
}

/** 대화용 모델만 남긴다 (임베딩·음성·이미지·검색 전용 모델 제외) */
export function parseOpenAiModels(raw: unknown): LlmModelInfo[] {
  const data = (raw as { data?: { id: string }[] })?.data;
  if (!Array.isArray(data)) throw new Error('OpenAI 모델 목록 형식이 올바르지 않습니다');
  return data
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|instruct|moderation)/.test(id))
    .sort((a, b) => Number(b === DEFAULT_OPENAI_MODEL) - Number(a === DEFAULT_OPENAI_MODEL) || a.localeCompare(b))
    .map((id) => ({ id, name: id, free: false, structured: true }));
}

export class ModelCatalog {
  private cache = new Map<'openrouter' | 'openai', { at: number; models: LlmModelInfo[] }>();

  constructor(private readonly opts: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}) {}

  private get fetch(): typeof fetch {
    return this.opts.fetch ?? globalThis.fetch;
  }

  async list(provider: 'openrouter' | 'openai', force = false): Promise<{ models: LlmModelInfo[]; fetchedAt: string }> {
    const hit = this.cache.get(provider);
    if (hit && !force && Date.now() - hit.at < TTL_MS) return { models: hit.models, fetchedAt: new Date(hit.at).toISOString() };
    const models = await this.fetchOpenRouter();
    const at = Date.now();
    this.cache.set(provider, { at, models });
    return { models, fetchedAt: new Date(at).toISOString() };
  }

  /** 모델이 JSON 스키마 강제를 지원하는지. 목록을 못 읽으면 null (요청해 보고 실패하면 프롬프트 지시로 다시 시도) */
  async structured(provider: 'openrouter' | 'openai', model: string): Promise<boolean | null> {
    try {
      const { models } = await this.list('openrouter');
      return models.find((m) => m.id === model)?.structured ?? null;
    } catch {
      return null;
    }
  }

  private async fetchOpenRouter(): Promise<LlmModelInfo[]> {
    const res = await this.fetch(`${OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`OpenRouter 모델 목록을 가져오지 못했습니다 (HTTP ${res.status})`);
    return parseOpenRouterModels(await res.json());
  }

}
