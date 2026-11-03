import type { KnowledgeWikiResponse, SessionSummary, WikiConcept } from '@vibe-teacher/shared';
import type { AnalysisService } from '../analyzers/index';
import type { EnrichService } from '../llm/service';
import { conceptFromHit } from '../llm/concepts';
import type { SessionIndex } from '../index/session-index';
import type { WikiService } from '../wiki/service';
import { buildKnowledgeEntries, extractOccurrences, type SessionOccurrences } from './knowledge';
import type { LearnerService } from './service';
import { reduceProfile, unknownConcept } from './reducer';

const MAX_SESSIONS = 40;
const MAX_CACHE = 400;

/**
 * 사용자 지식 위키 조립. 사용자 본인 계정(사용자명이 같은 홈)의 세션을 최근 것부터 살펴본다.
 * 세션별 결과는 세션 파일·위키 snapshot 이 바뀌지 않는 한 메모리에 둔다.
 */
export class KnowledgeService {
  private readonly cache = new Map<string, SessionOccurrences>();

  constructor(
    private readonly opts: {
      index: SessionIndex;
      analysis: AnalysisService;
      wiki: WikiService;
      learner: LearnerService;
      enrich?: EnrichService;
    },
  ) {}

  /** 이 사용자의 세션 (최근 활동 순) */
  sessionsOf(username: string, projectId?: string, accountIds?: ReadonlySet<string>): SessionSummary[] {
    const accounts = accountIds ?? new Set(this.opts.index.getAccounts().filter((a) => a.username === username).map((a) => a.id));
    return this.opts.index
      .getProjects()
      .filter((p) => accounts.has(p.accountId) && (!projectId || p.id === projectId))
      .flatMap((p) => this.opts.index.getSessions(p.id))
      .sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? '') || b.fileMtime - a.fileMtime);
  }

  private async occurrences(summary: SessionSummary): Promise<SessionOccurrences | null> {
    const snapshot = await this.opts.wiki.current(summary.projectId, summary.key);
    const key = `${summary.key}|${summary.fileSize}|${summary.fileMtime}|${snapshot?.revision ?? ''}|${snapshot?.builtAt ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const session = await this.opts.index.loadSession(summary.key);
    if (!session) return null;
    const cached = await this.opts.enrich?.getCached(session, 'any');
    const hits = cached ? this.opts.enrich!.mergeConcepts([], cached) : [];
    const catalog = this.opts.wiki.catalog(snapshot);
    for (const hit of hits) if (!catalog.concepts.has(hit.id)) catalog.concepts.set(hit.id, conceptFromHit(hit));
    const occ = extractOccurrences({
      session,
      projectName: this.opts.index.getProject(summary.projectId)?.name ?? summary.projectId,
      hits,
      snapshot,
      patterns: new Map(),
      knownConceptIds: new Set(catalog.concepts.keys()),
    });
    occ.catalog = [...catalog.concepts.values()];
    // 세션 요약만 새로 생성되어도 개념이 달라질 수 있어 AI 분석 캐시의 시각을 포함한다.
    if (!this.opts.enrich) this.cache.set(key, occ);
    while (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return occ;
  }

  /**
   * 사용자 지식 위키. session 을 주면 그 세션에 나온 개념만, projectId 를 주면 그 프로젝트 세션만 본다.
   * session 은 다른 계정의 세션일 수도 있다 (관리자가 보는 경우) — 근거는 그 세션, 상태는 보는 사람 본인의 것.
   */
  async wiki(input: { username: string; learnerId: string; projectId?: string; session?: SessionSummary; accountIds?: ReadonlySet<string> }): Promise<Omit<KnowledgeWikiResponse, 'text'>> {
    const all = input.session ? [input.session] : this.sessionsOf(input.username, input.projectId, input.accountIds);
    const picked = all.slice(0, MAX_SESSIONS);
    const sessions: SessionOccurrences[] = [];
    for (const s of picked) {
      const occ = await this.occurrences(s);
      if (occ) sessions.push(occ);
    }
    const profile = await this.opts.learner.profile(input.learnerId);
    const catalog = new Map<string, WikiConcept>();
    for (const s of sessions) for (const c of s.catalog ?? []) if (!catalog.has(c.id)) catalog.set(c.id, c);
    const remembered = await this.opts.learner.concepts(input.learnerId);
    const allowed = new Map(all.map((s) => [s.key, s]));
    const extras = new Map<string, SessionOccurrences>();
    for (const { concept, sources } of Object.values(remembered)) {
      const relevant = sources.filter((s) => allowed.has(s.sessionKey));
      if ((!input.session && !input.projectId && !sources.length) || relevant.length) catalog.set(concept.id, catalog.get(concept.id) ?? concept);
      for (const source of relevant) {
        if (sessions.some((s) => s.sessionKey === source.sessionKey && s.concepts.some((c) => c.conceptId === concept.id))) continue;
        const summary = allowed.get(source.sessionKey)!;
        const extra = extras.get(source.sessionKey) ?? { sessionKey: summary.key, sessionTitle: summary.title, projectId: summary.projectId, projectName: this.opts.index.getProject(summary.projectId)?.name ?? summary.projectId, concepts: [], mentions: [] };
        extra.concepts.push({ conceptId: concept.id, via: 'concept_hit', weight: 1 });
        extras.set(source.sessionKey, extra);
      }
    }
    const entries = buildKnowledgeEntries({
      sessions: [...sessions, ...extras.values()],
      profile,
      catalog,
      ...(input.session ? { focusSessionKey: input.session.key } : {}),
      includeProfileOnly: !input.session && !input.projectId,
    });
    if (input.session || input.projectId) {
      const events = (await this.opts.learner.events(input.learnerId)).filter((e) => input.session ? e.sessionKey === input.session.key : !!e.projectId && this.opts.index.getProject(e.projectId)?.id === input.projectId);
      const scoped = reduceProfile(events, input.learnerId);
      for (const entry of entries) entry.scope = { kind: input.session ? 'session' : 'project', state: scoped.concepts[entry.conceptId] ?? unknownConcept(entry.conceptId) };
    }
    const projectIds = [...new Set(this.sessionsOf(input.username, undefined, input.accountIds).map((s) => s.projectId))];
    return {
      profile,
      entries,
      concepts: Object.fromEntries(catalog),
      projects: projectIds.map((id) => ({ id, name: this.opts.index.getProject(id)?.name ?? id })),
      scannedSessions: sessions.length,
      totalSessions: all.length,
    };
  }
}
