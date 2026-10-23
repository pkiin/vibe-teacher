import { describe, expect, it } from 'vitest';
import { buildWikiSnapshot, makeEvidence, snapshotRevision } from '../../src/wiki/build';
import { summarizeBuilt } from '../../src/analyzers/built/index';
import { buildEvidencePool } from '../../src/wiki/ai';
import { validateSnapshot } from '../../src/wiki/validate';
import { caseA, snapshotOf } from './helpers';

describe('AI wiki input', () => {
  it('creates no rule-selected concepts, warnings, claims or learning cards', () => {
    const session = caseA();
    const base = buildWikiSnapshot({ session, built: summarizeBuilt(session), concepts: [] });
    expect(base.generator.kind).toBe('pending');
    expect([base.claims, base.findings, base.items, base.concepts]).toEqual([[], [], [], []]);
  });
  it('changes revision when the source changes and keeps evidence IDs stable', () => {
    const session = caseA();
    expect(snapshotRevision(session)).toBe(snapshotRevision(session));
    expect(snapshotRevision({ ...session, fileMtime: session.fileMtime + 1 })).not.toBe(snapshotRevision(session));
    expect(makeEvidence(session.key, 'tool_call', 'source', {})).toEqual(makeEvidence(session.key, 'tool_call', 'source', {}));
  });
  it('masks secrets in evidence while preserving source verification', () => {
    const session = caseA();
    session.messages[0]!.text = 'OPENROUTER_API_KEY=sk-abcdefghijklmnopqrstuvwxyz12345';
    const snapshot = snapshotOf(session);
    expect(JSON.stringify(snapshot)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz12345');
    expect(validateSnapshot(snapshot, new Set(snapshot.concepts!.map((c) => c.id)), session)).toEqual([]);
    expect(buildEvidencePool(session, snapshot).some((e) => e.sourceKind === 'tool_result')).toBe(true);
  });
});
