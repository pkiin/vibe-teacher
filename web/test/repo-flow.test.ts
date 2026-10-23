import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepoFlow } from '@vibe-teacher/shared';
import { RepoFlowView } from '../src/components/RepoFlowView';

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
});
