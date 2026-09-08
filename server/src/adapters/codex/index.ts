import path from 'node:path';
import type { Source, SourceStatus } from '@vibe-teacher/shared';
import { listDir, readability, safeStat } from '../../lib/fsx';
import type { HistoryAdapter, NormalizedDraft, SessionDraft, SessionFileInfo } from '../types';
import { parseCodexFile } from './parse';
import { codexDefaultRoots, codexSessionDirs } from './paths';

async function* walkRollouts(dir: string, depth = 0): AsyncIterable<SessionFileInfo> {
  const { entries } = await listDir(dir);
  for (const e of entries) {
    if (e.isDir && depth < 4) yield* walkRollouts(e.path, depth + 1);
    else if (e.isFile && /^rollout-.*\.jsonl$/.test(e.name)) {
      const st = await safeStat(e.path);
      if (st) yield { filePath: e.path, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
}

async function* listCodexFiles(source: Source): AsyncIterable<SessionFileInfo> {
  for (const dir of codexSessionDirs(source.path)) yield* walkRollouts(dir);
}

export const codexAdapter: HistoryAdapter = {
  provider: 'codex',
  label: 'Codex CLI',
  defaultRoots: codexDefaultRoots,

  async probe(source: Source) {
    const readable = await readability(source.path);
    if (readable !== 'ok') return { exists: readable === 'denied', readable, sessionCount: 0 };
    let sessionCount = 0;
    let lastModified: number | undefined;
    for await (const f of listCodexFiles(source)) {
      sessionCount += 1;
      if (!lastModified || f.mtimeMs > lastModified) lastModified = f.mtimeMs;
    }
    const status: Omit<SourceStatus, keyof Source> = { exists: true, readable, sessionCount };
    if (lastModified) status.lastModified = new Date(lastModified).toISOString();
    return status;
  },

  listSessionFiles: listCodexFiles,

  async scan(file): Promise<SessionDraft> {
    const { draft } = await parseCodexFile(file.filePath);
    const { messages: _m, toolCalls: _t, ...summary } = finish(draft, file);
    return summary;
  },

  async load(file): Promise<NormalizedDraft> {
    const { draft } = await parseCodexFile(file.filePath);
    return finish(draft, file);
  },
};

function finish(draft: NormalizedDraft, file: SessionFileInfo): NormalizedDraft {
  draft.filePath = file.filePath;
  draft.fileSize = file.size;
  draft.fileMtime = file.mtimeMs;
  if (!draft.sessionId) draft.sessionId = path.basename(file.filePath, '.jsonl');
  return draft;
}
