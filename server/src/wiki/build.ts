import { WIKI_SCHEMA_VERSION, type BuiltSummary, type ConceptHit, type EvidenceRef, type EvidenceSourceKind, type NormalizedSession, type WikiSnapshot } from '@vibe-teacher/shared';
import { sha1, shortId } from '../lib/hash';
import { truncate } from '../lib/text';
import { maskSecrets } from '../llm/digest';

/** 입력 식별자와 출처만 만든다. 개념·설명·주의사항의 판단은 AI가 담당한다. */
export const RULES_VERSION = 'ai-pipeline-1';
export function snapshotRevision(s: { key: string; fileSize: number; fileMtime: number }): string {
  return `s_${shortId(`${s.key}|${s.fileSize}|${s.fileMtime}|${RULES_VERSION}`, 16)}`;
}

export interface EvidenceWhere {
  messageIndex?: number;
  toolCallId?: string;
  label?: string;
  timestamp?: string;
  focusMasked?: boolean;
}

/** 근거 하나. ID 는 세션·위치·원문 해시로 정해지므로 같은 원문이면 늘 같은 ID 가 나온다. 발췌는 비밀값을 가린다. */
export function makeEvidence(sessionKey: string, sourceKind: EvidenceSourceKind, raw: string, where: EvidenceWhere): EvidenceRef {
  const text = raw ?? '';
  const id = `ev_${shortId(`${sessionKey}|${sourceKind}|${where.toolCallId ?? ''}|${where.messageIndex ?? ''}|${sha1(text)}`, 14)}`;
  const parts = [where.messageIndex !== undefined ? `메시지 #${where.messageIndex}` : null, where.label ?? null].filter(Boolean);
  return {
    id,
    sessionKey,
    sourceKind,
    ...(where.messageIndex !== undefined ? { messageIndex: where.messageIndex } : {}),
    ...(where.toolCallId ? { toolCallId: where.toolCallId } : {}),
    locator: parts.join(' · ') || '세션 기록',
    excerpt: truncate(maskSecrets(text), 1000),
    contentHash: sha1(text),
    ...(where.timestamp ? { timestamp: where.timestamp } : {}),
  };
}


export interface BuildInput {
  session: NormalizedSession;
  built: BuiltSummary;
  concepts: ConceptHit[];
  catalogVersion?: string;
  conceptIds?: ReadonlySet<string>;
  now?: Date;
}

/** AI 생성을 기다리는 입력 snapshot. 규칙으로 카드나 주의사항을 만들지 않는다. */
export function buildWikiSnapshot({ session, now }: BuildInput): WikiSnapshot {
  return {
    schemaVersion: WIKI_SCHEMA_VERSION, projectId: session.projectId, sessionKey: session.key,
    revision: snapshotRevision(session), builtAt: (now ?? new Date()).toISOString(),
    generator: { kind: 'pending', rulesVersion: RULES_VERSION, catalogVersion: 'session-generated-1' },
    status: 'partial',
    coverage: {
      chat: 'partial', diff: 'partial', repository: 'unavailable', runtimeLogs: 'partial', deploymentConfig: 'unavailable',
      notes: ['제공된 세션 기록의 발췌만 AI에 전달합니다. 저장소 전체나 배포 상태를 확인한 것은 아닙니다.'],
    },
    evidence: [], claims: [], findings: [], items: [], concepts: [], prerequisites: [], warnings: [],
  };
}
