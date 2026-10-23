import { useId } from 'react';
import type { RepoFlow, RepoSource } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

/** 코드에서 확인한 연결만 SVG로 그리고 각 노드를 원문과 잇는다. */
export function RepoFlowView({ graph, onOpen }: { graph: RepoFlow; onOpen: (source: Extract<RepoSource, { kind: 'file' }>) => void }) {
  const marker = useId().replaceAll(':', '');
  const counts = new Map<number, number>();
  const positions = new Map(graph.nodes.map((node) => {
    const row = counts.get(node.column) ?? 0;
    counts.set(node.column, row + 1);
    return [node.id, { x: node.column * 250 + 16, y: row * 100 + 28 }];
  }));
  const width = Math.max(300, (Math.max(0, ...counts.keys()) + 1) * 250);
  const height = Math.max(160, Math.max(0, ...counts.values()) * 100 + 44);
  return <figure className="repo-flow">
    <figcaption>{ko.source.flowNote}</figcaption>
    <div className="flow-scroll" role="region" aria-label={ko.source.flowTitle} tabIndex={0}>
      <div className="flow-canvas" style={{ width, height }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          {graph.edges.map((edge, index) => {
            const from = positions.get(edge.from), to = positions.get(edge.to);
            if (!from || !to) return null;
            const start = { x: from.x + 210, y: from.y + 28 };
            const end = { x: to.x, y: to.y + 28 };
            return <path key={index} d={`M${start.x},${start.y} C${start.x + 38},${start.y} ${end.x - 38},${end.y} ${end.x},${end.y}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${marker})`} />;
          })}
        </svg>
        {graph.nodes.map((node) => {
          const pos = positions.get(node.id)!;
          return <button key={node.id} type="button" className="flow-node" style={{ left: pos.x, top: pos.y }} onClick={() => onOpen(node.source)} title={ko.source.open(node.label)}><span className="flow-kind">{node.column === 0 ? ko.source.entry : ko.source.module}</span><code>{node.label}</code></button>;
        })}
      </div>
    </div>
    {graph.limited && <p className="small muted">{ko.source.flowLimited}</p>}
    <details className="evidence"><summary>{ko.source.connections}</summary><ul>{graph.edges.map((edge, index) => <li key={index}><button type="button" className="link" onClick={() => onOpen(edge.source)}>{edge.from} → {edge.to}</button></li>)}</ul></details>
  </figure>;
}
