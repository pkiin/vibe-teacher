import type { NormalizedSession, WikiSnapshot } from '@vibe-teacher/shared';
import { sha1 } from '../lib/hash';

/**
 * 구조·출처 검사. 문장의 실제 진실성은 검증하지 못한다 (plan §17.1).
 * 걸린 claim·finding·item 은 publish 하지 않고 격리하며, 이유를 warnings 에 남기고 status 를 partial 로 낮춘다.
 */

export interface ValidationIssue {
  code:
    | 'foreign_evidence'
    | 'evidence_mismatch'
    | 'stale_claim'
    | 'missing_evidence'
    | 'unsupported_claim'
    | 'unscoped_inference'
    | 'missing_claim'
    | 'unsupported_finding'
    | 'missing_ref'
    | 'unknown_concept'
    | 'empty_item';
  ref: string;
  message: string;
}

export function validateSnapshot(s: WikiSnapshot, conceptIds: ReadonlySet<string>, session?: NormalizedSession): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const evidence = new Map(s.evidence.map((e) => [e.id, e]));
  const claims = new Set(s.claims.map((c) => c.id));
  const findings = new Set(s.findings.map((f) => f.id));

  const messages = session ? new Map(session.messages.map((m) => [m.index, m])) : null;
  const toolCalls = session ? new Set(session.toolCalls.map((tc) => tc.id)) : null;
  for (const e of s.evidence) {
    if (e.sessionKey !== s.sessionKey) issues.push({ code: 'foreign_evidence', ref: e.id, message: '다른 세션(snapshot)의 근거입니다' });
    if (!messages || !toolCalls) continue;
    if (e.toolCallId && !toolCalls.has(e.toolCallId)) issues.push({ code: 'evidence_mismatch', ref: e.id, message: '기록에 없는 도구 호출을 가리킵니다' });
    if ((e.sourceKind === 'human_message' || e.sourceKind === 'assistant_message') && e.messageIndex !== undefined) {
      const m = messages.get(e.messageIndex);
      if (!m || sha1(m.text ?? '') !== e.contentHash) issues.push({ code: 'evidence_mismatch', ref: e.id, message: '인용한 메시지 원문과 일치하지 않습니다' });
    }
  }

  for (const c of s.claims) {
    if (c.validAt !== s.revision) issues.push({ code: 'stale_claim', ref: c.id, message: `다른 snapshot(${c.validAt})의 주장입니다` });
    for (const id of c.evidenceIds) if (!evidence.has(id)) issues.push({ code: 'missing_evidence', ref: c.id, message: `없는 근거 ID: ${id}` });
    if ((c.kind === 'observed_artifact' || c.kind === 'agent_reported') && !c.evidenceIds.length) issues.push({ code: 'unsupported_claim', ref: c.id, message: '근거 없는 관찰 주장입니다' });
    if (c.kind === 'inference' && !c.evidenceIds.length && !c.limits.length) issues.push({ code: 'unscoped_inference', ref: c.id, message: '근거도 범위 한계도 없는 해석입니다' });
  }

  for (const f of s.findings) {
    for (const id of f.claimIds) if (!claims.has(id)) issues.push({ code: 'missing_claim', ref: f.id, message: `없는 주장 ID: ${id}` });
    if (!f.claimIds.length) issues.push({ code: 'unsupported_finding', ref: f.id, message: '연결된 주장이 없는 위험 항목입니다' });
  }

  for (const i of s.items) {
    for (const id of i.claimIds) if (!claims.has(id)) issues.push({ code: 'missing_ref', ref: i.id, message: `없는 주장 ID: ${id}` });
    for (const id of i.findingIds) if (!findings.has(id)) issues.push({ code: 'missing_ref', ref: i.id, message: `없는 위험 ID: ${id}` });
    for (const id of i.conceptIds) if (!conceptIds.has(id)) issues.push({ code: 'unknown_concept', ref: i.id, message: `카탈로그에 없는 개념: ${id}` });
    if (!i.claimIds.length && !i.findingIds.length) issues.push({ code: 'empty_item', ref: i.id, message: '프로젝트 근거가 없는 지식 항목입니다' });
  }
  return issues;
}

/** 검사에 걸린 것을 격리한 snapshot 을 돌려준다. 격리한 것이 있으면 status 를 partial 로 낮춘다. */
export function enforceSnapshot(s: WikiSnapshot, conceptIds: ReadonlySet<string>, session?: NormalizedSession): { snapshot: WikiSnapshot; issues: ValidationIssue[] } {
  const issues = validateSnapshot(s, conceptIds, session);
  if (!issues.length) return { snapshot: s, issues };

  const badEvidence = new Set(issues.filter((i) => i.code === 'foreign_evidence' || i.code === 'evidence_mismatch').map((i) => i.ref));
  const evidence = s.evidence.filter((e) => !badEvidence.has(e.id));
  const evidenceIds = new Set(evidence.map((e) => e.id));

  const claimIssues = new Set(issues.filter((i) => ['stale_claim', 'missing_evidence', 'unsupported_claim', 'unscoped_inference'].includes(i.code)).map((i) => i.ref));
  const claims = s.claims.filter((c) => !claimIssues.has(c.id) && c.evidenceIds.every((id) => evidenceIds.has(id)) && (c.kind === 'inference' || c.kind === 'background' || c.evidenceIds.length > 0));
  const claimIds = new Set(claims.map((c) => c.id));

  const findings = s.findings.map((f) => ({ ...f, claimIds: f.claimIds.filter((id) => claimIds.has(id)) })).filter((f) => f.claimIds.length > 0);
  const findingIds = new Set(findings.map((f) => f.id));

  const items = s.items
    .map((i) => ({
      ...i,
      claimIds: i.claimIds.filter((id) => claimIds.has(id)),
      findingIds: i.findingIds.filter((id) => findingIds.has(id)),
      conceptIds: i.conceptIds.filter((id) => conceptIds.has(id)),
    }))
    .filter((i) => i.claimIds.length > 0 || i.findingIds.length > 0);

  const quarantined = [
    ...s.claims.filter((c) => !claimIds.has(c.id)).map((c) => c.id),
    ...s.findings.filter((f) => !findingIds.has(f.id)).map((f) => f.id),
    ...s.items.filter((i) => !items.some((x) => x.id === i.id)).map((i) => i.id),
  ];
  const warnings = [...s.warnings, ...issues.map((i) => `[검사] ${i.ref}: ${i.message}`), ...(quarantined.length ? [`[격리] ${quarantined.join(', ')}`] : [])];
  return {
    snapshot: { ...s, evidence, claims, findings, items, warnings, status: s.status === 'failed' ? 'failed' : 'partial' },
    issues,
  };
}
