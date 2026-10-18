import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { compileConcepts, detectConcepts, loadConceptDictionary } from '../../src/analyzers/concepts/index';

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
      else expect(triggers, c.id).toBeGreaterThan(0);
    }
  });
  it('rejects duplicate ids', () => {
    const e = { id: 'x', name: 'x', category: 'c', triggers: { files: [], commands: [], packages: [], text: ['x'], stack: [] }, explanation: 'y' };
    expect(() => compileConcepts([e, e])).toThrow(/중복/);
  });
});

describe('detectConcepts', () => {
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
