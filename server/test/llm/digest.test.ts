import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { detectConcepts } from '../../src/analyzers/concepts/index';
import { buildDigest, maskSecrets } from '../../src/llm/digest';
import { fakeSession } from '../wiki/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

describe('digest', () => {
  it('AI에도 잘린 발췌 대신 작업 연결 설명과 근거 범위를 보낸다', () => {
    const session = fakeSession([
      { assistant: '화면을 바꾸고 README에 안내를 적었습니다.' },
      { assistant: 'README 안내를 보세요.' },
      { assistant: 'README를 다시 확인했습니다.' },
    ]);
    const built = summarizeBuilt(session);
    const concepts = detectConcepts(session, built);
    const candidates = buildDigest(session, built, concepts).split('## 규칙 기반 개념 후보')[1] ?? '';
    expect(candidates).toContain('markdown-readme');
    expect(candidates).toContain('대화에서 언급됨. 실제 사용·실행은 미확인');
    expect(candidates).toContain('사용법과 실행 방법');
    expect(candidates).not.toContain('화면을 바꾸고 README');
  });

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
    const concepts = detectConcepts(session, built);
    const d = buildDigest(session, built, concepts, { maxChars: 3000 });
    expect(d).toContain('리액트 프로젝트 만들어줘');
    expect(d).toContain('web/.env.sample');
    expect(d).toContain('feat: 첫 커밋');
    expect(d).toContain('env-variables');
    expect(d).not.toContain('3 files changed');
    expect(d.length).toBeLessThanOrEqual(3100);
  });
});
