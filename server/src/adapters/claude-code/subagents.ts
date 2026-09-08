import path from 'node:path';
import { listDir, readJsonSafe } from '../../lib/fsx';
import type { SubagentMeta } from './records';

export interface SubagentFile {
  id: string;
  jsonlPath: string;
  meta: SubagentMeta | null;
}

/** `<projectDir>/<sessionId>.jsonl` → `<projectDir>/<sessionId>/subagents` */
export function subagentsDir(sessionFile: string): string {
  const base = sessionFile.endsWith('.jsonl') ? sessionFile.slice(0, -'.jsonl'.length) : sessionFile;
  return path.join(base, 'subagents');
}

export async function listSubagentFiles(sessionFile: string, withMeta = false): Promise<SubagentFile[]> {
  const dir = subagentsDir(sessionFile);
  const { entries } = await listDir(dir);
  const out: SubagentFile[] = [];
  for (const e of entries) {
    if (!e.isFile) continue;
    const m = /^agent-(.+)\.jsonl$/.exec(e.name);
    if (!m?.[1]) continue;
    const meta = withMeta ? await readJsonSafe<SubagentMeta>(path.join(dir, `agent-${m[1]}.meta.json`)) : null;
    out.push({ id: m[1], jsonlPath: e.path, meta });
  }
  return out;
}
