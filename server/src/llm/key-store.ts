import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { OPENROUTER_KEY_PATTERN, type OpenRouterKeySource } from '@vibe-teacher/shared';
import { readJsonSafe, writeJsonAtomic } from '../lib/fsx';

const SavedSchema = z.object({ version: z.literal(1), key: z.string() });

/**
 * 노트북 설치에서 화면으로 입력한 OpenRouter 키. 앱 저장소(VIBE_TEACHER_HOME) 안에 본인만 읽는 파일로 둔다.
 * 스캔하는 홈의 기록 폴더나 Supabase 에는 쓰지 않고, 화면·로그로 키를 돌려주지 않는다.
 */
export class OpenRouterKeyStore {
  private key: string | undefined;
  constructor(readonly file: string) {}

  static at(home: string): OpenRouterKeyStore {
    return new OpenRouterKeyStore(path.join(home, 'secrets', 'openrouter.json'));
  }

  async load(): Promise<void> {
    const parsed = SavedSchema.safeParse(await readJsonSafe(this.file));
    this.key = parsed.success && OPENROUTER_KEY_PATTERN.test(parsed.data.key) ? parsed.data.key : undefined;
  }

  get(): string | undefined {
    return this.key;
  }

  /** 형식 검사는 호출한 쪽(라우트)이 사용자에게 안내하고, 여기서는 틀린 값을 저장하지 않기만 한다. */
  async set(key: string): Promise<void> {
    const value = key.trim();
    if (!OPENROUTER_KEY_PATTERN.test(value)) throw new Error('OpenRouter 키 형식이 아닙니다');
    await fsp.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(this.file, { version: 1, key: value }, { mode: 0o600 });
    this.key = value;
  }

  async clear(): Promise<void> {
    await fsp.rm(this.file, { force: true });
    this.key = undefined;
  }
}

/** 셸·.env 의 키가 우선한다. 화면에서 저장한 키는 둘 다 없을 때만 쓴다. */
export function openRouterKeySource(env: NodeJS.ProcessEnv, store?: OpenRouterKeyStore): OpenRouterKeySource {
  if (env.OPENROUTER_API_KEY?.trim()) return 'env';
  return store?.get() ? 'saved' : 'none';
}

export function withSavedKey(env: NodeJS.ProcessEnv, store?: OpenRouterKeyStore): NodeJS.ProcessEnv {
  const saved = store?.get();
  return saved && !env.OPENROUTER_API_KEY?.trim() ? { ...env, OPENROUTER_API_KEY: saved } : env;
}
