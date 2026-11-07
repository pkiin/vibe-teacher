import { describe, expect, it } from 'vitest';
import { applyRepoAi, assertRepoFlowComplete, buildRepoAiPrompt, coveredRange, dropRepeatedBlocks, mergeRepoFlowRepair, missingRepoFlowNodes, replaceRepoRefs, RepoAiOutputSchema, repoFlowOutputSchema, repoFlowRepairUser, unverifiedRepoRefs } from '../../src/repo/ai';
import { inspectCode } from '../../src/repo/code';
import { buildRepoWiki } from '../../src/repo/wiki';

const files = new Set(['web/src/App.tsx', 'server/src/index.ts', 'shared/src/protocol.ts']);
function draftWiki() {
  const code = [
    inspectCode('web/src/App.tsx', "import { schema } from '../../shared/src/protocol'; export const App = () => <main>목록</main>;", 'web', files),
    inspectCode('server/src/index.ts', "import { schema } from '../../shared/src/protocol'; export const handler = () => ({ items: [] });", 'server', files),
    inspectCode('shared/src/protocol.ts', 'export const schema = {};', 'shared', files),
  ];
  return buildRepoWiki({ project: { id: 'p', name: '앱', rootPath: '/synthetic' }, sessions: [], scan: { root: '/synthetic', readable: 'ok', scannedAt: '', signature: 'test', files: [...files].map((path) => ({ path, size: 1 })), truncated: false, packages: [], docker: false, routes: [], code, entries: ['web/src/App.tsx', 'server/src/index.ts'] } });
}
const section = { id: 'how', page: 'system', title: '동작', paragraphs: [], items: [], sources: [], sourceBlocks: ['mechanism'] };

