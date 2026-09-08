import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { parseClaudeFile } from '../../src/adapters/claude-code/parse';
import { decodeProjectDir, encodeCwd } from '../../src/adapters/claude-code/paths';
import type { Source } from '@vibe-teacher/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

describe('parseClaudeFile', () => {
  it('extracts exactly the human prompts, slash commands and tool calls', async () => {
    const r = await parseClaudeFile(FIX);
    const d = r.draft;
    const humans = d.messages.filter((m) => m.role === 'human').map((m) => m.text);
    expect(humans).toEqual(['리액트 프로젝트 만들어줘', '깃허브에 커밋해줘', '/admin 목록에 버튼 붙여줘', '이 스크린샷처럼 고쳐줘\n[이미지 첨부]']);
    expect(d.counts.human).toBe(4);
    expect(d.counts.slashCommands).toBe(1);
    expect(d.messages.filter((m) => m.role === 'slash-command')[0]?.meta?.commandName).toBe('/init');
    expect(d.counts.toolCalls).toBe(8);
    expect(d.toolCalls.map((t) => t.name)).toEqual(['Bash', 'Bash', 'Write', 'Edit', 'Read', 'Bash', 'Bash', 'Agent']);
    expect(d.messages.filter((m) => m.role === 'interrupt')).toHaveLength(1);
    expect(d.messages.filter((m) => m.role === 'system-injected' && m.isError)).toHaveLength(1);
    expect(r.aiTitle).toBe('마지막 제목');
    expect(r.lastPrompt).toBe('이 스크린샷처럼 고쳐줘');
    expect(r.cwd).toBe('/home/tester/myapp');
    expect(d.models).toEqual(['claude-opus-5']);
    expect(d.parseWarnings.some((w) => w.includes('partial trailing'))).toBe(true);
    expect(d.messages.find((m) => m.role === 'human' && m.meta?.openedFiles)?.meta?.openedFiles).toEqual(['/home/tester/myapp/web/src/App.tsx']);
  });

  it('links tool results and structures Write/Edit/Bash outputs', async () => {
    const { draft, agentIdToMessageIndex } = await parseClaudeFile(FIX);
    const byId = new Map(draft.toolCalls.map((t) => [t.id, t]));
    expect(byId.get('t3')?.result?.structured).toEqual({ kind: 'create', filePath: '/home/tester/myapp/web/src/App.tsx' });
    expect(byId.get('t4')?.result?.structured).toMatchObject({ kind: 'update', linesAdded: 2, linesRemoved: 1 });
    expect(byId.get('t7')?.result?.ok).toBe(false);
    expect((byId.get('t6')?.result?.structured as { stdout: string }).stdout).toContain('abc1234');
    expect(agentIdToMessageIndex.get('agentx')).toBe(byId.get('t8')?.messageIndex);
  });

  it('assistant text blocks from the same message id are merged and counted once', async () => {
    const { draft } = await parseClaudeFile(FIX);
    expect(draft.counts.assistant).toBe(6);
  });

  it('light mode keeps counts but no messages', async () => {
    const { draft } = await parseClaudeFile(FIX, { light: true });
    expect(draft.messages).toHaveLength(0);
    expect(draft.counts.human).toBe(4);
    expect(draft.firstPrompt).toBe('리액트 프로젝트 만들어줘');
  });
});

describe('claudeCodeAdapter.load', () => {
  const source: Source = { id: 's', accountId: 'a', provider: 'claude-code', path: path.resolve(here, '../fixtures/claude'), label: 'x', kind: 'custom', enabled: true };
  const account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };

  it('merges subagent tool calls with parent linkage and never counts subagent prompts as human', async () => {
    const draft = await claudeCodeAdapter.load({ filePath: FIX, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(['sess-1']), knownCwds: [] } });
    expect(draft.counts.subagents).toBe(1);
    expect(draft.counts.human).toBe(4);
    const sub = draft.toolCalls.find((t) => t.subagentId === 'agentx');
    expect(sub?.name).toBe('Write');
    expect(sub?.parentMessageIndex).toBe(draft.toolCalls.find((t) => t.id === 't8')?.messageIndex);
    expect(draft.isLive).toBe(true);
    expect(draft.title).toBe('마지막 제목');
    expect(draft.sessionId).toBe('sess-1');
  });
});

describe('project dir decoding', () => {
  it('prefers known cwds and falls back to naive decoding', () => {
    expect(encodeCwd('/home/tester/my-app')).toBe('-home-tester-my-app');
    expect(decodeProjectDir('-home-tester-my-app', ['/home/tester/my-app'])).toEqual({ cwd: '/home/tester/my-app', certain: true });
    expect(decodeProjectDir('-home-tester-my-app', [])).toEqual({ cwd: '/home/tester/my/app', certain: false });
  });
});
