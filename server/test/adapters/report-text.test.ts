import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClaudeFile } from '../../src/adapters/claude-code/parse';
import { parseCopilotCliFile } from '../../src/adapters/copilot-cli/parse';
import { normalizeVscodeSession } from '../../src/adapters/copilot-vscode/parse';
import { buildTurnGroups } from '../../src/analyzers/turn-groups';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });
const report = '# 결과 보고\n\n' + '- 구현한 작업을 설명합니다.\n'.repeat(500) + '\n최종 보고의 마지막 줄';

describe('어댑터의 답변 원문 보존', () => {
  it.each(['claude-code', 'copilot-cli'] as const)('%s의 긴 답변을 만들어진 것까지 자르지 않고 전달한다', async (provider) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-report-'));
    dirs.push(dir);
    const file = path.join(dir, 'synthetic.jsonl');
    const records = provider === 'claude-code' ? [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: '작업해 줘' } },
      { type: 'assistant', uuid: 'a1', message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: report }] } },
    ] : [
      { type: 'user.message', data: { content: '작업해 줘' } },
      { type: 'assistant.message', data: { content: report } },
    ];
    await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const { draft } = await (provider === 'claude-code' ? parseClaudeFile(file) : parseCopilotCliFile(file));
    expect(draft.messages.find((m) => m.role === 'assistant')?.text).toBe(report);
    const groups = buildTurnGroups({ ...draft, key: 's1', accountId: 'a', projectId: 'p', sourceId: 'source', provider });
    expect(groups[0]?.finalAssistantText).toBe(report);
  });

  it('VS Code Copilot의 긴 답변도 같은 원문 표시 경로로 전달한다', () => {
    const draft = normalizeVscodeSession({ requests: [{ message: '작업해 줘', response: [{ kind: 'markdownContent', value: report }] }] }, '/synthetic/session.json', '/workspace/demo');
    expect(draft.messages.find((m) => m.role === 'assistant')?.text).toBe(report);
  });
});
