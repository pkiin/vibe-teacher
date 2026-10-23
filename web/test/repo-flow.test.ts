import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepoFlow } from '@vibe-teacher/shared';
import { RepoFlowView, flowLayout } from '../src/components/RepoFlowView';

describe('repository flow view', () => {
  it('shows each file operation inside its architecture area and keeps source buttons', () => {
    const graph: RepoFlow = {
      groups: [
        { id: 'frontend', label: '프론트엔드', description: '화면 표시' },
        { id: 'backend', label: '백엔드', description: '요청 처리' },
      ],
      nodes: [
        { id: 'web', label: 'web/App.tsx', column: 0, groupId: 'frontend', description: '서버에서 받은 목록을 화면에 표시합니다.', source: { kind: 'file', path: 'web/App.tsx', startLine: 1 } },
        { id: 'server', label: 'server/app.ts', column: 0, groupId: 'backend', description: '요청을 받아 목록 데이터를 응답합니다.', source: { kind: 'file', path: 'server/app.ts', startLine: 1 } },
      ], edges: [], limited: false,
    };
    const html = renderToStaticMarkup(createElement(RepoFlowView, { graph, onOpen: () => {} }));
    for (const node of graph.nodes) {
      expect(html).toContain(node.description);
      expect(html).toContain(`<code>${node.label}</code>`);
    }
    expect(html).toContain('<h4>프론트엔드</h4>');
    expect(html).toContain('<h4>백엔드</h4>');
    expect(html.match(/class="flow-node"/g)).toHaveLength(2);
  });

  it('fills used depths from the left and spreads a single-depth area over several columns', () => {
    const node = (column: number) => ({ column });
    const pipeline = Array.from({ length: 12 }, () => node(3));
    const { width, columns } = flowLayout([[node(0), node(1)], pipeline, [node(1), node(2), node(2)]]);
    expect(width).toBe(3);
    expect(columns[0]!.map((c) => c.length)).toEqual([1, 1]);
    expect(columns[1]!.map((c) => c.length)).toEqual([4, 4, 4]);
    expect(columns[2]!.map((c) => c.length)).toEqual([1, 2]);
    expect(flowLayout([[node(3)]])).toEqual({ width: 1, columns: [[[node(3)]]] });
  });

  it('labels start files and shows only the file name for the rest without pushing them into empty right columns', () => {
    const file = (id: string, column: number, groupId: string) => ({ id, label: id, column, groupId, description: `${id} 설명`, source: { kind: 'file' as const, path: id, startLine: 1 } });
    const graph: RepoFlow = {
      groups: [{ id: 'app', label: '앱', description: '' }, { id: 'data', label: '데이터 처리', description: '' }],
      nodes: [file('app.py', 0, 'app'), file('view.py', 1, 'app'), file('prep.py', 3, 'data'), file('clean.py', 3, 'data')],
      edges: [{ from: 'app.py', to: 'view.py', label: '불러옴', source: { kind: 'file', path: 'app.py', startLine: 1 } }], limited: false,
    };
    const html = renderToStaticMarkup(createElement(RepoFlowView, { graph, onOpen: () => {} }));
    const data = html.slice(html.indexOf('<h4>데이터 처리</h4>'));
    expect(data).toMatch(/^[^]*?<div class="flow-columns"[^>]*><div class="flow-column"><button/);
    const labels = [...html.matchAll(/<span class="flow-kind">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(labels).toEqual(['시작 파일 - app.py', 'view.py', 'prep.py', 'clean.py']);
  });
});
