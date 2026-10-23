import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { mergeBuilt, summarizeBuilt } from '../../src/analyzers/built/index';
import { classifyCommand } from '../../src/analyzers/built/commands';
import { splitCommands } from '../../src/lib/shell';
import { buildTurnGroups } from '../../src/analyzers/turn-groups';
import { extractUserMessages } from '../../src/analyzers/user-messages';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

async function loadSession(): Promise<NormalizedSession> {
  const account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };
  const source = { id: 's', accountId: 'a', provider: 'claude-code' as const, path: path.dirname(FIX), label: 'x', kind: 'custom' as const, enabled: true };
  const draft = await claudeCodeAdapter.load({ filePath: FIX, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(), knownCwds: [] } });
  return { ...draft, key: 'k', provider: 'claude-code', sourceId: 's', accountId: 'a', projectId: 'p', projectRoot: draft.projectRoot };
}

describe('summarizeBuilt', () => {
  it('finds files created via tools, heredocs and subagents; packages; commits; stack', async () => {
    const session = await loadSession();
    const b = summarizeBuilt(session, '/home/tester');
    const created = b.filesCreated.map((f) => f.relPath ?? f.path);
    expect(created).toContain('web/.env.sample');
    expect(created).toContain('web/src/App.tsx');
    expect(created).toContain('NOTES.md');
    expect(b.filesCreated.find((f) => f.relPath === 'web/.env.sample')?.via).toBe('shell');
    expect(b.filesCreated.find((f) => f.relPath === 'web/src/App.tsx')?.count).toBe(2);
    expect(b.filesModified).toHaveLength(0);
    expect(b.dirsCreated).toContain('/home/tester/myapp/web');
    expect(b.packagesInstalled.map((p) => `${p.manager}:${p.name}${p.dev ? ':dev' : ''}`)).toEqual(['npm:react-router:dev', 'npm:vitest:dev']);
    expect(b.gitInitialized).toBe(true);
    expect(b.gitCommits).toHaveLength(1);
    expect(b.gitCommits[0]).toMatchObject({ message: 'feat: 첫 커밋', hash: 'abc1234', pushed: true });
    expect(b.stack).toEqual([]);
    const cats = Object.fromEntries(b.commandsRun.map((c) => [c.command, c.category]));
    expect(cats['npm create vite@latest web -- --template react-ts']).toBe('scaffold');
    expect(cats['npm install react-router@7 -D vitest']).toBe('install');
    expect(cats['npm run build']).toBe('build');
    expect(b.commandsRun.find((c) => c.command === 'npm run build')?.failed).toBe(1);
    expect(b.stats.errors).toBe(2); // failed build + api_error
    expect(b.stats.humanMessages).toBe(4);
    expect(b.timeline).toHaveLength(5);
    expect(b.timeline[0]?.toolCallIds).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(b.timeline[1]?.toolCallIds).toEqual(['t6', 't7', 't8', 'st1']);
  });

  it('merges summaries across sessions', async () => {
    const session = await loadSession();
    const b = summarizeBuilt(session, '/home/tester');
    const m = mergeBuilt([b, b]);
    expect(m.filesCreated.find((f) => f.relPath === 'web/src/App.tsx')?.count).toBe(4);
    expect(m.gitCommits).toHaveLength(2);
    expect(m.stats.humanMessages).toBe(8);
    expect(m.packagesInstalled).toHaveLength(2);
  });
});

describe('classifyCommand', () => {
  const c = (s: string) => classifyCommand(splitCommands(s)[0]!).category;
  it.each([
    ['npm install', 'install'],
    ['pnpm add -D typescript', 'install'],
    ['pip install -r requirements.txt', 'install'],
    ['uv add fastapi', 'install'],
    ['npm run dev', 'run'],
    ['npx vite', 'run'],
    ['bun run build', 'build'],
    ['npx tsc --noEmit', 'build'],
    ['npx eslint src', 'build'],
    ['npm test', 'test'],
    ['npx vitest run', 'test'],
    ['pytest -q', 'test'],
    ['git commit -m x', 'git'],
    ['gh repo create foo --public', 'deploy'],
    ['vercel --prod', 'deploy'],
    ['npm create vite@latest', 'scaffold'],
    ['git clone https://x/y.git', 'scaffold'],
    ['ls -la', 'inspect'],
    ['cat foo.txt', 'inspect'],
    ['cat foo.txt > bar.txt', 'file'],
    ['mkdir -p src', 'file'],
    ['sed -i s/a/b/ x.ts', 'file'],
    ['docker compose up -d', 'run'],
    ['python3 app.py', 'run'],
    ['python3 -m pytest', 'test'],
    ['curl -s http://localhost:3000', 'inspect'],
  ])('%s → %s', (cmd, cat) => {
    expect(c(cmd)).toBe(cat);
  });
});

describe('turn groups and user messages', () => {
  it('groups tool calls per prompt and computes durations', async () => {
    const session = await loadSession();
    const groups = buildTurnGroups(session);
    expect(groups.map((g) => g.promptText.split(/\s|\n/)[0])).toEqual(['리액트', '깃허브에', '/init', '/admin', '이']);
    const um = extractUserMessages(session);
    expect(um.items.map((i) => i.kind)).toEqual(['human', 'human', 'slash-command', 'human', 'human']);
    expect(um.items[0]?.turnDurationSec).toBe(18);
    expect(um.items[3]?.viaLocalCommand).toBe(true);
    expect(um.stats.human).toBe(4);
  });
});
