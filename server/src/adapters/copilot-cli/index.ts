import path from 'node:path';
import type { Source, SourceStatus } from '@vibe-teacher/shared';
import { listDir, readability, safeStat } from '../../lib/fsx';
import type { HistoryAdapter, NormalizedDraft, SessionDraft, SessionFileInfo } from '../types';
import { parseCopilotCliFile } from './parse';
import { copilotCliDefaultRoots, copilotSessionDirs } from './paths';

async function* listCopilotFiles(source: Source): AsyncIterable<SessionFileInfo> {
  for (const dir of copilotSessionDirs(source.path)) {
    const { entries } = await listDir(dir);
    for (const e of entries) {
      if (!e.isDir) continue;
      const f = path.join(e.path, 'events.jsonl');
      const st = await safeStat(f);
      if (st?.isFile()) yield { filePath: f, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
}

export const copilotCliAdapter: HistoryAdapter = {
  provider: 'copilot-cli',
  label: 'Copilot CLI',
  defaultRoots: copilotCliDefaultRoots,

  async probe(source: Source) {
    const readable = await readability(source.path);
    if (readable !== 'ok') return { exists: readable === 'denied', readable, sessionCount: 0 };
    let sessionCount = 0;
    let lastModified: number | undefined;
    for await (const f of listCopilotFiles(source)) {
      sessionCount += 1;
      if (!lastModified || f.mtimeMs > lastModified) lastModified = f.mtimeMs;
    }
    const status: Omit<SourceStatus, keyof Source> = { exists: true, readable, sessionCount };
    if (lastModified) status.lastModified = new Date(lastModified).toISOString();
    if (sessionCount === 0) status.note = '디렉터리는 있지만 세션 기록(session-state)이 없습니다';
    return status;
  },

  listSessionFiles: listCopilotFiles,

  async scan(file): Promise<SessionDraft> {
    const { draft } = await parseCopilotCliFile(file.filePath);
    const { messages: _m, toolCalls: _t, ...summary } = finish(draft, file);
    return summary;
  },

  async load(file): Promise<NormalizedDraft> {
    const { draft } = await parseCopilotCliFile(file.filePath);
    return finish(draft, file);
  },
};

function finish(draft: NormalizedDraft, file: SessionFileInfo): NormalizedDraft {
  draft.filePath = file.filePath;
  draft.fileSize = file.size;
  draft.fileMtime = file.mtimeMs;
  return draft;
}
