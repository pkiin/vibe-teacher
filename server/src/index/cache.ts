import path from 'node:path';
import type { SessionSummary } from '@vibe-teacher/shared';
import { readJsonSafe, writeJsonAtomic } from '../lib/fsx';

export interface IndexCacheEntry {
  size: number;
  mtimeMs: number;
  summary: SessionSummary;
}

export interface IndexCacheFile {
  version: number;
  entries: Record<string, IndexCacheEntry>;
}

const CACHE_VERSION = 3;

export function cachePathFor(dir: string, sourceId: string): string {
  return path.join(dir, `${sourceId}.json`);
}

export async function loadIndexCache(dir: string, sourceId: string): Promise<Record<string, IndexCacheEntry>> {
  const file = await readJsonSafe<IndexCacheFile>(cachePathFor(dir, sourceId));
  if (!file || file.version !== CACHE_VERSION || !file.entries || typeof file.entries !== 'object') return {};
  return file.entries;
}

export async function saveIndexCache(dir: string, sourceId: string, entries: Record<string, IndexCacheEntry>): Promise<void> {
  const body: IndexCacheFile = { version: CACHE_VERSION, entries };
  await writeJsonAtomic(cachePathFor(dir, sourceId), body);
}
