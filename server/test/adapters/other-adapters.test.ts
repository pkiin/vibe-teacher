import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Account, Source } from '@vibe-teacher/shared';
import { codexAdapter } from '../../src/adapters/codex/index';
import { parseApplyPatch } from '../../src/adapters/codex/apply-patch';
import { copilotCliAdapter } from '../../src/adapters/copilot-cli/index';
import { copilotVscodeAdapter } from '../../src/adapters/copilot-vscode/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures');
const account: Account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok', sourceCount: 0, sessionCount: 0, projectCount: 0 };
const src = (provider: Source['provider'], p: string): Source => ({ id: 's', accountId: 'a', provider, path: p, label: 'x', kind: 'custom', enabled: true });

async function files(adapter: { listSessionFiles: (s: Source) => AsyncIterable<{ filePath: string; size: number; mtimeMs: number }> }, source: Source) {
  const out = [];
  for await (const f of adapter.listSessionFiles(source)) out.push(f);
  return out;
}

describe('codex adapter', () => {
  const source = src('codex', path.join(FIX, 'codex'));
  it('discovers rollout files under sessions/', async () => {
    const list = await files(codexAdapter, source);
    expect(list.map((f) => path.basename(f.filePath))).toEqual(['rollout-2026-09-01T11-00-00-cx-1.jsonl']);
    expect((await codexAdapter.probe(source)).sessionCount).toBe(1);
  });
  it('uses event_msg user_message as the only human source and maps tools', async () => {
    const [f] = await files(codexAdapter, source);
    const d = await codexAdapter.load(f!, source, { account });
    expect(d.sessionId).toBe('cx-1');
    expect(d.projectRoot).toBe('/home/tester/pyapp');
    expect(d.toolVersion).toBe('0.50.0');
    expect(d.gitBranch).toBe('dev');
    expect(d.models).toEqual(['gpt-5-codex']);
    expect(d.messages.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['FastAPI 서버 만들어줘', '테스트도 붙여줘\n[이미지 1장]']);
    expect(d.counts.human).toBe(2);
    expect(d.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    const names = d.toolCalls.map((t) => `${t.name}:${t.category}`);
    expect(names).toEqual(['shell:shell', 'apply_patch:file_write', 'apply_patch:file_edit', 'apply_patch:file_edit', 'local_shell:shell', 'web_search:web']);
    expect(d.toolCalls[0]?.command).toBe('bash -lc pip install fastapi uvicorn');
    expect(d.toolCalls[0]?.result?.ok).toBe(true);
    expect(d.toolCalls[1]?.result?.structured).toEqual({ kind: 'create', filePath: 'app/main.py' });
    expect(d.toolCalls[3]?.result?.structured).toEqual({ kind: 'delete', filePath: 'old.txt' });
    expect(d.toolCalls[4]?.command).toBe('uvicorn app.main:app --port 8000');
    expect(d.messages.some((m) => m.meta?.subtype === 'compacted')).toBe(true);
    expect(d.messages.filter((m) => m.role === 'system-injected' && m.text === 'developer note')).toHaveLength(1);
  });
  it('falls back to response_item user messages with wrapper tags stripped', async () => {
    const f = { filePath: path.join(FIX, 'codex/no-event-msg.jsonl'), size: 1, mtimeMs: 1 };
    const d = await codexAdapter.load(f, source, { account });
    expect(d.messages.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['FastAPI 서버 만들어줘']);
    expect(d.counts.human).toBe(1);
  });
  it('parses apply_patch blocks', () => {
    expect(parseApplyPatch('*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n*** End Patch')).toEqual([{ kind: 'update', path: 'a.ts', moveTo: 'b.ts' }]);
  });
});

describe('copilot cli adapter', () => {
  const source = src('copilot-cli', path.join(FIX, 'copilot-cli'));
  it('finds session-state events and normalizes them', async () => {
    const list = await files(copilotCliAdapter, source);
    expect(list).toHaveLength(1);
    const d = await copilotCliAdapter.load(list[0]!, source, { account });
    expect(d.sessionId).toBe('abc-123');
    expect(d.title).toBe('Go 서버 만들기');
    expect(d.projectRoot).toBe('/home/tester/goapp');
    expect(d.models).toEqual(['gpt-5']);
    expect(d.messages.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['Go 서버 만들어줘']);
    expect(d.messages.filter((m) => m.role === 'slash-command')[0]?.meta?.commandName).toBe('help');
    expect(d.counts.human).toBe(1);
    expect(d.counts.slashCommands).toBe(1);
    expect(d.counts.subagents).toBe(1);
    const names = d.toolCalls.map((t) => `${t.name}:${t.category}`);
    expect(names).toEqual(['bash:shell', 'create:file_write', 'str_replace_editor:file_write', 'view:file_read', 'task:agent']);
    expect(d.toolCalls[1]?.result?.structured).toEqual({ kind: 'create', filePath: '/home/tester/goapp/main.go' });
    expect(d.toolCalls[4]?.result?.ok).toBe(false);
  });
  it('probe reports an empty directory as zero sessions with a note', async () => {
    const empty = src('copilot-cli', path.join(FIX, 'codex'));
    const st = await copilotCliAdapter.probe(empty);
    expect(st.sessionCount).toBe(0);
    expect(st.note).toBeTruthy();
  });
});

describe('vscode copilot adapter', () => {
  const source = src('copilot-vscode', path.join(FIX, 'copilot-vscode'));
  it('lists only .json sessions and notes unsupported shards', async () => {
    const list = await files(copilotVscodeAdapter, source);
    expect(list.map((f) => path.basename(f.filePath))).toEqual(['vs-1.json']);
    const st = await copilotVscodeAdapter.probe(source);
    expect(st.sessionCount).toBe(1);
  });
  it('normalizes requests, tool invocations and edit groups', async () => {
    const [f] = await files(copilotVscodeAdapter, source);
    const d = await copilotVscodeAdapter.load(f!, source, { account });
    expect(d.sessionId).toBe('vs-1');
    expect(d.title).toBe('버튼 색 바꾸기');
    expect(d.projectRoot).toBe('/home/tester/webapp');
    expect(d.messages.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['버튼 색을 파란색으로 바꿔줘']);
    expect(d.messages.filter((m) => m.role === 'slash-command')[0]?.meta?.commandName).toBe('fix');
    expect(d.toolCalls.map((t) => t.category)).toEqual(['file_read', 'shell', 'file_edit']);
    expect(d.toolCalls[1]?.command).toBe('npm test');
    expect(d.toolCalls[2]?.paths).toEqual(['/home/tester/webapp/src/Button.tsx']);
    expect(d.messages.filter((m) => m.role === 'assistant').map((m) => m.text)).toEqual(['네, 바꾸겠습니다.', '완료했습니다.', '고쳤습니다.']);
    expect(d.messages.some((m) => m.role === 'system-injected' && m.isError)).toBe(true);
  });
});