describe('AI descriptions and architecture areas in repository graphs', () => {
  it('adds descriptions and frontend, backend and shared areas while preserving verified links and sources', () => {
    const draft = draftWiki();
    const raw = draft.system.find((s) => s.id === 'mechanism')!.blocks[0]!;
    if (raw.kind !== 'flow') throw new Error('그래프 필요');
    const roles = [
      ['web/src/App.tsx', 'frontend', '서버에서 받은 목록을 화면에 표시합니다.'],
      ['server/src/index.ts', 'backend', '요청을 받아 목록 데이터를 응답합니다.'],
      ['shared/src/protocol.ts', 'shared', '화면과 서버가 사용할 데이터 형식을 정의합니다.'],
    ];
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      flowGroups: roles.map(([file, id], i) => ({ id, label: ['프론트엔드', '백엔드', '공통'][i], description: ['화면 표시', '요청 처리', '데이터 형식'][i], sources: [`F:${file}`] })),
      flowNodes: roles.map(([id, groupId, description]) => ({ id, groupId, description, sources: [`F:${id}`] })),
    });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'claude-cli', durationMs: 1 } });
    const block = result.system[0]!.blocks[0]!;
    if (block.kind !== 'flow') throw new Error('그래프 필요');
    expect(block.graph.edges).toEqual(raw.graph.edges);
    expect(block.graph.nodes.map(({ description, groupId, ...node }) => node)).toEqual(raw.graph.nodes);
    expect(raw.graph.nodes.every((n) => !n.description)).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(block.graph.groups?.map((g) => g.label)).toEqual(['프론트엔드', '백엔드', '공통']);
    expect(block.graph.nodes.map((n) => [n.id, n.groupId, n.description])).toEqual(roles);
  });

  it('shows the same graph only in the first section that picks it on a page', () => {
    const draft = draftWiki();
    const output = RepoAiOutputSchema.parse({ changes: [], sections: [
      { ...section, sourceBlocks: ['mechanism', 'mechanism'] },
      { ...section, id: 'areas', title: '영역별로 보기', paragraphs: ['화면과 서버로 나뉩니다.'], sources: ['F:server/src/index.ts'] },
      { ...section, id: 'graph-only', title: '그림만' },
      { ...section, id: 'user-flow', page: 'user', title: '사용 흐름' },
    ] });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    const flows = (sections: typeof result.system) => sections.flatMap((s) => s.blocks.filter((b) => b.kind === 'flow').map(() => s.id));
    expect(flows(result.system)).toEqual(['how']);
    expect(result.system.map((s) => s.id)).toEqual(['how', 'areas']);
    expect(result.system[1]!.blocks.map((b) => b.kind)).toEqual(['text']);
    expect(result.system[1]!.sources).toEqual([{ kind: 'file', path: 'server/src/index.ts' }]);
    expect(flows(result.user)).toEqual(['user-flow']);
  });

  it('drops a repeated graph from saved layers but keeps each section text', () => {
    const raw = draftWiki().system.find((s) => s.id === 'mechanism')!.blocks[0]!;
    const text = { kind: 'text' as const, text: '설명' };
    const sections = [
      { id: 'a', title: 'A', blocks: [text, raw], sources: [], origin: 'llm' as const },
      { id: 'b', title: 'B', blocks: [text, raw], sources: [], origin: 'llm' as const },
      { id: 'c', title: 'C', blocks: [raw], sources: [], origin: 'llm' as const },
    ];
    expect(dropRepeatedBlocks(sections).map((s) => [s.id, s.blocks.map((b) => b.kind)])).toEqual([['a', ['text', 'flow']], ['b', ['text']]]);
  });

  it('rejects unknown files, invented line citations and descriptions without the node file as evidence', () => {
    const draft = draftWiki();
    const raw = draft.system.find((s) => s.id === 'mechanism')!.blocks[0]!;
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      flowGroups: [{ id: 'made-up', label: '없는 영역', description: '', sources: ['F:missing.ts'] }],
      flowNodes: [
        { id: 'missing.ts', groupId: 'made-up', description: '없는 파일', sources: ['F:server/src/index.ts'] },
        { id: 'web/src/App.tsx', groupId: 'made-up', description: '엉뚱한 파일 근거', sources: ['F:server/src/index.ts'] },
        { id: 'server/src/index.ts', groupId: 'made-up', description: '없는 줄 근거', sources: ['F:server/src/index.ts#L999-L1000'] },
      ],
    });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    expect(result.system[0]!.blocks[0]).toEqual(raw);
    expect(JSON.stringify(result)).not.toContain('없는 영역');
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts cited subranges inside supplied excerpts, preserves hashes, and rejects unread lines', () => {
    const draft = draftWiki();
    const source = { kind: 'file' as const, path: 'server/src/index.ts', startLine: 10, endLine: 30, hash: 'provided-hash' };
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      flowGroups: [{ id: 'server', label: '서버', description: '요청 처리', sources: ['F:server/src/index.ts#L12-L20'] }],
      flowNodes: [{ id: 'server/src/index.ts', description: '목록을 응답합니다.', groupId: 'server', sources: ['F:server/src/index.ts#L12-L20'] }],
    });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 }, additionalSources: [source] });
    const graph = result.system[0]!.blocks[0]!;
    if (graph.kind !== 'flow') throw new Error('그래프 필요');
    expect(graph.graph.nodes.find((n) => n.id === source.path)).toMatchObject({ description: '목록을 응답합니다.', groupId: 'server' });
    expect(result.system[0]!.sources).toContainEqual({ ...source, startLine: 12, endLine: 20 });
    expect(result.warnings).toEqual([]);
    for (const ref of ['F:server/src/index.ts#L9-L12', 'F:server/src/index.ts#L25-L31', 'F:server/src/index.ts#L20-L12', 'F:server/src/index.ts#L0-L12']) {
      const invalid = applyRepoAi({ draft, output: { ...output, flowNodes: [{ ...output.flowNodes[0]!, sources: [ref] }] }, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 }, additionalSources: [source] });
      expect(missingRepoFlowNodes(draft, invalid)).toContain(source.path);
    }
  });

  it('겹치거나 맞닿은 발췌를 합친 인용은 받고, 떨어진 발췌 사이의 읽지 않은 줄이 들어가면 거른다', () => {
    const at = (startLine: number, endLine: number, hash = 'h1') => ({ kind: 'file' as const, path: 'server/src/index.ts', startLine, endLine, hash });
    const sources = [at(1, 32), at(30, 61), at(62, 70), at(90, 99), at(100, 120, 'other')];
    expect(coveredRange(sources, 'server/src/index.ts', 1, 61)).toEqual(at(1, 61));
    expect(coveredRange(sources, 'server/src/index.ts', 5, 70)).toEqual(at(5, 70));
    expect(coveredRange(sources, 'server/src/index.ts', 1, 95)).toBeNull();
    // 지문이 다른 발췌(다른 시점에 읽은 파일)와는 잇지 않는다
    expect(coveredRange(sources, 'server/src/index.ts', 95, 110)).toBeNull();
    expect(coveredRange(sources, 'web/src/App.tsx', 1, 2)).toBeNull();
    expect(coveredRange(sources, 'server/src/index.ts', 0, 2)).toBeNull();
    expect(coveredRange(sources, 'server/src/index.ts', 40, 39)).toBeNull();

    const draft = draftWiki();
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      flowGroups: [{ id: 'server', label: '서버', description: '요청 처리', sources: ['F:server/src/index.ts#L1-L61'] }],
      flowNodes: [{ id: 'server/src/index.ts', description: '목록을 응답합니다.', groupId: 'server', sources: ['F:server/src/index.ts#L1-L61'] }],
    });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 }, additionalSources: sources });
    expect(missingRepoFlowNodes(draft, result)).not.toContain('server/src/index.ts');
    expect(result.system[0]!.sources).toContainEqual(at(1, 61));
  });

  it('확인하지 못한 인용만 모아 보낸 표시를 후보로 주고, 고른 후보로 바꾸면 같은 검사를 통과한다', () => {
    const draft = draftWiki();
    const at = (startLine: number, endLine: number) => ({ kind: 'file' as const, path: 'server/src/index.ts', startLine, endLine, hash: 'h1' });
    const additionalSources = [at(12, 12), at(40, 40), at(80, 90)];
    const output = RepoAiOutputSchema.parse({ sections: [{ ...section, sources: ['S:추가 파일 확인 질문과 답변'] }], changes: [],
      flowGroups: [{ id: 'server', label: '서버', description: '요청 처리', sources: ['F:server/src/index.ts#L12-L12'] }],
      flowNodes: [{ id: 'server/src/index.ts', description: '목록을 응답합니다.', groupId: 'server', sources: ['F:server/src/index.ts#L12-L40'] }],
      features: [{ id: 'list', name: '목록', summary: '목록을 봅니다.', files: ['F:server/src/index.ts', 'F:server/src/ghost.ts'], sessions: [], sources: ['F:server/src/index.ts#L12-L40'] }],
    });
    const base = { draft, handles: new Map<string, string>(), fileSet: files, additionalSources };
    const problems = unverifiedRepoRefs({ ...base, output });
    expect(problems.map((p) => p.ref)).toEqual(['S:추가 파일 확인 질문과 답변', 'F:server/src/index.ts#L12-L40', 'F:server/src/ghost.ts']);
    const gap = problems.find((p) => p.ref === 'F:server/src/index.ts#L12-L40')!;
    // 범위가 겹치는 발췌부터, 마지막은 파일 전체
    expect(gap.candidates).toEqual(['F:server/src/index.ts#L12-L12', 'F:server/src/index.ts#L40-L40', 'F:server/src/index.ts#L1-L1', 'F:server/src/index.ts#L80-L90', 'F:server/src/index.ts']);
    expect(gap.usedIn).toEqual(['연결 그림 파일 server/src/index.ts 설명: 목록을 응답합니다.', '주요 기능 목록: 목록을 봅니다.']);
    expect(problems.find((p) => p.ref === 'F:server/src/ghost.ts')).toMatchObject({ problem: '제공된 파일 목록에 없는 파일입니다', candidates: [] });
    expect(problems[0]!.candidates).toEqual(['F:server/src/index.ts#L12-L12', 'F:server/src/index.ts#L40-L40', 'F:server/src/index.ts#L80-L90']);
    expect(unverifiedRepoRefs({ ...base, output, skip: new Set(problems.map((p) => p.ref)) })).toEqual([]);

    const before = applyRepoAi({ ...base, output, result: { provider: 'openrouter', durationMs: 1 } });
    expect(missingRepoFlowNodes(draft, before)).toContain('server/src/index.ts');
    const fixed = replaceRepoRefs(output, new Map([['F:server/src/index.ts#L12-L40', ['F:server/src/index.ts#L12-L12', 'F:server/src/index.ts#L40-L40']]]));
    expect(fixed.flowNodes[0]!.sources).toEqual(['F:server/src/index.ts#L12-L12', 'F:server/src/index.ts#L40-L40']);
    const after = applyRepoAi({ ...base, output: fixed, result: { provider: 'openrouter', durationMs: 1 } });
    expect(missingRepoFlowNodes(draft, after)).not.toContain('server/src/index.ts');
    // 고치지 못한 표시(없는 파일)가 남은 기능은 그대로 거른다
    expect(after.features ?? []).toEqual([]);
  });

  it("'F:' 없이 제공된 파일 경로만 쓴 표시는 같은 파일 표시로 읽고, 경로 모양 표시에는 다른 파일을 후보로 주지 않는다", () => {
    const draft = draftWiki();
    const additionalSources = [{ kind: 'file' as const, path: 'web/src/App.tsx', startLine: 1, endLine: 1, hash: 'h' }];
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      features: [{ id: 'list', name: '목록', summary: '목록을 봅니다.', files: ['server/src/index.ts', 'web/src/App.tsx#L1-L1'], sessions: [], sources: ['server/src/index.ts'] },
        { id: 'ghost', name: '유령', summary: '없는 파일', files: ['server/src/ghost.ts'], sessions: [], sources: [] }],
    });
    const base = { draft, handles: new Map<string, string>(), fileSet: files, additionalSources };
    const result = applyRepoAi({ ...base, output, result: { provider: 'openrouter', durationMs: 1 } });
    expect(result.features?.map((f) => [f.id, f.files.map((x) => x.path)])).toEqual([['list', ['server/src/index.ts', 'web/src/App.tsx']]]);
    expect(unverifiedRepoRefs({ ...base, output })).toEqual([{ ref: 'server/src/ghost.ts', usedIn: ['주요 기능 유령: 없는 파일'], problem: '제공된 파일 목록에 없는 파일입니다', candidates: [] }]);
  });

  it('연결 그림 보완은 빠진 노드와 그 파일 발췌만 묻고, 통과한 노드·영역은 그대로 둔다', () => {
    const draft = draftWiki();
    const flowUser = buildRepoAiPrompt({ draft, scan: { root: '/synthetic', readable: 'ok', scannedAt: '', signature: 'test', files: [...files].map((path) => ({ path, size: 1 })), truncated: false, packages: [], docker: false, routes: [],
      code: [...files].map((f) => inspectCode(f, f === 'web/src/App.tsx' ? 'export const App = () => <main>목록</main>;' : 'export const x = 1;', 'x', files)), entries: [] }, sessions: [] }).flowUser;
    const ok = (id: string, groupId: string) => ({ id, description: `${id} 설명`, groupId, sources: [`F:${id}`] });
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [],
      flowGroups: [{ id: 'web', label: '화면', description: '화면', sources: ['F:web/src/App.tsx'] }, { id: 'broken', label: '깨짐', description: '', sources: ['F:none.ts'] }],
      flowNodes: [ok('web/src/App.tsx', 'web'), ok('server/src/index.ts', 'broken')],
    });
    const wiki = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    const missing = missingRepoFlowNodes(draft, wiki);
    expect(missing).toEqual(['server/src/index.ts', 'shared/src/protocol.ts']);
    const sent = JSON.parse(repoFlowRepairUser(flowUser, wiki, missing)) as { groups: { id: string }[]; nodes: { id: string }[]; code: { path: string }[] };
    expect(sent.groups.map((g) => g.id)).toEqual(['web']);
    expect(sent.nodes.map((n) => n.id)).toEqual(missing);
    expect(sent.code.map((c) => c.path).sort()).toEqual(missing);
    expect(repoFlowRepairUser('{깨진 자료', wiki, missing)).toBe('{깨진 자료');

    const schema = repoFlowOutputSchema(draft, { ids: missing, groups: true });
    const repair = schema.parse({ flowGroups: [{ id: 'server', label: '서버', description: '요청', sources: ['F:server/src/index.ts'] }],
      flowNodes: [ok('server/src/index.ts', 'server'), ok('shared/src/protocol.ts', 'web')] });
    expect(schema.safeParse({ flowGroups: [], flowNodes: repair.flowNodes }).success).toBe(true);
    expect(schema.safeParse({ flowGroups: [], flowNodes: [ok('web/src/App.tsx', 'web'), ok('server/src/index.ts', 'web')] }).success).toBe(false);
    const merged = mergeRepoFlowRepair(output, { ...repair, flowNodes: [...repair.flowNodes, { ...ok('web/src/App.tsx', 'server'), description: '바뀐 설명' }] }, wiki);
    expect(merged.flowGroups.map((g) => g.id)).toEqual(['web', 'server']);
    const done = applyRepoAi({ draft, output: merged, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    expect(missingRepoFlowNodes(draft, done)).toEqual([]);
    const nodes = done.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'flow' ? b.graph.nodes : []));
    expect(nodes.find((n) => n.id === 'web/src/App.tsx')).toMatchObject({ description: 'web/src/App.tsx 설명', groupId: 'web' });
  });

  it('does not accept an empty or omitted description array as a complete generated graph', () => {
    const draft = draftWiki();
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [] });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    expect(missingRepoFlowNodes(draft, result)).toEqual([...files]);
    expect(() => assertRepoFlowComplete(draft, result)).toThrow('그래프 파일 3개');
    expect(repoFlowOutputSchema(draft).safeParse({ flowGroups: [], flowNodes: [] }).success).toBe(false);
  });
});
