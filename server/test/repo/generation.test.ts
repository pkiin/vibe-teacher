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

async function setup(invalidRepair = false, db?: 'ok' | 'fail' | 'unlinked' | 'unlinked-none' | 'unlinked-fail', refs?: 'fix' | 'fail', pick: 'ok' | 'fail' | 'base' = db?.startsWith('unlinked') ? 'fail' : 'ok') {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-repo-generation-')); temps.push(tmp);
  const root = path.join(tmp, 'repo');
  await fs.mkdir(path.join(root, 'server', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server/src/main.ts' } }));
  await fs.writeFile(path.join(root, 'server', 'src', 'main.ts'), db ? "export function handleRequest() {\n  return db.from('items').select();\n}\n" : 'export function handleRequest() {\n  return { items: [] };\n}\n');
  if (db) {
    await fs.mkdir(path.join(root, 'db'), { recursive: true });
    await fs.writeFile(path.join(root, 'db', 'schema.sql'), 'create table items (\n  id int primary key,\n  title text not null\n);\n');
  }
  await fs.writeFile(path.join(root, 'web', 'src', 'App.tsx'), 'export function App() {\n  return <main>목록</main>;\n}\n');
  const calls: string[] = [];
  const requests: { schemaName: string; user: string }[] = [];
  const provider: LlmProvider = { id: 'claude-cli', availability: async () => ({ ok: true }), complete: async (req) => {
    calls.push(req.schemaName);
    requests.push({ schemaName: req.schemaName, user: req.user });
    let data: unknown;
    if (req.schemaName === 'repo_inspect_plan') data = { questions: [] };
    else if (req.schemaName === 'repo_wiki_features') {
      expect(req.task).toBeUndefined();
      expect(req.system).toContain('읽는 사람:');
      expect(req.user).toContain('질문: 이 프로젝트의 주요 기능, 즉 이 프로젝트 자체의 주요 기능은 무엇이라고 생각하나요?');
      if (pick === 'fail') throw new Error('기능 질문 실패');
      data = { answer: '목록을 보는 앱입니다.', foundations: pick === 'base' ? [{ name: '항목 저장', summary: '항목을 저장합니다.', files: ['F:server/src/main.ts'] }] : [],
        features: db === 'ok' || db === 'fail' ? [{ id: 'items', name: '목록 보기', summary: '목록을 보여 줍니다.', files: ['F:server/src/main.ts'], sessions: [], sources: ['F:server/src/main.ts'] }]
          : [{ id: 'screen', name: '목록 화면', summary: '목록을 그립니다.', files: ['F:web/src/App.tsx'], sessions: [], sources: ['F:web/src/App.tsx'] }] };
    }
    else if (req.schemaName === 'repo_wiki_text') data = { changes: [], sections: [{ id: 'how', page: 'system', title: '동작', sources: [], paragraphs: [], items: [], sourceBlocks: ['mechanism'] }],
      ...(db === 'ok' || db === 'fail' ? { features: [{ id: 'items', name: '목록 보기', summary: '목록을 보여 줍니다.', files: ['F:server/src/main.ts'], sessions: [], sources: ['F:server/src/main.ts'] }] } : {}),
      // 표를 쓰지 않는 화면만 주요 기능으로 고른 출력: items 표는 쓰는 곳이 있는데 어떤 기능과도 이어지지 않는다
      ...(db?.startsWith('unlinked') ? { features: [{ id: 'screen', name: '목록 화면', summary: '목록을 그립니다.', files: ['F:web/src/App.tsx'], sessions: [], sources: ['F:web/src/App.tsx'] }],
        databaseTables: [{ table: 'items', description: '목록에 보일 항목을 저장합니다.', sources: ['F:db/schema.sql#L1-L4'], columns: [], features: [], ...(pick === 'base' ? { base: '항목 저장 공통 기반에서만 쓰는 표입니다.' } : {}) }] } : {}),
      // 읽지 않은 줄까지 넓힌 인용 (보낸 발췌는 L1-L3)
      ...(refs ? { flowGroups: [{ id: 'app', label: '앱', description: '화면과 서버', sources: ['F:server/src/main.ts#L1-L9'] }],
        flowNodes: ['server/src/main.ts', 'web/src/App.tsx'].map((id) => ({ id, groupId: 'app', description: `${id} 의 동작`, sources: [`F:${id}#L1-L9`] })) } : {}) };
    else if (req.schemaName === 'repo_wiki_refs') {
      expect(req.task).toBe('repo-inspect');
      const sent = JSON.parse(req.user) as { refs: { ref: string; candidates: string[] }[] };
      expect(sent.refs.map((r) => r.ref).sort()).toEqual(['F:server/src/main.ts#L1-L9', 'F:web/src/App.tsx#L1-L9']);
      if (refs === 'fail') throw new Error('근거 다시 묻기 실패');
      data = { fixes: sent.refs.map((r) => ({ ref: r.ref, replacements: [r.candidates[0]] })) };
    }
    else if (req.schemaName === 'repo_wiki_db_links') {
      // 전체 자료를 다시 보내지 않고, 표마다 짧은 질문과 그 표를 쓰는 줄 앞뒤만 보낸다 (Claude CLI 의 가벼운 작업)
      expect(req.task).toBe('repo-inspect');
      expect(req.system).toContain('읽는 사람:');
      expect(req.user).not.toContain('=== 실제 코드');
      expect(req.user).not.toContain('목록</main>');
      const sent = JSON.parse(req.user) as { features: { id: string }[]; newFeatureSlots: number; questions: { table: string; question: string; code: { ref: string; code: string }[] }[] };
      expect(sent.features.map((f) => f.id)).toEqual(['screen']);
      // 주요 기능을 따로 물어 정했으면 표에서 새 기능을 만들지 않는다
      expect(sent.newFeatureSlots).toBe(pick === 'fail' ? 15 : 0);
      expect(sent.questions).toEqual([expect.objectContaining({ table: 'items', question: '이 표(items)는 지금 주요 기능 중 무엇과 관계가 있나요?',
        code: [expect.objectContaining({ ref: 'F:server/src/main.ts#L1-L4', code: expect.stringContaining("db.from('items')") })] })]);
      if (db === 'unlinked-fail') throw new Error('질문 호출 실패');
      data = db === 'unlinked-none'
        ? { answers: [{ table: 'items', answer: '이 코드는 items 표를 조회하지만 지금 주요 기능 중 이 파일을 쓰는 기능은 보이지 않습니다.', sources: ['F:server/src/main.ts#L1-L4'], features: [] }], newFeatures: [] }
        : { answers: [{ table: 'items', answer: '서버의 handleRequest 가 items 표를 조회해 응답하므로 항목 조회 기능과 관계가 있습니다.', sources: ['F:server/src/main.ts#L1-L4'],
          features: [{ id: 'item-store', usage: '항목을 조회해 응답합니다.', sources: ['F:server/src/main.ts#L2-L2'] }] }],
          newFeatures: [{ id: 'item-store', name: '항목 조회', summary: '저장된 항목을 꺼내 응답합니다.', files: ['F:server/src/main.ts'], sessions: [], sources: ['F:server/src/main.ts#L1-L4'] }] };
    }
    else if (req.schemaName === 'repo_wiki_database') {
      expect(req.system).toContain('읽는 사람:');
      expect(req.user).not.toContain('=== 실제 코드');
      expect(req.user).toContain('[items] items · SQL 테이블');
      expect(req.user).toContain('"id":"items"');
      expect(req.user).toContain('=== 설명할 표 id ===\n["items"]');
      if (db === 'fail') throw new Error('보완 호출 실패');
      data = { databaseTables: [{ table: 'items', description: '목록에 보일 항목을 저장합니다.', sources: ['F:db/schema.sql'],
        columns: [{ name: 'title', description: '항목 이름' }, { name: 'invented', description: '없는 컬럼' }],
        features: [{ id: 'items', usage: '목록 화면에 보일 항목을 조회합니다.', sources: ['F:server/src/main.ts#L2-L2'] }] }] };
    }
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
  return { service, project, storage, calls, requests, wait };
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
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_flow']);
    const cached = await service.writeText(project, 'non-dev', { ok: true }, false);
    expect(cached.status).toBe('done');
    expect(calls).toHaveLength(4);

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

  it('writes missing database table descriptions with the decided feature list, and keeps raw tables when that call fails', async () => {
    const { service, project, calls, wait } = await setup(false, 'ok');
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    expect((await wait(started.jobId)).state).toBe('done');
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_flow', 'repo_wiki_database']);
    const { wiki } = await service.get(project, 'non-dev', { ok: true });
    const section = wiki!.system.find((s) => s.id === 'database');
    expect(section?.origin).toBe('source');
    const table = section!.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : [])[0]!;
    expect(table.description).toBe('목록에 보일 항목을 저장합니다.');
    expect(table.columns.map((c) => [c.name, c.description])).toEqual([['id', undefined], ['title', '항목 이름']]);
    expect(table.features).toEqual([{ featureId: 'items', usage: '목록 화면에 보일 항목을 조회합니다.', sources: [expect.objectContaining({ path: 'server/src/main.ts', startLine: 2, endLine: 2 })] }]);
    expect(wiki!.features?.[0]?.tables).toEqual([expect.objectContaining({ id: 'items', name: 'items', usage: '목록 화면에 보일 항목을 조회합니다.', columns: ['id', 'title'] })]);

    const failing = await setup(false, 'fail');
    const again = await failing.service.build(failing.project, 'non-dev', { ok: true });
    if (again.status === 'done') throw new Error('작업 필요');
    expect((await failing.wait(again.jobId)).state).toBe('done');
    const kept = (await failing.service.get(failing.project, 'non-dev', { ok: true })).wiki!;
    const raw = kept.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []))[0]!;
    expect(raw.description).toBeUndefined();
    expect(raw.columns.map((c) => c.name)).toEqual(['id', 'title']);
    // AI 가 고르지 않았어도 기능 파일에서 표를 쓰는 줄이 보이면 코드에서 확인한 연결로 잇는다
    expect(raw.features).toEqual([{ featureId: 'items', sources: [expect.objectContaining({ path: 'server/src/main.ts', startLine: 2 })] }]);
    expect(kept.warnings.some((w) => w.includes('데이터베이스 표 설명을 보완하지 못했습니다'))).toBe(true);
    expect(kept.warnings.some((w) => w.includes('주요 기능과 연결하지 못한'))).toBe(false);
  });

  it('어떤 주요 기능과도 이어지지 않은 표가 있으면 표마다 "주요 기능 중 무엇과 관계가 있나요?"를 짧게 물어 기능 연결과 새 기능을 받는다', async () => {
    const { service, project, calls, wait } = await setup(false, 'unlinked');
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    expect((await wait(started.jobId)).state).toBe('done');
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_flow', 'repo_wiki_db_links']);
    const { wiki } = await service.get(project, 'non-dev', { ok: true });
    // 주요 기능 질문이 실패하면 경고를 남기고 본문 작성에서 고른 기능을 쓴다 (이때만 표에서 새 기능을 받는다)
    expect(wiki!.warnings).toContain('주요 기능을 따로 묻지 못해 본문 작성에서 함께 골랐습니다: 기능 질문 실패');
    expect(wiki!.features?.map((f) => f.id)).toEqual(['screen', 'item-store']);
    const table = wiki!.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []))[0]!;
    // 이미 받은 표 설명은 그대로 두고 기능 연결만 더한다. 연결되었으니 답 문장은 따로 싣지 않는다
    expect(table.description).toBe('목록에 보일 항목을 저장합니다.');
    expect(table.features).toEqual([{ featureId: 'item-store', usage: '항목을 조회해 응답합니다.', sources: [expect.objectContaining({ path: 'server/src/main.ts', startLine: 2 })] }]);
    expect(table.linkAnswer).toBeUndefined();
    expect(wiki!.features?.find((f) => f.id === 'item-store')?.tables?.map((t) => t.id)).toEqual(['items']);
    expect(wiki!.warnings.some((w) => w.includes('주요 기능과 연결하지 못한'))).toBe(false);

    // 관계있는 기능이 없다는 답이면 억지로 잇지 않고, 그 답을 표 상세에 보여 준다
    const none = await setup(false, 'unlinked-none');
    const asked = await none.service.build(none.project, 'non-dev', { ok: true });
    if (asked.status === 'done') throw new Error('작업 필요');
    expect((await none.wait(asked.jobId)).state).toBe('done');
    const noted = (await none.service.get(none.project, 'non-dev', { ok: true })).wiki!;
    const raw = noted.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []))[0]!;
    expect(raw.features).toBeUndefined();
    expect(raw.linkAnswer).toEqual({ text: '이 코드는 items 표를 조회하지만 지금 주요 기능 중 이 파일을 쓰는 기능은 보이지 않습니다.',
      sources: [expect.objectContaining({ path: 'server/src/main.ts', startLine: 1, endLine: 4 })] });
    expect(noted.warnings.some((w) => w.includes('코드에서 쓰는 곳은 있지만 주요 기능과 연결하지 못한 데이터베이스 표 1개: items'))).toBe(true);

    const failing = await setup(false, 'unlinked-fail');
    const again = await failing.service.build(failing.project, 'non-dev', { ok: true });
    if (again.status === 'done') throw new Error('작업 필요');
    expect((await failing.wait(again.jobId)).state).toBe('done');
    const kept = (await failing.service.get(failing.project, 'non-dev', { ok: true })).wiki!;
    expect(kept.warnings.some((w) => w.includes('주요 기능과 이어지지 않은 데이터베이스 표를 AI에 물어보지 못했습니다: 질문 호출 실패'))).toBe(true);
    expect(kept.warnings.some((w) => w.includes('코드에서 쓰는 곳은 있지만 주요 기능과 연결하지 못한 데이터베이스 표 1개: items'))).toBe(true);
  });

  it('읽지 않은 줄까지 넓힌 인용은 보낸 표시 중에서 다시 고르게 해 전체 연결 그림 보완 없이 완성한다', async () => {
    const { service, project, calls, wait } = await setup(false, undefined, 'fix');
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    expect((await wait(started.jobId)).state).toBe('done');
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_refs']);
    const wiki = (await service.get(project, 'non-dev', { ok: true })).wiki!;
    const nodes = wiki.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'flow' ? b.graph.nodes : []));
    expect(nodes.map((n) => [n.id, n.groupId, n.description])).toEqual(expect.arrayContaining([['server/src/main.ts', 'app', 'server/src/main.ts 의 동작'], ['web/src/App.tsx', 'app', 'web/src/App.tsx 의 동작']]));
    expect(JSON.stringify(wiki)).not.toContain('#L1-L9');

    // 다시 묻기가 실패하면 경고를 남기고, 빠진 노드는 연결 그림 보완으로 채운다
    const failing = await setup(false, undefined, 'fail');
    const again = await failing.service.build(failing.project, 'non-dev', { ok: true });
    if (again.status === 'done') throw new Error('작업 필요');
    expect((await failing.wait(again.jobId)).state).toBe('done');
    expect(failing.calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_refs', 'repo_wiki_flow']);
    const kept = (await failing.service.get(failing.project, 'non-dev', { ok: true })).wiki!;
    expect(kept.warnings.some((w) => w.includes('확인하지 못한 근거 표시를 AI에 다시 묻지 못했습니다: 근거 다시 묻기 실패'))).toBe(true);
  });

  it('주요 기능은 본문보다 먼저 따로 묻고, 정해진 목록을 본문 응답 대신 쓰며, 표에서 새 기능을 만들지 않는다', async () => {
    const { service, project, calls, requests, wait } = await setup(false, 'unlinked-none', undefined, 'ok');
    const started = await service.build(project, 'non-dev', { ok: true });
    if (started.status === 'done') throw new Error('작업 필요');
    expect((await wait(started.jobId)).state).toBe('done');
    expect(calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_flow', 'repo_wiki_db_links']);
    const text = requests.find((r) => r.schemaName === 'repo_wiki_text')!;
    expect(text.user).toContain('=== 정해진 주요 기능');
    expect(text.user).toContain('"id":"screen"');
    expect(text.user).not.toContain('=== 기존 주요 기능 id');
    const { wiki } = await service.get(project, 'non-dev', { ok: true });
    expect(wiki!.features?.map((f) => f.id)).toEqual(['screen']);
    expect(wiki!.warnings.some((w) => w.includes('주요 기능을 따로 묻지 못해'))).toBe(false);

    // 공통 기반에서만 쓰는 표라고 확인되면 기능과 잇지 않아도 되므로 표 질문을 보내지 않는다
    const base = await setup(false, 'unlinked', undefined, 'base');
    const again = await base.service.build(base.project, 'non-dev', { ok: true });
    if (again.status === 'done') throw new Error('작업 필요');
    expect((await base.wait(again.jobId)).state).toBe('done');
    expect(base.calls).toEqual(['repo_inspect_plan', 'repo_wiki_features', 'repo_wiki_text', 'repo_wiki_flow']);
    const kept = (await base.service.get(base.project, 'non-dev', { ok: true })).wiki!;
    const table = kept.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []))[0]!;
    expect(table.features).toBeUndefined();
    expect(table.base).toEqual({ text: '항목 저장 공통 기반에서만 쓰는 표입니다.', sources: [expect.objectContaining({ path: 'db/schema.sql' })] });
    expect(kept.warnings.some((w) => w.includes('주요 기능과 연결하지 못한'))).toBe(false);
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
