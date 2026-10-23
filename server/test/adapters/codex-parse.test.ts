import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account, Source } from '@vibe-teacher/shared';
import { parseCodexFile } from '../../src/adapters/codex/parse';
import { codexAdapter } from '../../src/adapters/codex/index';
import { extractUserMessages } from '../../src/analyzers/user-messages';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const user = (text: string) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const event = (message: string, extra = {}) => ({ type: 'event_msg', payload: { type: 'user_message', message, ...extra } });
const ide = (request: string) => `# Context from my IDE setup:\n## Active file: app.ts\n## Open tabs:\n- app.ts\n\n## My request:\n${request}`;

async function fixture(records: unknown[], name = 'rollout-main.jsonl') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-codex-'));
  dirs.push(dir);
  const file = path.join(dir, 'sessions', name);
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, records.map((record, i) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 8, 1, 11, 0, i)).toISOString(), ...record as object })).join('\n') + '\n');
  return { dir, file };
}

describe('Codex 메시지 파싱 회귀 검사', () => {
  it('이벤트와 응답에 중복 저장된 IDE 입력에서 요청만 한 번 추출한다', async () => {
    const { file } = await fixture([
      user('<external_codex_apps_open_page>자동 페이지 정보</external_codex_apps_open_page>'),
      user(ide('버튼을 고쳐줘')), event(ide('버튼을 고쳐줘')),
      user(ide('테스트도 실행해줘')), event(ide('테스트도 실행해줘')),
    ]);
    const { draft } = await parseCodexFile(file);
    expect(draft.messages.map((message) => message.text)).toEqual(['버튼을 고쳐줘', '테스트도 실행해줘']);
    expect(draft.counts.human).toBe(2);
    expect(draft.title).toBe('버튼을 고쳐줘');
  });

  it('4천 자보다 긴 IDE 문맥·지침 뒤 요청이 잘리지 않는다', async () => {
    const { file } = await fixture([
      event(ide('버튼을 고쳐줘').replace('## Active file: app.ts', `## Open tabs:\n${'- example.ts\n'.repeat(500)}`)),
      event(`<user_instructions>${'작업 규칙\n'.repeat(1000)}</user_instructions>\n실행 결과도 알려줘`),
    ]);
    const { draft } = await parseCodexFile(file);
    expect(draft.messages.map((message) => message.text)).toEqual(['버튼을 고쳐줘', '실행 결과도 알려줘']);
  });

  it('이벤트가 없는 기록도 자동 문맥을 제외하고 조각난 요청과 이미지를 복구한다', async () => {
    const { file } = await fixture([
      user('# AGENTS.md instructions for /workspace/demo\n<INSTRUCTIONS>자동 규칙</INSTRUCTIONS>'),
      user('<external_codex_apps_open_page>자동 문맥</external_codex_apps_open_page>'),
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: '<user_instructions>\n자동 규칙' },
        { type: 'input_text', text: '</user_instructions>\n' + ide('이미지를 확인해줘') },
        { type: 'input_image', image_url: 'data:synthetic' },
        { type: 'unknown', text: '사람의 입력이 아닌 추가 정보' },
      ] } },
      user('/review app.ts'),
    ]);
    const { draft } = await parseCodexFile(file);
    expect(draft.messages.map((message) => [message.role, message.text])).toEqual([
      ['human', '이미지를 확인해줘\n[이미지 1장]'], ['slash-command', 'review app.ts'],
    ]);
    expect(draft.counts.human).toBe(1);
    expect(draft.counts.slashCommands).toBe(1);
    expect(draft.messages[1]?.meta?.commandName).toBe('review');
  });

  it('이벤트가 자동 문맥뿐이어도 다른 response_item을 사람 입력으로 되살리지 않는다', async () => {
    const { file } = await fixture([user('자동으로 전달된 요청'), event('<environment_context>자동 문맥</environment_context>')]);
    const { draft } = await parseCodexFile(file);
    expect(draft.messages).toEqual([]);
    expect(draft.counts.human).toBe(0);
    expect(draft.firstPrompt).toBeUndefined();
  });

  it('이미지만 첨부한 입력과 슬래시 명령을 보존한다', async () => {
    const { file } = await fixture([event('', { images: ['synthetic'] }), event('/review app.ts')]);
    const { draft } = await parseCodexFile(file);
    expect(draft.messages.map((message) => [message.role, message.text])).toEqual([['human', '[이미지 1장]'], ['slash-command', 'review app.ts']]);
    expect(draft.counts.human).toBe(1);
    expect(draft.counts.slashCommands).toBe(1);
  });

  it.each([{ source: { subagent: { other: 'guardian' } } }, { source: { subagent: { thread_spawn: { depth: 1 } } } }, { parent_thread_id: 'parent-demo' }])('내부 세션을 직접 읽어도 사용자 메시지가 나오지 않는다: %j', async (meta) => {
    const { file } = await fixture([
      { type: 'session_meta', payload: { id: 'agent-demo', ...meta } },
      user('내부 자동 검토 요청'), event('내부 위임 요청'),
    ]);
    const { draft } = await parseCodexFile(file);
    expect(draft.counts.human).toBe(0);
    expect(draft.firstPrompt).toBeUndefined();
    expect(draft.messages).toEqual([]);
  });

  it('발견·세션 수·내 메시지 API가 모두 하위 에이전트를 제외한다', async () => {
    const { dir, file } = await fixture([
      { type: 'session_meta', payload: { id: 'main-demo', source: 'vscode' } },
      event(ide('로그인을 고쳐줘')),
    ]);
    await fs.writeFile(path.join(path.dirname(file), 'rollout-guardian.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'guardian-demo', source: { subagent: { other: 'guardian' } } } }) + '\n' + JSON.stringify(user('내부 검토 요청')) + '\n');
    const source: Source = { id: 's', accountId: 'a', provider: 'codex', path: dir, kind: 'custom', label: '합성 기록', enabled: true };
    const account: Account = { id: 'a', username: 'tester', homePath: dir, isCurrent: false, readable: 'ok', sourceCount: 1, sessionCount: 1, projectCount: 1 };
    const files = [];
    for await (const item of codexAdapter.listSessionFiles(source)) files.push(item);
    expect(files.map((item) => item.filePath)).toEqual([file]);
    expect((await codexAdapter.probe(source)).sessionCount).toBe(1);
    const draft = await codexAdapter.load(files[0]!, source, { account });
    const result = extractUserMessages({ ...draft, key: 'k', accountId: 'a', sourceId: 's', projectId: 'p', provider: 'codex' });
    expect(result.items.map((item) => item.text)).toEqual(['로그인을 고쳐줘']);
    expect(result.stats.human).toBe(1);
  });
});
