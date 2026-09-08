import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, defaultConfig, type AppConfig } from './schema';
import { ensureDir, readJsonSafe, writeJsonAtomic } from '../lib/fsx';

export interface Paths {
  home: string;
  configFile: string;
  indexCacheDir: string;
  enrichCacheDir: string;
  llmCwd: string;
}

export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.VIBE_TEACHER_HOME?.trim();
  if (raw) return path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
  return path.join(os.homedir(), '.vibe-teacher');
}

export function resolvePaths(home = resolveHome()): Paths {
  return {
    home,
    configFile: path.join(home, 'config.json'),
    indexCacheDir: path.join(home, 'cache', 'index'),
    enrichCacheDir: path.join(home, 'cache', 'enrich'),
    llmCwd: path.join(home, 'llm-cwd'),
  };
}

export class ConfigStore {
  private current: AppConfig = defaultConfig();
  constructor(readonly paths: Paths) {}

  get(): AppConfig {
    return this.current;
  }

  async load(): Promise<AppConfig> {
    await ensureDir(this.paths.home);
    await ensureDir(this.paths.indexCacheDir);
    await ensureDir(this.paths.enrichCacheDir);
    await ensureDir(this.paths.llmCwd);
    const raw = await readJsonSafe(this.paths.configFile);
    if (raw == null) {
      this.current = defaultConfig();
      await this.save();
      return this.current;
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[config] ${this.paths.configFile} 형식이 맞지 않아 기본값으로 대체합니다:`, parsed.error.message);
      this.current = defaultConfig();
      await this.save();
    } else {
      this.current = parsed.data;
    }
    return this.current;
  }

  async update(mutate: (cfg: AppConfig) => void): Promise<AppConfig> {
    const next = structuredClone(this.current);
    mutate(next);
    this.current = ConfigSchema.parse(next);
    await this.save();
    return this.current;
  }

  async save(): Promise<void> {
    await writeJsonAtomic(this.paths.configFile, this.current);
  }
}
