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
  it('masks secrets', () => {
    expect(maskSecrets('key sk-abcdefghijklmnopqrstuvwxyz1234 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 and API_KEY=supersecretvalue1')).toBe('key *** and *** and API_KEY=***');
    expect(maskSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop')).toBe('***');
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
