import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedSession } from '@vibe-teacher/shared';
import { claudeCodeAdapter } from '../src/adapters/claude-code/index';
import { CloudAiLog, toJsonb } from '../src/cloud/ai-log';
import { CloudClient, type CloudConfig } from '../src/cloud/client';
import { CloudStorage } from '../src/cloud/storage';
import { ConfigStore, resolvePaths } from '../src/config/store';
import { EnrichService } from '../src/llm/service';
import { WikiStorage } from '../src/storage/store';

const ALICE = '11111111-1111-4111-8111-111111111111';
const config: CloudConfig = { url: 'https://example.supabase.co', key: 'sb_publishable_test', deployment: 'shared', secure: true };
const here = path.dirname(fileURLToPath(import.meta.url));
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))); });

/** Supabase Data API 경계를 흉내 낸다. 표마다 추가된 행을 모은다. */
function fakeSupabase(opts: { fail?: boolean } = {}) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const documents = new Map<string, unknown>();
  const auth: string[] = [];
  const request = (async (input, init) => {
    const url = new URL(String(input));
    auth.push(new Headers(init?.headers).get('authorization') ?? '');
    if (opts.fail) return Response.json({ message: 'relation does not exist' }, { status: 404 });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const table = url.pathname.replace('/rest/v1/', '');
      if (table === 'vt_documents') documents.set(String(body.key), body.value);
      (rows[table] ??= []).push(body);
      return new Response(null, { status: 201 });
    }
    const key = url.searchParams.get('key')?.slice(3) ?? '';
    return Response.json(documents.has(key) ? [{ value: documents.get(key) }] : []);
  }) as typeof fetch;
  return { request, rows, documents, auth };
}

describe('Supabase AI 호출 기록', () => {
  it('인증 주체의 UUID로 호출 행을 추가하고 비밀값·NUL 문자를 정리한다', async () => {
    const remote = fakeSupabase();
    const log = new CloudAiLog(new CloudClient(config, 'alice-token', remote.request), ALICE);
    await log.call({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', provider: 'openrouter', task: 'text', schemaName: 'x', attempt: 1, outputMode: 'json_schema',
      startedAt: '2026-11-03T00:00:00.000Z', durationMs: 12.6, status: 'ok', requestedModel: 'm',
      request: { body: { messages: [{ role: 'user', content: '키 sk-abcdefghijklmnopqrstuvwxyz12345 와 \u0000 문자' }] } },
      response: { choices: [] }, output: { title: 't' }, usage: { inputTokens: 10, outputTokens: 2, raw: { prompt_tokens: 10 } }, costUsd: 0.0001,
    });
    const row = remote.rows.vt_ai_calls![0]!;
    expect(remote.auth).toEqual(['Bearer alice-token']);
    expect(row).toMatchObject({ user_id: ALICE, run_id: null, provider: 'openrouter', model: 'm', input_tokens: 10, output_tokens: 2, cost_usd: 0.0001, duration_ms: 13, output: { title: 't' } });
    const text = JSON.stringify(row);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz12345');
    expect(text).not.toContain('\\u0000');
    expect(toJsonb({ 'a\u0000': ['b\u0000'] })).toEqual({ 'a�': ['b�'] });
  });

  it('기록 저장 실패는 AI 작업을 막지 않고 내용 없이 경고만 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = new CloudAiLog(new CloudClient(config, 'alice-token', fakeSupabase({ fail: true }).request), ALICE);
    await expect(log.run({ trace: { runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', feature: 'repo_wiki' }, status: 'done', startedAt: 'a', finishedAt: 'b', result: { secret: 'sk-abcdefghijklmnopqrstuvwxyz12345' } })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).not.toContain('sk-');
  });

  it('회원 모드 세션 분석은 실제 요청·응답과 최종 결과물을 같은 실행 ID로 Supabase에 남긴다', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-ai-log-')); dirs.push(home);
    const paths = resolvePaths(home);
    const store = new ConfigStore(paths); await store.load();
    await store.update((cfg) => { cfg.llm.provider = 'openrouter'; });
    const remote = fakeSupabase();
    const storage = new WikiStorage(home, undefined, new CloudStorage(new CloudClient(config, 'alice-token', remote.request), ALICE, path.join(home, 'wiki')));
    const sent: string[] = [];
    const openrouter = (async (input, init) => {
      if (String(input).endsWith('/models')) return Response.json({ data: [] });
      sent.push(String(init?.body));
      const data = { summary: { title: '합성 요약', oneLiner: 'o', narrative: 'n', features: [], outcome: 'completed', nextSteps: [] }, concepts: [] };
      return Response.json({ id: 'gen-synthetic', model: 'openai/gpt-5-mini', choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980, cost: 0.0021 } });
    }) as typeof fetch;
    const svc = new EnrichService({ store, paths, storage, env: { OPENROUTER_API_KEY: 'sk-or-synthetic-0000000000000000', VIBE_TEACHER_LLM_PROVIDER: 'openrouter' }, fetch: openrouter });
    const fixture = path.resolve(here, 'fixtures/claude/sess-1.jsonl');
    const account = { id: 'a', username: 'tester', homePath: '/synthetic/tester', isCurrent: false, readable: 'ok' as const, sourceCount: 0, sessionCount: 0, projectCount: 0 };
    const source = { id: 's', accountId: 'a', provider: 'claude-code' as const, path: path.dirname(fixture), label: 'x', kind: 'custom' as const, enabled: true };
    const draft = await claudeCodeAdapter.load({ filePath: fixture, size: 1, mtimeMs: 1 }, source, { account, extra: { liveSessionIds: new Set(), knownCwds: [] } });
    const session: NormalizedSession = { ...draft, key: 'k', provider: 'claude-code', sourceId: 's', accountId: 'a', projectId: 'p' };

    const started = await svc.start(session, [], false, 'junior');
    const jobId = started.status !== 'done' ? started.jobId : '';
    let job = svc.jobs.get(jobId);
    for (let i = 0; i < 100 && job && (job.state === 'queued' || job.state === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      job = svc.jobs.get(jobId);
    }
    expect(job?.state).toBe('done');

    const [call] = remote.rows.vt_ai_calls ?? [];
    const [run] = remote.rows.vt_ai_runs ?? [];
    expect(call).toMatchObject({ user_id: ALICE, feature: 'session_enrich', project_id: 'p', session_key: 'k', reader_level: 'junior', schema_name: 'session_enrichment',
      status: 'ok', model: 'openai/gpt-5-mini', generation_id: 'gen-synthetic', input_tokens: 900, output_tokens: 80, total_tokens: 980, cost_usd: 0.0021 });
    // 실제로 보낸 본문과 같은 내용을 남긴다
    expect((call!.request as { body: unknown }).body).toEqual(JSON.parse(sent[0]!));
    expect(call!.output).toMatchObject({ summary: { title: '합성 요약' } });
    expect(run).toMatchObject({ id: call!.run_id, user_id: ALICE, feature: 'session_enrich', status: 'done', result: { sessionKey: 'k', costUsd: 0.0021 } });
    expect(String(run!.artifact_key)).toMatch(/^enrich\/[0-9a-f]+\.json$/);
    expect(remote.documents.has(String(run!.artifact_key))).toBe(true);
    expect(JSON.stringify(remote.rows)).not.toContain('sk-or-synthetic');
  });
});
