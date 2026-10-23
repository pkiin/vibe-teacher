import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@vibe-teacher/shared';
import { AnalysisService } from '../../src/analyzers/index';
import { ConfigStore, resolvePaths } from '../../src/config/store';
import type { SessionIndex } from '../../src/index/session-index';
import { EnrichService } from '../../src/llm/service';
import type { LlmProvider } from '../../src/llm/types';
import { RepoWikiService } from '../../src/repo/service';
import { WikiStorage } from '../../src/storage/store';
import type { WikiService } from '../../src/wiki/service';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function setup(invalidRepair = false) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-repo-generation-')); temps.push(tmp);
  const root = path.join(tmp, 'repo');
  await fs.mkdir(path.join(root, 'server', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server/src/main.ts' } }));
  await fs.writeFile(path.join(root, 'server', 'src', 'main.ts'), 'export function handleRequest() {\n  return { items: [] };\n}\n');
  await fs.writeFile(path.join(root, 'web', 'src', 'App.tsx'), 'export function App() {\n  return <main>목록</main>;\n}\n');
  const calls: string[] = [];
  const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
    calls.push(req.schemaName);
    let data: unknown;
    if (req.schemaName === 'repo_inspect_plan') data = { questions: [] };
    else if (req.schemaName === 'repo_wiki_text') data = { changes: [], sections: [{ id: 'how', page: 'system', title: '동작', sources: [], paragraphs: [], items: [], sourceBlocks: ['mechanism'] }] };
    else if (req.schemaName === 'repo_wiki_flow') {
      expect(req.task).toBe('repo-inspect');
      expect(req.system).toContain('읽는 사람:');
      expect(req.user).toContain('handleRequest');
      const roles = [
        { id: 'server/src/main.ts', groupId: 'backend', label: '백엔드', description: '요청에 목록 데이터를 응답합니다.' },
        { id: 'web/src/App.tsx', groupId: 'frontend', label: '프론트엔드', description: '목록을 화면에 표시합니다.' },
      ];
      data = { flowGroups: roles.map((r) => ({ id: r.groupId, label: r.label, description: r.description, sources: [`F:${r.id}#L2-L2`] })),
        flowNodes: roles.map((r) => ({ id: r.id, groupId: r.groupId, description: r.description, sources: [`F:${r.id}#L${invalidRepair ? '99-L100' : '2-L2'}`] })) };
    } else throw new Error(`예상하지 못한 호출: ${req.schemaName}`);
    return { data: req.schema.parse(data), provider: 'claude-cli', model: 'fixture', durationMs: 1 };
  } };
  const paths = resolvePaths(path.join(tmp, 'state'));
  const store = new ConfigStore(paths); await store.load();
  const storage = new WikiStorage(paths.home);
  const index = { getProjectIds: (id: string) => [id], getSessions: () => [] } as unknown as SessionIndex;
  const service = new RepoWikiService({ storage, store, index, analysis: new AnalysisService(), wiki: {} as WikiService, enrich: new EnrichService({ store, paths, providerOverride: provider }) });
  const project: Project = { id: 'project', accountId: 'account', rootPath: root, name: '앱', exists: true, providers: [], sessionCount: 0 };
  const wait = async (id: string) => {
    for (let n = 0; n < 100; n++) {
      const job = service.jobs.get(id)!;
      if (!['queued', 'running'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('작업이 끝나지 않았습니다');
  };
  return { service, project, storage, calls, wait };
}

describe('complete repository graph generation', () => {
  it('fills omitted descriptions with a focused AI request before saving and invalidates the old empty success cache', async () => {
    const { service, project, storage, calls, wait } = await setup();
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    expect((await wait(started.jobId)).state).toBe('done');
    const response = await service.get(project, 'non-dev', { ok: true });
    const graphs = response.wiki!.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'flow' ? [b.graph] : []));
    expect(graphs.flatMap((g) => g.nodes)).toHaveLength(2);
    expect(graphs.every((g) => g.nodes.every((n) => n.description && n.groupId))).toBe(true);
    expect(response.wiki!.generator.kind).toBe('llm');
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_text', 'repo_wiki_flow']);
    const cached = await service.writeText(project, 'non-dev', { ok: true }, false);
    expect(cached.status).toBe('done');
    expect(calls).toHaveLength(3);

    const textFile = path.join(storage.projectDir(project.id), 'repo', 'text', 'non-dev.json');
    const layer = await storage.readJson<Record<string, unknown>>(textFile);
    await storage.writeJson(textFile, { ...layer, promptVersion: 6 });
    const old = await service.get(project, 'non-dev', { ok: true });
    expect(old.wiki!.generator.kind).toBe('pending');
    expect(old.wiki!.system).toEqual([]);
    const rewritten = await service.writeText(project, 'non-dev', { ok: true }, false);
    if (rewritten.status === 'done') throw new Error('다시 생성해야 합니다');
    expect((await wait(rewritten.jobId)).state).toBe('done');
    expect(calls.filter((c) => c === 'repo_wiki_flow')).toHaveLength(2);
  });

  it('reports failure instead of caching a successful graph when repaired descriptions still have unread sources', async () => {
    const { service, project, wait } = await setup(true);
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    const job = await wait(started.jobId);
    expect(job.state).toBe('error');
    expect(job.error?.message).toContain('그래프 파일 2개');
    const response = await service.get(project, 'non-dev', { ok: true });
    expect(response.wiki!.generator.kind).toBe('unavailable');
    expect(response.wiki!.system).toEqual([]);
    expect(response.wiki!.generator.reason).toContain('저장하지 않았습니다');
    expect(response.text?.canGenerate).toBe(false);
  });
});
