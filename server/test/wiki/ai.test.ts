import { describe, expect, it } from 'vitest';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { acceptWikiAiOutput, buildEvidencePool, buildWikiAiPrompt, mergeWikiAi } from '../../src/wiki/ai';
import { buildWikiSnapshot } from '../../src/wiki/build';
import { aiOutput, caseA } from './helpers';

function fixture() {
  const session = caseA(), built = summarizeBuilt(session);
  const snapshot = buildWikiSnapshot({ session, built, concepts: [] });
  const pool = buildEvidencePool(session, snapshot);
  const output = aiOutput(pool.find((e) => e.sourceKind === 'tool_call')!.id);
  const accept = () => acceptWikiAiOutput({ snapshot, pool, output, result: { provider: 'claude-cli', durationMs: 1 } });
  return { session, built, snapshot, pool, output, accept };
}
describe('AI-generated session knowledge', () => {
  it('accepts a new framework without a predefined dictionary and publishes its cards and risks', () => {
    const f = fixture();
    f.output.concepts[0]!.id = 'brand-new-framework';
    f.output.itemCandidates[0]!.conceptIds = ['brand-new-framework'];
    f.output.findings[0]!.conceptIds = ['brand-new-framework'];
    f.output.prerequisites = [{ from: 'brand-new-framework', to: 'auth' }];
    const layer = f.accept();
    expect(layer.rejected).toEqual([]);
    const view = mergeWikiAi(f.snapshot, layer).snapshot;
    expect(view.generator.kind).toBe('llm');
    expect(view.concepts?.[0]?.id).toBe('brand-new-framework');
    expect(view.items[0]?.conceptIds).toEqual(['brand-new-framework']);
    expect(view.findings).toHaveLength(1);
  });
  it('rejects invented evidence and all cards relying on an unknown reference', () => {
    const f = fixture();
    f.output.claimCandidates[0]!.evidenceIds.push('ev_fabricated');
    const layer = f.accept();
    expect(layer.claims).toEqual([]);
    expect(layer.items).toEqual([]);
    expect(layer.findings).toEqual([]);
    expect(layer.rejected.length).toBeGreaterThan(0);
  });
  it('does not quietly drop an unknown concept from an otherwise valid card', () => {
    const f = fixture(); f.output.itemCandidates[0]!.conceptIds.push('ghost');
    expect(f.accept().items).toEqual([]);
  });
  it('quarantines cyclic prerequisites and refuses generated URLs absent from sources', () => {
    const f = fixture(); f.output.prerequisites.push({ from: 'auth', to: 'authorization' });
    f.output.concepts[0]!.links = [{ title: '가짜', url: 'https://invented.invalid/docs' }, { title: '위험', url: 'javascript:alert(1)' }];
    const layer = f.accept();
    expect(layer.prerequisites).toEqual([]);
    expect(layer.concepts?.[0]?.links).toEqual([]);
    expect(layer.rejected.some((r) => r.reason.includes('cycle'))).toBe(true);
  });
  it('keeps assistant-only completion reports separate from observed results', () => {
    const f = fixture();
    f.output.claimCandidates[0]!.evidenceIds = [f.pool.find((e) => e.sourceKind === 'assistant_message')!.id];
    expect(f.accept().claims[0]?.kind).toBe('agent_reported');
  });
  it('never applies another revision and does not restrict the prompt to a catalog', () => {
    const f = fixture(), layer = f.accept();
    expect(mergeWikiAi({ ...f.snapshot, revision: 'different' }, layer).ai).toBeNull();
    const prompt = buildWikiAiPrompt({ ...f, concepts: [], catalog: new Map() });
    expect(prompt).toContain('인용 가능한 근거');
    expect(prompt).not.toContain('conceptIds 는 여기 있는 ID 만');
  });
});
