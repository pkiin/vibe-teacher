import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../../src/adapters/claude-code/index';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import { EnrichService } from '../../src/llm/service';
import type { LlmProvider } from '../../src/llm/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures/claude/sess-1.jsonl');

describe('EnrichService', () => {
  it('runs a job through the fake provider, caches to disk and merges concepts', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-home-'));
    const paths = resolvePaths(home);
    const store = new ConfigStore(paths);
    await store.load();
    let calls = 0;
    const provider: LlmProvider = {
      id: 'claude-cli',
      availability: async () => ({ ok: true }),
      complete: async (req) => {
        calls += 1;
        expect(req.user).toContain('리액트 프로젝트 만들어줘');
        return {
          data: req.schema.parse({
            summary: { title: 't', oneLiner: '키 sk-abcdefghijklmnopqrstuvwxyz12345', narrative: 'n', features: [], outcome: 'completed', nextSteps: [] },
            concepts: [
              { id: 'env-variables', name: '환경 변수', explanation: 'e', whyHere: 'w', example: null, level: 'beginner' },
              { id: null, name: '새 개념', explanation: 'e2', whyHere: 'w2', example: 'x', level: 'intermediate' },
            ],
          }),
          provider: 'claude-cli',
          durationMs: 1,
        };
      },
    };
    const svc = new EnrichService({ store, paths, providerOverride: provider });
    const account = { id: 'a', username: 'tester', homePath: '/home/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };
    const source = { id: 's', accountId: 'a', provider: 'claude-code' as const, path: path.dirname(FIX), label: 'x', kind: 'custom' as const, enabled: true };
    const draft = await claudeCodeAdapter.load({ filePath: FIX, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(), knownCwds: [] } });
    const session: NormalizedSession = { ...draft, key: 'k', provider: 'claude-code', sourceId: 's', accountId: 'a', projectId: 'p' };

    const started = await svc.start(session, [], false);
    expect(['queued', 'running']).toContain(started.status);
    const jobId = started.status !== 'done' ? started.jobId : '';
    let job = svc.jobs.get(jobId);
    for (let i = 0; i < 50 && job && job.state !== 'done' && job.state !== 'error'; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      job = svc.jobs.get(jobId);
    }
    expect(job?.state).toBe('done');
    expect(calls).toBe(1);
    const cached = await svc.getCached(session);
    expect(cached?.data.summary.title).toBe('t');
    expect(JSON.stringify(cached)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz12345');
    const again = await svc.start(session, [], false);
    expect(again.status).toBe('done');
    expect(calls).toBe(1);
    const merged = svc.mergeConcepts([{ id: 'env-variables', name: 'x', category: 'c', level: 'beginner', explanation: 'r', whyHere: 'r', score: 1, evidence: [] }], cached!);
    expect(merged[0]?.llm?.explanation).toBe('e');
    expect(merged[1]?.name).toBe('새 개념');
    const files = await fs.readdir(paths.enrichCacheDir);
    expect(files).toHaveLength(1);

    // 읽는 사람 수준별로 따로 쓰고 저장한다. 다른 수준의 결과는 그 수준 화면에 쓰지 않는다 (사실만 쓰는 곳은 'any')
    expect(cached?.readerLevel).toBe('non-dev');
    expect(await svc.getCached(session, 'senior')).toBeNull();
    expect((await svc.getCached(session, 'any'))?.data.summary.title).toBe('t');
    expect(svc.preview(session, [], 'senior').system).toContain('읽는 사람: 숙련 개발자');
    expect(svc.preview(session, []).system).toContain('읽는 사람: 개발을 전혀 모르는 사람');
  });
});
