import type { BuiltSummary, CommandFact, FileFact, GitCommitFact, NormalizedSession, PackageFact, ServerFact, StackFact } from '@vibe-teacher/shared';
import { buildTurnGroups } from '../turn-groups';
import { collectCommandFacts } from './commands';
import { collectFileFacts } from './files';
import { collectGitFacts } from './git';
import { dedupePackages, packagesFromCommand, packagesFromWrittenPackageJson } from './packages';
import { collectStack } from './stack';

export function summarizeBuilt(session: NormalizedSession, home?: string): BuiltSummary {
  const files = collectFileFacts(session, home);
  const cmd = collectCommandFacts(session);
  const packages = dedupePackages([
    ...cmd.classified.flatMap(({ tc, c }) => packagesFromCommand(c, tc)),
    ...packagesFromWrittenPackageJson(session),
  ]);
  const git = collectGitFacts(cmd.classified);
  const allFiles = [...files.created, ...files.modified];
  const stack = collectStack(allFiles, packages, cmd.commands);
  const timeline = buildTurnGroups(session);
  const failedToolCalls = new Set(cmd.classified.filter((x) => x.failed).map((x) => x.tc.id));
  for (const tc of session.toolCalls) if (tc.category !== 'shell' && tc.result?.ok === false) failedToolCalls.add(tc.id);
  const errors = failedToolCalls.size + session.messages.filter((m) => m.role === 'system-injected' && m.isError).length;
  let durationMin: number | undefined;
  if (session.startedAt && session.endedAt) {
    const d = (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000;
    if (isFinite(d) && d >= 0) durationMin = Math.round(d);
  }
  return {
    filesCreated: files.created,
    filesModified: files.modified,
    filesDeleted: files.deleted,
    dirsCreated: files.dirs,
    commandsRun: cmd.commands,
    packagesInstalled: packages,
    gitCommits: git.commits,
    gitInitialized: git.initialized,
    testsRun: cmd.tests,
    serversStarted: cmd.servers,
    stack,
    timeline,
    stats: {
      humanMessages: session.counts.human,
      toolCalls: session.toolCalls.length,
      durationMin,
      errors,
    },
  };
}

function mergeFiles(lists: FileFact[][]): FileFact[] {
  const map = new Map<string, FileFact>();
  for (const list of lists) {
    for (const f of list) {
      const cur = map.get(f.path);
      if (cur) {
        cur.count += f.count;
        for (const e of f.evidence) if (cur.evidence.length < 5) cur.evidence.push(e);
      } else map.set(f.path, { ...f, evidence: f.evidence.slice() });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.relPath ?? a.path).localeCompare(b.relPath ?? b.path));
}

function mergeCommands(lists: CommandFact[][]): CommandFact[] {
  const map = new Map<string, CommandFact>();
  for (const list of lists) {
    for (const c of list) {
      const k = `${c.category}:${c.command}`;
      const cur = map.get(k);
      if (cur) {
        cur.count += c.count;
        cur.failed += c.failed;
        for (const e of c.evidence) if (cur.evidence.length < 5) cur.evidence.push(e);
      } else map.set(k, { ...c, evidence: c.evidence.slice() });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

function mergeStack(lists: StackFact[][]): StackFact[] {
  const map = new Map<string, StackFact>();
  for (const list of lists) {
    for (const s of list) {
      const cur = map.get(s.id);
      if (cur) {
        for (const e of s.evidence) if (cur.evidence.length < 4 && !cur.evidence.some((x) => x.snippet === e.snippet)) cur.evidence.push(e);
      } else map.set(s.id, { ...s, evidence: s.evidence.slice() });
    }
  }
  return Array.from(map.values());
}

/** 여러 세션의 BuiltSummary 를 프로젝트/계정 단위로 합친다 */
export function mergeBuilt(parts: BuiltSummary[]): BuiltSummary {
  const created = mergeFiles(parts.map((p) => p.filesCreated));
  const createdSet = new Set(created.map((f) => f.path));
  const modified = mergeFiles(parts.map((p) => p.filesModified)).filter((f) => !createdSet.has(f.path));
  const deleted = mergeFiles(parts.map((p) => p.filesDeleted));
  const commands = mergeCommands(parts.map((p) => p.commandsRun));
  const packages = dedupePackages(parts.flatMap((p) => p.packagesInstalled) as PackageFact[]);
  const commits: GitCommitFact[] = parts.flatMap((p) => p.gitCommits);
  const servers: ServerFact[] = [];
  for (const p of parts) for (const s of p.serversStarted) if (!servers.some((x) => x.command === s.command)) servers.push(s);
  return {
    filesCreated: created,
    filesModified: modified,
    filesDeleted: deleted,
    dirsCreated: Array.from(new Set(parts.flatMap((p) => p.dirsCreated))).sort(),
    commandsRun: commands,
    packagesInstalled: packages,
    gitCommits: commits,
    gitInitialized: parts.some((p) => p.gitInitialized),
    testsRun: commands.filter((c) => c.category === 'test'),
    serversStarted: servers,
    stack: mergeStack(parts.map((p) => p.stack)),
    timeline: parts.flatMap((p) => p.timeline),
    stats: {
      humanMessages: parts.reduce((s, p) => s + p.stats.humanMessages, 0),
      toolCalls: parts.reduce((s, p) => s + p.stats.toolCalls, 0),
      durationMin: parts.reduce((s, p) => s + (p.stats.durationMin ?? 0), 0) || undefined,
      errors: parts.reduce((s, p) => s + p.stats.errors, 0),
    },
  };
}
