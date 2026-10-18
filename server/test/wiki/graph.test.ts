import { describe, expect, it } from 'vitest';
import { loadWikiCatalog } from '../../src/wiki/catalog';
import { buildPrerequisiteGraph, prerequisiteBundle, topoSort, type RequiresEdge } from '../../src/wiki/graph';

const e = (from: string, to: string, minDepth: RequiresEdge['minDepth'] = 'D1', status: RequiresEdge['status'] = 'reviewed'): RequiresEdge => ({ from, to, minDepth, status });
const ids = (...xs: string[]) => new Set(xs);
const none = () => false;
const opts = { maxDepth: 2, maxCount: 4 };

describe('prerequisite graph (T13)', () => {
  it('quarantines edges with missing endpoints and self loops instead of using them', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b'), e('a', 'ghost'), e('b', 'b')], ids('a', 'b'));
    expect(g.active).toEqual([e('a', 'b')]);
    expect(g.quarantined.map((q) => q.reason).sort()).toEqual(['missing_endpoint', 'self_loop']);
  });

  it('quarantines every edge of a cycle but keeps unrelated edges active', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('d', 'a')], ids('a', 'b', 'c', 'd'));
    expect(g.quarantined.filter((q) => q.reason === 'cycle').map((q) => `${q.edge.from}${q.edge.to}`).sort()).toEqual(['ab', 'bc', 'ca']);
    expect(g.active).toEqual([e('d', 'a')]);
  });

  it('keeps proposed edges out of bundles', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b', 'D1', 'proposed')], ids('a', 'b'));
    expect(g.proposed).toHaveLength(1);
    expect(prerequisiteBundle(['a'], 'D3', g, none, opts).prerequisites).toEqual([]);
  });

  it('applies minDepth conditions', () => {
    const g = buildPrerequisiteGraph('t', [e('authz', 'authn', 'D1'), e('authz', 'boundary', 'D2')], ids('authz', 'authn', 'boundary'));
    expect(prerequisiteBundle(['authz'], 'D0', g, none, opts).prerequisites).toEqual([]);
    expect(prerequisiteBundle(['authz'], 'D1', g, none, opts).prerequisites.map((p) => p.conceptId)).toEqual(['authn']);
    expect(prerequisiteBundle(['authz'], 'D2', g, none, opts).prerequisites.map((p) => p.conceptId)).toEqual(['authn', 'boundary']);
  });

  it('marks prerequisites beyond the path depth as unmet instead of dropping them silently', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b'), e('b', 'c'), e('c', 'd')], ids('a', 'b', 'c', 'd'));
    const res = prerequisiteBundle(['a'], 'D1', g, none, opts);
    expect(res.prerequisites.map((p) => p.conceptId)).toEqual(['c', 'b']);
    expect(res.unmet).toEqual(['d']);
  });

  it('caps bundle size and reports the overflow as unmet', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b'), e('a', 'c'), e('a', 'd')], ids('a', 'b', 'c', 'd'));
    const res = prerequisiteBundle(['a'], 'D1', g, none, { maxDepth: 2, maxCount: 1 });
    expect(res.prerequisites.map((p) => p.conceptId)).toEqual(['b']);
    expect(res.unmet).toEqual(['c', 'd']);
  });

  it('turns prerequisites with existing evidence into one-line recalls', () => {
    const g = buildPrerequisiteGraph('t', [e('a', 'b'), e('a', 'c')], ids('a', 'b', 'c'));
    const res = prerequisiteBundle(['a'], 'D1', g, (id) => id === 'b', opts);
    expect(res.prerequisites).toEqual([
      { conceptId: 'b', recallOnly: true },
      { conceptId: 'c', recallOnly: false },
    ]);
  });

  it('sorts prerequisites before dependents with a stable tie-break', () => {
    const g = buildPrerequisiteGraph('t', [e('x', 'y'), e('y', 'z')], ids('x', 'y', 'z', 'w'));
    expect(topoSort(['x', 'w', 'y', 'z'], g)).toEqual(['w', 'z', 'y', 'x']);
  });
});

describe('shipped catalog', () => {
  it('has no quarantined prerequisite edges and every concept has a summary', () => {
    const catalog = loadWikiCatalog();
    expect(catalog.graph.quarantined).toEqual([]);
    expect(catalog.graph.active.length).toBeGreaterThan(10);
    for (const c of catalog.concepts.values()) expect(c.summary.length).toBeGreaterThan(5);
    expect(catalog.concepts.get('authorization')?.confusions.length).toBeGreaterThan(0);
  });
});
