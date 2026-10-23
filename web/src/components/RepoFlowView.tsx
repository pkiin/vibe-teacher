import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { RepoFlow, RepoSource } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';

const fileName = (label: string) => label.slice(label.lastIndexOf('/') + 1);

/** 깊이가 하나뿐인 영역을 나눠 담을 최대 열 수 */
const SPREAD = 3;

/**
 * 영역마다 실제로 쓰는 깊이만 왼쪽부터 채운다. 빈 열 때문에 상자가 오른쪽에 몰리지 않게 하고,
 * 깊이가 하나뿐인 영역은 세로 한 줄로 길어지지 않게 여러 열로 나눈다 (같은 깊이라 화살표 뜻은 그대로다).
 */
export function flowLayout<T extends { column: number }>(bands: T[][]): { width: number; columns: T[][][] } {
  const lanes = bands.map((nodes) => [...new Set(nodes.map((node) => node.column))].sort((a, b) => a - b).map((depth) => nodes.filter((node) => node.column === depth)));
  const width = Math.max(1, ...lanes.map((band) => (band.length === 1 ? Math.min(SPREAD, band[0]!.length) : band.length)));
  const columns = lanes.map((band) => {
    const only = band.length === 1 ? band[0]! : null;
    if (!only) return band;
    const rows = Math.ceil(only.length / width);
    return Array.from({ length: Math.ceil(only.length / rows) }, (_, index) => only.slice(index * rows, (index + 1) * rows));
  });
  return { width, columns };
}

/** 코드에서 확인한 연결만 SVG로 그리고 각 노드를 원문과 잇는다. */
export function RepoFlowView({ graph, onOpen }: { graph: RepoFlow; onOpen: (source: Extract<RepoSource, { kind: 'file' }>) => void }) {
  const marker = useId().replaceAll(':', '');
  const canvas = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [layout, setLayout] = useState({ width: 1, height: 1, positions: new Map<string, { x: number; y: number; width: number; height: number }>() });
  const groups = (graph.groups ?? []).map((group) => ({ ...group, nodes: graph.nodes.filter((node) => node.groupId === group.id) })).filter((group) => group.nodes.length);
  const rest = graph.nodes.filter((node) => !groups.some((group) => group.id === node.groupId));
  const bands = [...groups, ...(rest.length ? [{ id: '', label: groups.length ? ko.source.ungrouped : '', description: '', nodes: rest }] : [])];
  const { width: columnCount, columns } = flowLayout(bands.map((band) => band.nodes));

  // 설명 줄바꿈이나 글자 크기가 바뀌어도 실제 상자 위치에 화살표를 맞춘다.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const update = () => {
      const base = element.getBoundingClientRect();
      const positions = new Map([...buttons.current].map(([id, button]) => {
        const rect = button.getBoundingClientRect();
        return [id, { x: rect.left - base.left, y: rect.top - base.top, width: rect.width, height: rect.height }] as const;
      }));
      setLayout({ width: Math.max(1, base.width), height: Math.max(1, base.height), positions });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const button of buttons.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [graph]);

  return <figure className="repo-flow">
    <figcaption>{ko.source.flowNote}</figcaption>
    <div className="flow-scroll" role="region" aria-label={ko.source.flowTitle} tabIndex={0}>
      <div className="flow-canvas" ref={canvas} style={{ minWidth: columnCount * 310 + 32 }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          {graph.edges.map((edge, index) => {
            const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to);
            if (!from || !to) return null;
            const crossGroup = graph.nodes.find((n) => n.id === edge.from)?.groupId !== graph.nodes.find((n) => n.id === edge.to)?.groupId;
            const start = crossGroup ? { x: from.x + from.width / 2, y: from.y + from.height } : { x: from.x + from.width, y: from.y + from.height / 2 };
            const end = crossGroup ? { x: to.x + to.width / 2, y: to.y } : { x: to.x, y: to.y + to.height / 2 };
            const curve = crossGroup ? `C${start.x},${start.y + 38} ${end.x},${end.y - 38}` : `C${start.x + 38},${start.y} ${end.x - 38},${end.y}`;
            return <path key={index} d={`M${start.x},${start.y} ${curve} ${end.x},${end.y}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${marker})`} />;
          })}
        </svg>
        {bands.map((band, bandIndex) => <section key={band.id} className="flow-group" aria-label={band.label || ko.source.flowTitle}>
          {band.label && <header className="flow-group-heading"><h4>{band.label}</h4>{band.description && <p>{band.description}</p>}</header>}
          <div className="flow-columns" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(270px, 1fr))` }}>
            {Array.from({ length: columnCount }, (_, column) => <div key={column} className="flow-column">
              {(columns[bandIndex]?.[column] ?? []).map((node) => <button key={node.id} ref={(element) => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }} type="button" className="flow-node" onClick={() => onOpen(node.source)} title={ko.source.open(node.label)}>
                <span className="flow-kind">{node.column === 0 ? ko.source.entry(fileName(node.label)) : fileName(node.label)}</span>
                <span className="flow-description">{node.description || ko.source.flowDescriptionMissing}</span>
                <code>{node.label}</code>
              </button>)}
            </div>)}
          </div>
        </section>)}
      </div>
    </div>
    {graph.limited && <p className="small muted">{ko.source.flowLimited}</p>}
    <details className="evidence"><summary>{ko.source.connections}</summary><ul>{graph.edges.map((edge, index) => <li key={index}><button type="button" className="link" onClick={() => onOpen(edge.source)}>{edge.from} → {edge.to} · {edge.label}</button></li>)}</ul></details>
  </figure>;
}
