import type { ExplanationDepth } from '@vibe-teacher/shared';

/**
 * 선행관계(requires) 그래프. 그래프 DB 없이 edge 목록과 인접 리스트로 검사·정렬·도달성을 계산한다.
 * - 순환이나 없는 endpoint 는 임의로 지우지 않고 격리(quarantined)해 검토 대상으로 남긴다.
 * - proposed 관계는 하드 제약(설명 bundle)에 쓰지 않는다.
 */

export type EdgeStatus = 'reviewed' | 'proposed';

export interface RequiresEdge {
  /** 목표 개념 */
  from: string;
  /** 먼저 필요한 개념 */
  to: string;
  /** from 을 이 깊이 이상으로 설명할 때만 필요 */
  minDepth: ExplanationDepth;
  status: EdgeStatus;
}

export type QuarantineReason = 'missing_endpoint' | 'self_loop' | 'duplicate' | 'cycle';

export interface PrerequisiteGraph {
  version: string;
  active: RequiresEdge[];
  proposed: RequiresEdge[];
  quarantined: { edge: RequiresEdge; reason: QuarantineReason }[];
  adjacency: Map<string, RequiresEdge[]>;
}

const DEPTH_ORDER: Record<ExplanationDepth, number> = { D0: 0, D1: 1, D2: 2, D3: 3 };

export function depthAtLeast(depth: ExplanationDepth, min: ExplanationDepth): boolean {
  return DEPTH_ORDER[depth] >= DEPTH_ORDER[min];
}

export function minDepth(a: ExplanationDepth, b: ExplanationDepth): ExplanationDepth {
  return DEPTH_ORDER[a] <= DEPTH_ORDER[b] ? a : b;
}

export function buildPrerequisiteGraph(version: string, edges: RequiresEdge[], conceptIds: ReadonlySet<string>): PrerequisiteGraph {
  const quarantined: PrerequisiteGraph['quarantined'] = [];
  const proposed: RequiresEdge[] = [];
  const candidates: RequiresEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const k = `${edge.from}\0${edge.to}`;
    if (!conceptIds.has(edge.from) || !conceptIds.has(edge.to)) quarantined.push({ edge, reason: 'missing_endpoint' });
    else if (edge.from === edge.to) quarantined.push({ edge, reason: 'self_loop' });
    else if (seen.has(k)) quarantined.push({ edge, reason: 'duplicate' });
    else {
      seen.add(k);
      (edge.status === 'reviewed' ? candidates : proposed).push(edge);
    }
  }

  const component = stronglyConnected(candidates);
  const active: RequiresEdge[] = [];
  for (const edge of candidates) {
    const c = component.get(edge.from);
    if (c !== undefined && c === component.get(edge.to)) quarantined.push({ edge, reason: 'cycle' });
    else active.push(edge);
  }

  const adjacency = new Map<string, RequiresEdge[]>();
  for (const edge of active) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.to.localeCompare(b.to));
  return { version, active, proposed, quarantined, adjacency };
}

/** Tarjan SCC. 크기 2 이상인 컴포넌트에만 번호를 매겨 돌려준다. */
function stronglyConnected(edges: RequiresEdge[]): Map<string, number> {
  const out = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result = new Map<string, number>();
  let componentId = 0;

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const members: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        members.push(w);
      } while (w !== v);
      if (members.length > 1) {
        for (const m of members) result.set(m, componentId);
        componentId += 1;
      }
    }
  };
  for (const v of [...nodes].sort()) if (!index.has(v)) visit(v);
  return result;
}

/** 선행 개념이 먼저 오도록 정렬. 순서가 같으면 ID 순으로 고정한다. */
export function topoSort(ids: string[], graph: PrerequisiteGraph): string[] {
  const set = new Set(ids);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of set) indegree.set(id, 0);
  for (const edge of graph.active) {
    if (!set.has(edge.from) || !set.has(edge.to)) continue;
    indegree.set(edge.from, (indegree.get(edge.from) ?? 0) + 1);
    const list = dependents.get(edge.to) ?? [];
    list.push(edge.from);
    dependents.set(edge.to, list);
  }
  const ready = [...set].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const n = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, n);
      if (n === 0) {
        ready.push(dep);
        ready.sort();
      }
    }
  }
  return order;
}

export interface BundleOptions {
  /** 선행 경로 최대 깊이 (기본 2) */
  maxDepth: number;
  /** bundle 하나에 넣을 선행 개념 상한 (기본 4) */
  maxCount: number;
}

export interface PrerequisiteBundle {
  prerequisites: { conceptId: string; recallOnly: boolean }[];
  /** 상한 때문에 넣지 못한, 이해 증거가 없는 선행 개념 */
  unmet: string[];
}

/**
 * 목표 개념들을 depth 로 설명할 때 필요한 선행 개념을 모은다.
 * 첫 단계는 요청 깊이의 조건을, 그다음 단계는 선행 설명이 짧으므로 D1 이하 조건을 쓴다.
 * 이미 이해 증거가 있는 개념(isKnown)은 한 줄 상기(recallOnly)로 표시한다.
 */
export function prerequisiteBundle(
  targets: string[],
  depth: ExplanationDepth,
  graph: PrerequisiteGraph,
  isKnown: (conceptId: string) => boolean,
  opts: BundleOptions,
): PrerequisiteBundle {
  const targetSet = new Set(targets);
  const collected: string[] = [];
  const seen = new Set<string>(targets);
  let frontier = [...targetSet].sort();
  let level = 0;
  const beyond = new Set<string>();

  while (frontier.length) {
    const levelDepth = level === 0 ? depth : minDepth(depth, 'D1');
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.adjacency.get(id) ?? []) {
        if (!depthAtLeast(levelDepth, edge.minDepth) || seen.has(edge.to)) continue;
        seen.add(edge.to);
        if (level >= opts.maxDepth) beyond.add(edge.to);
        else next.push(edge.to);
      }
    }
    collected.push(...next.sort());
    level += 1;
    if (level > opts.maxDepth) break;
    frontier = next;
  }

  const kept: string[] = [];
  const unmet: string[] = [];
  for (const id of collected) {
    if (kept.length < opts.maxCount) kept.push(id);
    else if (!isKnown(id)) unmet.push(id);
  }
  for (const id of [...beyond].sort()) if (!isKnown(id)) unmet.push(id);

  return {
    prerequisites: topoSort(kept, graph).map((conceptId) => ({ conceptId, recallOnly: isKnown(conceptId) })),
    unmet,
  };
}
