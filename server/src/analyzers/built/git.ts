import type { Evidence, GitCommitFact, ToolCall } from '@vibe-teacher/shared';
import { truncate } from '../../lib/text';
import type { ClassifiedCommand } from './commands';

const MSG_RE = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/;
const HASH_RE = /\[[^\]\n]*?\b(?:\(root-commit\)\s+)?([0-9a-f]{7,40})\]/;

export interface GitFacts {
  commits: GitCommitFact[];
  initialized: boolean;
  pushed: boolean;
}

export function collectGitFacts(classified: { tc: ToolCall; c: ClassifiedCommand; failed: boolean }[]): GitFacts {
  const commits: GitCommitFact[] = [];
  let initialized = false;
  let pushed = false;
  for (const { tc, c, failed } of classified) {
    if (c.category !== 'git' || c.argv[0] !== 'git') continue;
    const sub = c.argv[1];
    const evidence: Evidence = { toolCallId: tc.id, messageIndex: tc.messageIndex, snippet: truncate(c.cmd.raw || tc.command || '', 200) };
    if (sub === 'init' && !failed) initialized = true;
    if (sub === 'push' && !failed) {
      pushed = true;
      for (const cm of commits) cm.pushed = true;
    }
    if (sub !== 'commit' || failed) continue;
    let message: string | undefined;
    const heredoc = c.cmd.heredocs[0]?.body;
    if (heredoc) message = heredoc.trim();
    else {
      const m = MSG_RE.exec(c.cmd.raw);
      message = (m?.[1] ?? m?.[2] ?? m?.[3])?.replace(/\\"/g, '"');
      if (message && /^\$\(cat/.test(message)) message = undefined;
    }
    const s = tc.result?.structured;
    const out = s && 'stdout' in s ? `${s.stdout}\n${s.stderr}` : tc.result?.summary ?? '';
    const hash = HASH_RE.exec(out)?.[1];
    commits.push({ message: message ? truncate(message.split('\n')[0] ?? message, 120) : undefined, hash, pushed: false, evidence: [evidence] });
  }
  return { commits, initialized, pushed };
}
