import { describe, expect, it } from 'vitest';
import { applyRepoAi, assertRepoFlowComplete, missingRepoFlowNodes, RepoAiOutputSchema, repoFlowOutputSchema } from '../../src/repo/ai';
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

  it('does not accept an empty or omitted description array as a complete generated graph', () => {
    const draft = draftWiki();
    const output = RepoAiOutputSchema.parse({ sections: [section], changes: [] });
    const result = applyRepoAi({ draft, output, handles: new Map(), fileSet: files, result: { provider: 'openrouter', durationMs: 1 } });
    expect(missingRepoFlowNodes(draft, result)).toEqual([...files]);
    expect(() => assertRepoFlowComplete(draft, result)).toThrow('그래프 파일 3개');
    expect(repoFlowOutputSchema(draft).safeParse({ flowGroups: [], flowNodes: [] }).success).toBe(false);
  });
});
