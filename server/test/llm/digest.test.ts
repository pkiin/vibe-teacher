import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { buildDigest, maskSecrets } from '../../src/llm/digest';
import { fakeSession } from '../wiki/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

describe('digest', () => {
  it('화면용 보고가 길어도 AI에는 제한한 발췌만 보낸다', () => {
    const session = fakeSession([{ human: '기능을 정리해 줘' }, { assistant: '작업 결과입니다.\n' + '설명문장'.repeat(2000) + '\n보고의 마지막 표시' }]);
    const built = summarizeBuilt(session);
    expect(built.timeline[0]?.finalAssistantText).toContain('보고의 마지막 표시');
    const digest = buildDigest(session, built, []);
    expect(digest).toContain('작업 결과입니다.');
    expect(digest).not.toContain('보고의 마지막 표시');
  });
  it('masks secrets', () => {
    expect(maskSecrets('key sk-abcdefghijklmnopqrstuvwxyz1234 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 and API_KEY=supersecretvalue1')).toBe('key *** and *** and API_KEY=***');
    expect(maskSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop')).toBe('***');
  });

  it('masks Supabase secret keys and PostgreSQL URL passwords in free text', () => {
    expect(maskSecrets('키 sb_secret_abcdefghijklmnopqrstuvwxyz123456')).toBe('키 ***');
    expect(maskSecrets('postgresql://tester:my%40private-password@db.example.com/postgres')).toBe('postgresql://tester:***@db.example.com/postgres');
    expect(maskSecrets('postgres://tester:another-password@127.0.0.1/db')).toBe('postgres://tester:***@127.0.0.1/db');
  });

  it('includes user messages, facts and timeline within budget and never raw tool output', async () => {
    const account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };
    const source = { id: 's', accountId: 'a', provider: 'claude-code' as const, path: path.dirname(FIX), label: 'x', kind: 'custom' as const, enabled: true };
    const draft = await claudeCodeAdapter.load({ filePath: FIX, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(), knownCwds: [] } });
    const session: NormalizedSession = { ...draft, key: 'k', provider: 'claude-code', sourceId: 's', accountId: 'a', projectId: 'p' };
    const built = summarizeBuilt(session, '/home/tester');
    const concepts: [] = [];
    const d = buildDigest(session, built, concepts, { maxChars: 3000 });
    expect(d).toContain('리액트 프로젝트 만들어줘');
    expect(d).toContain('web/.env.sample');
    expect(d).toContain('feat: 첫 커밋');
    expect(d).not.toContain('규칙 기반 개념');
    expect(d).not.toContain('3 files changed');
    expect(d.length).toBeLessThanOrEqual(3100);
  });
});
