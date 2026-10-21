import path from 'node:path';
import { DEFAULT_READER_LEVEL, type EnrichmentRecord, type LlmProviderId, type ReaderLevel, type SessionSummary } from '@vibe-teacher/shared';
import { sha1 } from '../lib/hash';
import { readJsonSafe, writeJsonAtomic } from '../lib/fsx';

export function enrichCacheKey(session: SessionSummary, provider: LlmProviderId, model: string | null | undefined, promptVersion: number, level: ReaderLevel = DEFAULT_READER_LEVEL): string {
  return sha1(`${session.key}|${session.fileSize}|${session.fileMtime}|${provider}|${model ?? ''}|v${promptVersion}|${level}`);
}

export async function readEnrichment(dir: string, key: string): Promise<EnrichmentRecord | null> {
  return readJsonSafe<EnrichmentRecord>(path.join(dir, `${key}.json`));
}

export async function writeEnrichment(dir: string, key: string, record: EnrichmentRecord): Promise<void> {
  await writeJsonAtomic(path.join(dir, `${key}.json`), record);
}
