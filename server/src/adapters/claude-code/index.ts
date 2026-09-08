import path from 'node:path';
import type { Account, Source, SourceStatus } from '@vibe-teacher/shared';
import { isInside, listDir, readJsonSafe, readability, safeStat } from '../../lib/fsx';
import { truncate } from '../../lib/text';
import type { HistoryAdapter, NormalizedDraft, SessionDraft, SessionFileInfo, SourceContext } from '../types';
import { claudeDefaultRoots, configRootFromProjectsDir, decodeProjectDir } from './paths';
import { parseClaudeFile } from './parse';
import { listSubagentFiles } from './subagents';

interface ClaudeSourceExtra {
  liveSessionIds: Set<string>;
  knownCwds: string[];
}

async function* listClaudeSessionFiles(source: Source): AsyncIterable<SessionFileInfo> {
  const { entries } = await listDir(source.path);
  for (const dir of entries) {
    if (!dir.isDir) continue;
    const inner = await listDir(dir.path);
    for (const f of inner.entries) {
      if (!f.isFile || !f.name.endsWith('.jsonl')) continue;
      const st = await safeStat(f.path);
      if (!st) continue;
      yield { filePath: f.path, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
}

function sessionIdFromFile(filePath: string): string {
  return path.basename(filePath, '.jsonl');
}

function finishDraft(
  draft: NormalizedDraft,
  file: SessionFileInfo,
  aiTitle: string | undefined,
  lastPrompt: string | undefined,
  ctx: SourceContext,
): void {
  const extra = ctx.extra as ClaudeSourceExtra | undefined;
  const sessionId = draft.sessionId || sessionIdFromFile(file.filePath);
  draft.sessionId = sessionId;
  draft.filePath = file.filePath;
  draft.fileSize = file.size;
  draft.fileMtime = file.mtimeMs;
  draft.title = truncate(aiTitle || lastPrompt || draft.firstPrompt || '(제목 없음)', 60);
  draft.isLive = extra?.liveSessionIds.has(sessionId) ?? false;
  if (!draft.projectRoot) {
    const dirName = path.basename(path.dirname(file.filePath));
    const decoded = decodeProjectDir(dirName, extra?.knownCwds ?? []);
    draft.projectRoot = decoded.cwd;
    if (!decoded.certain) draft.parseWarnings.push('프로젝트 경로를 디렉터리명에서 추정했습니다 (cwd 기록 없음)');
  }
}

export const claudeCodeAdapter: HistoryAdapter = {
  provider: 'claude-code',
  label: 'Claude Code',

  defaultRoots: claudeDefaultRoots,

  async probe(source: Source) {
    const readable = await readability(source.path);
    if (readable !== 'ok') {
      return { exists: readable === 'denied', readable, sessionCount: 0 };
    }
    let sessionCount = 0;
    let lastModified: number | undefined;
    for await (const f of listClaudeSessionFiles(source)) {
      sessionCount += 1;
      if (!lastModified || f.mtimeMs > lastModified) lastModified = f.mtimeMs;
    }
    const status: Omit<SourceStatus, keyof Source> = { exists: true, readable, sessionCount };
    if (lastModified) status.lastModified = new Date(lastModified).toISOString();
    return status;
  },

  listSessionFiles: listClaudeSessionFiles,

  async prepare(source: Source, account: Account) {
    const configRoot = configRootFromProjectsDir(source.path);
    const liveSessionIds = new Set<string>();
    const sessionsDir = path.join(configRoot, 'sessions');
    const { entries } = await listDir(sessionsDir);
    for (const e of entries) {
      if (!e.isFile || !e.name.endsWith('.json')) continue;
      const j = await readJsonSafe<{ sessionId?: string }>(e.path);
      if (j?.sessionId) liveSessionIds.add(j.sessionId);
    }
    const knownCwds: string[] = [];
    const claudeJson = await readJsonSafe<{ projects?: Record<string, unknown> }>(path.join(account.homePath || path.dirname(configRoot), '.claude.json'));
    if (claudeJson?.projects && typeof claudeJson.projects === 'object') knownCwds.push(...Object.keys(claudeJson.projects));
    const extra: ClaudeSourceExtra = { liveSessionIds, knownCwds };
    return extra;
  },

  async scan(file, _source, ctx): Promise<SessionDraft> {
    const res = await parseClaudeFile(file.filePath, { light: true });
    const subagents = await listSubagentFiles(file.filePath);
    res.draft.counts.subagents = subagents.length;
    finishDraft(res.draft, file, res.aiTitle, res.lastPrompt, ctx);
    const { messages: _m, toolCalls: _t, ...summary } = res.draft;
    return summary;
  },

  async load(file, _source, ctx): Promise<NormalizedDraft> {
    const res = await parseClaudeFile(file.filePath, { light: false });
    const draft = res.draft;
    const subagents = await listSubagentFiles(file.filePath, true);
    draft.counts.subagents = subagents.length;
    for (const sub of subagents) {
      if (!isInside(path.dirname(file.filePath), sub.jsonlPath)) continue;
      const parentIdx = res.agentIdToMessageIndex.get(sub.id);
      const subRes = await parseClaudeFile(sub.jsonlPath, {
        subagentId: sub.id,
        parentMessageIndex: parentIdx,
        startIndex: draft.messages.length,
      });
      draft.messages.push(...subRes.draft.messages);
      draft.toolCalls.push(...subRes.draft.toolCalls);
      draft.counts.toolCalls += subRes.draft.counts.toolCalls;
      for (const m of subRes.draft.models) if (!draft.models.includes(m)) draft.models.push(m);
      for (const w of subRes.draft.parseWarnings) draft.parseWarnings.push(`[subagent ${sub.id}] ${w}`);
    }
    finishDraft(draft, file, res.aiTitle, res.lastPrompt, ctx);
    return draft;
  },
};
