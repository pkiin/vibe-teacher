import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { compileConcepts, detectConcepts, loadConceptDictionary } from '../../src/analyzers/concepts/index';
import { fakeSession } from '../wiki/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

describe('concept dictionary', () => {
  it('validates and compiles every entry', () => {
    const dict = loadConceptDictionary();
    expect(dict.length).toBeGreaterThan(25);
    for (const c of dict) {
      expect(c.explanation.length).toBeGreaterThan(30);
      const triggers = c.re.files.length + c.re.commands.length + c.re.packages.length + c.re.text.length + c.re.stack.length;
      if (c.wikiOnly) expect(triggers, c.id).toBe(0);
      else {
        expect(triggers, c.id).toBeGreaterThan(0);
        expect(c.whyItMatters?.length ?? 0, c.id).toBeGreaterThan(20);
      }
    }
  });
  it('rejects duplicate ids', () => {
    const e = { id: 'x', name: 'x', category: 'c', triggers: { files: [], commands: [], packages: [], text: ['x'], stack: [] }, explanation: 'y' };
    expect(() => compileConcepts([e, e])).toThrow(/중복/);
  });
});

describe('detectConcepts', () => {
  const readmeMentions = [
    { assistant: '화면을 정리했습니다. 안내는 [README](/workspace/demo/README.md)를 보세요.' },
    { assistant: '설정 저장 방법을 README에 적었습니다.' },
    { assistant: 'README 안내를 다시 확인했습니다.' },
  ];

  it('대화 발췌 대신 실용적인 이유를 설명하고 단순 언급임을 알린다', () => {
    const session = fakeSession(readmeMentions);
    const hit = detectConcepts(session, summarizeBuilt(session)).find((c) => c.id === 'markdown-readme')!;
    expect(hit.contextKind).toBe('mention');
    expect(hit.whyHere).toContain('실제 사용 여부는 확인되지 않았습니다');
    expect(hit.whyHere).toContain('사용법과 실행 방법');
    expect(hit.whyHere).not.toMatch(/화면을 정리|workspace|\[README\]|외 \d+개|…|등이 나타났습니다/);
    expect(hit.evidence.some((e) => e.snippet.includes('/workspace/demo/README.md'))).toBe(true);
  });

  it('파일 변경과 그 작업에 도움이 되는 이유를 연결한다', () => {
    const session = fakeSession([{ write: 'README.md', edit: true }, ...readmeMentions]);
    const hit = detectConcepts(session, summarizeBuilt(session)).find((c) => c.id === 'markdown-readme')!;
    expect(hit.contextKind).toBe('activity');
    expect(hit.whyHere).toContain('README.md 파일의 변경 기록');
    expect(hit.whyHere).toContain('사용법과 실행 방법');
    expect(hit.whyHere).not.toMatch(/실제 사용 여부는 확인되지|화면을 정리|외 \d+개|…/);
    expect(hit.evidence.length).toBeGreaterThan(1);
  });

  it('실패한 테스트를 실행 성공으로 설명하지 않는다', () => {
    const session = fakeSession([{ shell: 'npm test', ok: false, stderr: '합성 테스트 실패' }]);
    const hit = detectConcepts(session, summarizeBuilt(session)).find((c) => c.id === 'testing')!;
    expect(hit.contextKind).toBe('activity');
    expect(hit.whyHere).toContain('npm test 명령을 실행한 기록');
    expect(hit.whyHere).toContain('어떤 경우를 검사했는지');
    expect(hit.whyHere).not.toMatch(/통과|성공했습니다/);
  });

  it('처음 보는 사용자 사전에도 확인하지 않은 작업을 덧붙이지 않는다', () => {
    const dictionary = compileConcepts([{ id: 'custom', name: '새 개념', category: '기타', triggers: { text: ['새 개념'] }, explanation: '사용자 사전에 정의한 설명입니다.' }]);
    const session = fakeSession([{ human: '새 개념을 설명해줘' }, { human: '새 개념을 다시 알려줘' }]);
    const hit = detectConcepts(session, summarizeBuilt(session), dictionary)[0]!;
    expect(hit.contextKind).toBe('mention');
    expect(hit.whyHere).toContain('실제 사용 여부는 확인되지 않았습니다');
    expect(hit.whyHere).not.toContain('설명해줘');
  });

  it('finds env-variables, git, npm and react concepts with evidence from the fixture', async () => {
    const account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };
    const source = { id: 's', accountId: 'a', provider: 'claude-code' as const, path: path.dirname(FIX), label: 'x', kind: 'custom' as const, enabled: true };
    const draft = await claudeCodeAdapter.load({ filePath: FIX, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(), knownCwds: [] } });
    const session: NormalizedSession = { ...draft, key: 'k', provider: 'claude-code', sourceId: 's', accountId: 'a', projectId: 'p' };
    const built = summarizeBuilt(session, '/home/tester');
    const hits = detectConcepts(session, built);
    const ids = hits.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['env-variables', 'git-basics', 'npm-package-json', 'react-components', 'vite', 'testing']));
    const env = hits.find((h) => h.id === 'env-variables')!;
    expect(env.evidence.some((e) => e.snippet.includes('.env.sample'))).toBe(true);
    expect(env.whyHere).toContain('.env.sample');
    expect(env.score).toBeLessThanOrEqual(6);
    expect(hits.length).toBeLessThanOrEqual(20);
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(1);
  });
});
