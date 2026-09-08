import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Source, SourceStatus } from '@vibe-teacher/shared';
import { listDir, readJsonSafe, readability, safeStat } from '../../lib/fsx';
import type { HistoryAdapter, NormalizedDraft, SessionDraft, SessionFileInfo } from '../types';
import { parseVscodeChatFile } from './parse';
import { copilotVscodeDefaultRoots } from './paths';

interface Found {
  file: SessionFileInfo;
  workspaceDir: string;
}

async function* findChatFiles(source: Source): AsyncIterable<Found> {
  // <workspaceStorage>/<hash>/chatSessions/*.json  또는  <emptyWindowChatSessions>/*.json
  const { entries } = await listDir(source.path);
  const dirs = path.basename(source.path) === 'emptyWindowChatSessions' ? [{ path: source.path, isDir: true, name: '', isFile: false }] : entries.filter((e) => e.isDir);
  for (const ws of dirs) {
    const chatDir = ws.path === source.path ? source.path : path.join(ws.path, 'chatSessions');
    const inner = await listDir(chatDir);
    for (const f of inner.entries) {
      if (!f.isFile || !f.name.endsWith('.json')) continue;
      const st = await safeStat(f.path);
      if (st) yield { file: { filePath: f.path, size: st.size, mtimeMs: st.mtimeMs }, workspaceDir: ws.path };
    }
  }
}

async function workspaceRootFor(workspaceDir: string): Promise<string | undefined> {
  const ws = await readJsonSafe<{ folder?: string; workspace?: string }>(path.join(workspaceDir, 'workspace.json'));
  const folder = ws?.folder ?? ws?.workspace;
  if (!folder) return undefined;
  if (folder.startsWith('file:')) {
    try {
      return fileURLToPath(folder);
    } catch {
      return undefined;
    }
  }
  return folder;
}

export const copilotVscodeAdapter: HistoryAdapter = {
  provider: 'copilot-vscode',
  label: 'VS Code Copilot Chat',
  defaultRoots: copilotVscodeDefaultRoots,

  async probe(source: Source) {
    const readable = await readability(source.path);
    if (readable !== 'ok') return { exists: readable === 'denied', readable, sessionCount: 0 };
    let sessionCount = 0;
    let unsupported = 0;
    let lastModified: number | undefined;
    for await (const { file } of findChatFiles(source)) {
      sessionCount += 1;
      if (!lastModified || file.mtimeMs > lastModified) lastModified = file.mtimeMs;
    }
    // .jsonl 샤드 등 다른 형식 감지
    const { entries } = await listDir(source.path);
    for (const ws of entries.filter((e) => e.isDir)) {
      const inner = await listDir(path.join(ws.path, 'chatSessions'));
      unsupported += inner.entries.filter((f) => f.isFile && !f.name.endsWith('.json')).length;
    }
    const status: Omit<SourceStatus, keyof Source> = { exists: true, readable, sessionCount };
    if (lastModified) status.lastModified = new Date(lastModified).toISOString();
    if (sessionCount === 0 && unsupported > 0) status.note = `지원하지 않는 세션 형식 ${unsupported}개 (.json 만 지원)`;
    return status;
  },

  async *listSessionFiles(source: Source) {
    for await (const { file } of findChatFiles(source)) yield file;
  },

  async scan(file): Promise<SessionDraft> {
    const { messages: _m, toolCalls: _t, ...summary } = await loadVscodeSession(file);
    return summary;
  },

  async load(file): Promise<NormalizedDraft> {
    return loadVscodeSession(file);
  },
};

async function loadVscodeSession(file: SessionFileInfo): Promise<NormalizedDraft> {
  const workspaceDir = path.dirname(path.dirname(file.filePath));
  const root = path.basename(path.dirname(file.filePath)) === 'chatSessions' ? await workspaceRootFor(workspaceDir) : undefined;
  const draft = await parseVscodeChatFile(file.filePath, root);
  draft.filePath = file.filePath;
  draft.fileSize = file.size;
  draft.fileMtime = file.mtimeMs;
  if (!draft.projectRoot) draft.parseWarnings.push('workspace.json 이 없어 프로젝트 폴더를 알 수 없습니다');
  return draft;
}
