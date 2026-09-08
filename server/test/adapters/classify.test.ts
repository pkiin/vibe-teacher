import { describe, expect, it } from 'vitest';
import { classifySystemRecord, classifyUserRecord } from '../../src/adapters/claude-code/classify';
import type { SystemRecord, UserRecord } from '../../src/adapters/claude-code/records';

const u = (content: UserRecord['message']['content'], extra: Partial<UserRecord> = {}): UserRecord => ({ type: 'user', message: { role: 'user', content }, ...extra });

describe('classifyUserRecord', () => {
  it.each([
    ['string prompt', u('안녕'), 'human'],
    ['tool result block', u([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]), 'tool_result'],
    ['toolUseResult field', u('x', { toolUseResult: { stdout: '' } }), 'tool_result'],
    ['sidechain', u('x', { isSidechain: true }), 'skip'],
    ['isMeta', u([{ type: 'text', text: 'Please analyze' }], { isMeta: true }), 'system-injected'],
    ['slash command', u('<command-message>init</command-message>\n<command-name>/init</command-name>'), 'slash-command'],
    ['local-command', u('<local-command-stdout>x</local-command-stdout>'), 'system-injected'],
    ['task-notification', u('<task-notification>\n<task-id>1</task-id>\n</task-notification>'), 'system-injected'],
    ['system-reminder', u([{ type: 'text', text: '<system-reminder>x</system-reminder>' }]), 'system-injected'],
    ['interrupt', u([{ type: 'text', text: '[Request interrupted by user for tool use]' }]), 'interrupt'],
    ['empty', u('   '), 'skip'],
  ])('%s → %s', (_name, rec, kind) => {
    expect(classifyUserRecord(rec).kind).toBe(kind);
  });

  it('drops the ide_opened_file block but keeps the real prompt and the path', () => {
    const rec = u([
      { type: 'text', text: '<ide_opened_file>The user opened the file /a/b.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>' },
      { type: 'text', text: '깃허브에 커밋해줘' },
    ]);
    const c = classifyUserRecord(rec);
    expect(c.kind).toBe('human');
    if (c.kind === 'human') {
      expect(c.text).toBe('깃허브에 커밋해줘');
      expect(c.openedFiles).toEqual(['/a/b.ts']);
    }
  });

  it('keeps image-only prompts as human with a marker', () => {
    const c = classifyUserRecord(u([{ type: 'image', source: {} }]));
    expect(c.kind).toBe('human');
    if (c.kind === 'human') expect(c.text).toBe('[이미지 첨부]');
  });

  it('extracts slash command name and args', () => {
    const c = classifyUserRecord(u('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>src</command-args>'));
    expect(c).toMatchObject({ kind: 'slash-command', name: '/review', args: 'src' });
  });
});

describe('classifySystemRecord', () => {
  const s = (subtype: string, content: string, extra: Partial<SystemRecord> = {}): SystemRecord => ({ type: 'system', subtype, content, ...extra });
  it('recovers /-prefixed prompts stored as local_command', () => {
    expect(classifySystemRecord(s('local_command', '/admin 버튼 붙여줘'))).toEqual({ kind: 'human', text: '/admin 버튼 붙여줘' });
    expect(classifySystemRecord(s('local_command', '<local-command-stdout>Unknown command</local-command-stdout>')).kind).toBe('system-injected');
  });
  it('marks api_error as error', () => {
    const c = classifySystemRecord(s('api_error', '', { error: { message: '401' } }));
    expect(c).toMatchObject({ kind: 'system-injected', isError: true });
  });
  it('skips unknown subtypes', () => {
    expect(classifySystemRecord(s('other', 'x')).kind).toBe('skip');
  });
});
