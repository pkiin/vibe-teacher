import type { KnowledgeWikiResponse, SessionSummary } from '@vibe-teacher/shared';
import type { AnalysisService } from '../analyzers/index';
import { loadConceptDictionary } from '../analyzers/concepts/dictionary';
import type { SessionIndex } from '../index/session-index';
import type { WikiService } from '../wiki/service';
import { buildKnowledgeEntries, extractOccurrences, mentionPatterns, type SessionOccurrences } from './knowledge';
import type { LearnerService } from './service';

const MAX_SESSIONS = 40;
const MAX_CACHE = 400;

/**
 * 사용자 지식 위키 조립. 사용자 본인 계정(사용자명이 같은 홈)의 세션을 최근 것부터 살펴본다.
 * 세션별 결과는 세션 파일·위키 snapshot 이 바뀌지 않는 한 메모리에 둔다.
 */
export class KnowledgeService {
  private readonly cache = new Map<string, SessionOccurrences>();
  private patterns: Map<string, RegExp[]> | null = null;

  constructor(
    private readonly opts: {
      index: SessionIndex;
      analysis: AnalysisService;
      wiki: WikiService;
      learner: LearnerService;
    },
  ) {}

  /** 이 사용자의 세션 (최근 활동 순) */
  sessionsOf(username: string, projectId?: string): SessionSummary[] {
    const accounts = new Set(this.opts.index.getAccounts().filter((a) => a.username === username).map((a) => a.id));
    return this.opts.index
      .getProjects()
      .filter((p) => accounts.has(p.accountId) && (!projectId || p.id === projectId))
      .flatMap((p) => this.opts.index.getSessions(p.id))
      .sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? '') || b.fileMtime - a.fileMtime);
  }

  private async occurrences(summary: SessionSummary): Promise<SessionOccurrences | null> {
    const snapshot = await this.opts.wiki.current(summary.projectId, summary.key);
    const key = `${summary.key}|${summary.fileSize}|${summary.fileMtime}|${snapshot?.revision ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const session = await this.opts.index.loadSession(summary.key);
    if (!session) return null;
    const { concepts } = await this.opts.analysis.analyze(session);
    const catalog = this.opts.wiki.catalog();
    this.patterns ??= mentionPatterns(loadConceptDictionary());
    const occ = extractOccurrences({
      session,
      projectName: this.opts.index.getProject(summary.projectId)?.name ?? summary.projectId,
      hits: concepts,
      snapshot,
      patterns: this.patterns,
      knownConceptIds: new Set(catalog.concepts.keys()),
    });
    this.cache.set(key, occ);
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
  async wiki(input: { username: string; learnerId: string; projectId?: string; session?: SessionSummary }): Promise<Omit<KnowledgeWikiResponse, 'text'>> {
    const all = input.session ? [input.session] : this.sessionsOf(input.username, input.projectId);
    const picked = all.slice(0, MAX_SESSIONS);
    const sessions: SessionOccurrences[] = [];
    for (const s of picked) {
      const occ = await this.occurrences(s);
      if (occ) sessions.push(occ);
    }
    const profile = await this.opts.learner.profile(input.learnerId);
    const entries = buildKnowledgeEntries({
      sessions,
      profile,
      catalog: this.opts.wiki.catalog().concepts,
      ...(input.session ? { focusSessionKey: input.session.key } : {}),
      includeProfileOnly: !input.session && !input.projectId,
    });
    const projectIds = [...new Set(this.sessionsOf(input.username).map((s) => s.projectId))];
    return {
      profile,
      entries,
      projects: projectIds.map((id) => ({ id, name: this.opts.index.getProject(id)?.name ?? id })),
      scannedSessions: sessions.length,
      totalSessions: all.length,
    };
  }
}
