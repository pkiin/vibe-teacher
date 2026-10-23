import type { ConceptHit, KnowledgeEntry, KnowledgeMention, KnowledgeSource, LearnerConceptState, LearnerProfile, NormalizedSession, WikiConcept, WikiSnapshot } from '@vibe-teacher/shared';
import { truncate } from '../lib/text';
import { maskSecrets } from '../llm/digest';
import { unknownConcept } from './reducer';

/**
 * 사용자 지식 위키 (사용자 한 명, 모든 프로젝트).
 * - 세션마다 어떤 개념이 왜 나왔는지(위험 항목·위키 항목·개념 감지)와 사용자 메시지의 언급을 모은다.
 * - 언급은 이해 증거가 아니다 (plan §7.3). 상태는 learner 원장(문제 응답·자기보고·정정)만으로 정한다.
 * - 설명 문장은 그 상태가 어떤 근거(또는 근거 없음)에서 나왔는지를 그대로 말한다.
 */

export interface SessionOccurrences {
  sessionKey: string;
  sessionTitle: string;
  projectId: string;
  projectName: string;
  at?: string;
  request?: string;
  /** request: 그 개념이 나온 턴의 사용자 요청 (없으면 세션 첫 요청을 쓴다) */
  concepts: { conceptId: string; via: KnowledgeSource['via']; refTitle?: string; weight: number; request?: string }[];
  catalog?: WikiConcept[];
  mentions: { conceptId: string; messageIndex: number; snippet: string }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 이름에서 괄호를 뺀 짧은 이름: "권한 검사 (인가)" → "권한 검사" */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

/** 붙여 넣은 글·IDE 정보 태그를 뺀 사용자 본인의 말 (언급 감지와 요청 문구에 쓴다) */
export function ownWords(text: string): string {
  return text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, ' ')
    .replace(/<(ide_opened_file|ide_selection|system-reminder)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetAround(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return truncate(text, 60);
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + m[0].length + 30);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function extractOccurrences(input: {
  session: NormalizedSession;
  projectName: string;
  hits: ConceptHit[];
  snapshot: WikiSnapshot | null;
  patterns: Map<string, RegExp[]>;
  knownConceptIds: ReadonlySet<string>;
}): SessionOccurrences {
  const { session, snapshot } = input;
  const humans = session.messages.filter((m) => m.role === 'human' && m.text && !m.meta?.subagentId).map((m) => ({ index: m.index, text: ownWords(m.text ?? '') })).filter((m) => m.text);
  /** 근거가 나온 메시지 직전의 사용자 요청 = 그 턴의 요청 */
  const requestAt = (messageIndex: number | undefined): string | undefined => {
    if (messageIndex === undefined) return undefined;
    const h = [...humans].reverse().find((m) => m.index <= messageIndex);
    return h ? truncate(maskSecrets(h.text), 60) : undefined;
  };
  const evidence = new Map((snapshot?.evidence ?? []).map((e) => [e.id, e]));
  const claimIndex = new Map(
    (snapshot?.claims ?? []).map((c) => {
      const idx = c.evidenceIds.map((id) => evidence.get(id)?.messageIndex).filter((x): x is number => x !== undefined);
      return [c.id, idx.length ? Math.min(...idx) : undefined] as const;
    }),
  );
  const firstIndex = (claimIds: string[]) => {
    const idx = claimIds.map((id) => claimIndex.get(id)).filter((x): x is number => x !== undefined);
    return idx.length ? Math.min(...idx) : undefined;
  };
  const concepts: SessionOccurrences['concepts'] = [];
  if (snapshot) {
    for (const f of snapshot.findings) {
      const request = requestAt(firstIndex(f.claimIds));
      for (const id of f.relatedConceptIds) concepts.push({ conceptId: id, via: 'finding', refTitle: f.title, weight: 3, ...(request ? { request } : {}) });
    }
    for (const i of snapshot.items) {
      const request = requestAt(firstIndex(i.claimIds));
      i.conceptIds.forEach((id, n) => concepts.push({ conceptId: id, via: 'item', refTitle: i.title, weight: n === 0 ? 2 : 1.5, ...(request ? { request } : {}) }));
    }
  }
  for (const c of snapshot?.concepts ?? []) if (!concepts.some((x) => x.conceptId === c.id)) concepts.push({ conceptId: c.id, via: 'concept_hit', weight: 1 });
  for (const h of input.hits) if (input.knownConceptIds.has(h.id)) concepts.push({ conceptId: h.id, via: 'concept_hit', weight: 1 });

  const mentions: SessionOccurrences['mentions'] = [];
  const relevant = new Set(concepts.map((c) => c.conceptId));
  for (const id of relevant) {
    const res = input.patterns.get(id) ?? [];
    for (const m of humans) {
      const text = m.text;
      const re = res.find((r) => r.test(text));
      if (re) {
        mentions.push({ conceptId: id, messageIndex: m.index, snippet: maskSecrets(snippetAround(text, re)) });
        break;
      }
    }
  }
  const first = humans[0]?.text;
  return {
    sessionKey: session.key,
    sessionTitle: session.title,
    projectId: session.projectId,
    projectName: input.projectName,
    ...((session.endedAt ?? session.startedAt) ? { at: session.endedAt ?? session.startedAt } : {}),
    ...(first ? { request: truncate(maskSecrets(first).replace(/\s+/g, ' ').trim(), 60) } : {}),
    concepts,
    mentions,
  };
}

const STATE_ORDER: Record<LearnerConceptState['state'], number> = { conflicting: 0, unknown: 1, partial: 2, demonstrated: 3 };

export function buildKnowledgeEntries(input: {
  sessions: SessionOccurrences[];
  profile: LearnerProfile;
  catalog: Map<string, WikiConcept>;
  /** 이 세션을 근거 맨 앞에 둔다 (세션 화면) */
  focusSessionKey?: string;
  /** 원장에만 있고 세션에 나오지 않은 개념도 넣을지 (전체 지식 위키) */
  includeProfileOnly: boolean;
}): KnowledgeEntry[] {
  const byConcept = new Map<string, { sources: Map<string, KnowledgeSource & { weight: number }>; mentions: KnowledgeMention[]; weight: number; check: boolean }>();
  const get = (id: string) => {
    let e = byConcept.get(id);
    if (!e) {
      e = { sources: new Map(), mentions: [], weight: 0, check: false };
      byConcept.set(id, e);
    }
    return e;
  };
  for (const s of input.sessions) {
    for (const c of s.concepts) {
      if (!input.catalog.has(c.conceptId)) continue;
      const e = get(c.conceptId);
      e.weight += c.weight;
      if (c.via !== 'concept_hit') e.check = true;
      const prev = e.sources.get(s.sessionKey);
      if (!prev || prev.weight < c.weight) {
        e.sources.set(s.sessionKey, {
          sessionKey: s.sessionKey,
          sessionTitle: s.sessionTitle,
          projectId: s.projectId,
          projectName: s.projectName,
          ...(s.at ? { at: s.at } : {}),
          via: c.via,
          ...(c.refTitle ? { refTitle: c.refTitle } : {}),
          ...((c.request ?? s.request) ? { request: c.request ?? s.request } : {}),
          weight: c.weight,
        });
      }
    }
    for (const m of s.mentions) if (byConcept.has(m.conceptId)) get(m.conceptId).mentions.push({ sessionKey: s.sessionKey, sessionTitle: s.sessionTitle, messageIndex: m.messageIndex, snippet: m.snippet });
  }
  if (input.includeProfileOnly) for (const id of Object.keys(input.profile.concepts)) if (input.catalog.has(id)) get(id);

  const entries: KnowledgeEntry[] = [];
  for (const [id, e] of byConcept) {
    const concept = input.catalog.get(id)!;
    const state = input.profile.concepts[id] ?? unknownConcept(id);
    const sources = [...e.sources.values()]
      .sort((a, b) => Number(b.sessionKey === input.focusSessionKey) - Number(a.sessionKey === input.focusSessionKey) || b.weight - a.weight || (b.at ?? '').localeCompare(a.at ?? ''))
      .map(({ weight: _w, ...src }) => src);
    const mentions = e.mentions.slice(0, 3);
    const lastSeenAt = [...e.sources.values()].map((x) => x.at ?? '').sort().pop() || state.lastObservedAt;
    entries.push({
      conceptId: id,
      name: concept.name,
      category: concept.category,
      summary: concept.summary,
      state,
      reason: '',
      sources: sources.slice(0, 5),
      mentions,
      priority: e.check ? 'check' : 'background',
      ...(lastSeenAt ? { lastSeenAt } : {}),
    });
  }
  return entries.sort(
    (a, b) =>
      Number(b.priority === 'check') - Number(a.priority === 'check') ||
      STATE_ORDER[a.state.state] - STATE_ORDER[b.state.state] ||
      (byConcept.get(b.conceptId)?.weight ?? 0) - (byConcept.get(a.conceptId)?.weight ?? 0) ||
      a.conceptId.localeCompare(b.conceptId),
  );
}
