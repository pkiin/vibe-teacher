import path from 'node:path';
import type { BuiltSummary, ConceptHit, LearnerProfile, NormalizedSession, SessionSummary, WikiAiLayer, WikiConcept, WikiResponse, WikiSnapshot } from '@vibe-teacher/shared';
import { loadQuestionBank } from '../assessment/bank';
import { AssessmentService } from '../assessment/service';
import { LearnerService } from '../learner/service';
import type { ConfigStore } from '../config/store';
import type { ResolvedLlm } from '../llm/select';
import { mergeWikiAi } from './ai';
import { WikiAiService } from './ai-service';
import { shortId } from '../lib/hash';
import { WikiStorage } from '../storage/store';
import { RULES_VERSION, buildWikiSnapshot, snapshotRevision } from './build';
import { loadWikiCatalog } from './catalog';
import { planWiki } from './plan';
import { enforceSnapshot } from './validate';

export interface SessionWikiIndex {
  sessionKey: string;
  current: string;
  history: { revision: string; builtAt: string; status: WikiSnapshot['status']; rulesVersion: string }[];
}

/**
 * 프로젝트 평면 위키 저장·조회와 개인 뷰 조립.
 *   wiki/projects/<projectId>/snapshots/<revision>.json   검증을 통과한 원장
 *   wiki/projects/<projectId>/sessions/<세션 해시>.json      세션별 현재 revision 과 이력
 */
export class WikiService {
  constructor(
    private readonly storage: WikiStorage,
    private readonly store: ConfigStore,
  ) {}

  catalog() {
    return loadWikiCatalog();
  }

  bank() {
    return loadQuestionBank(new Set(this.catalog().concepts.keys()));
  }

  private snapshotFile(projectId: string, revision: string): string {
    return path.join(this.storage.projectDir(projectId), 'snapshots', `${revision}.json`);
  }

  private indexFile(projectId: string, sessionKey: string): string {
    return path.join(this.storage.projectDir(projectId), 'sessions', `${shortId(`session:${sessionKey}`, 16)}.json`);
  }

  async build(session: NormalizedSession, analysis: { built: BuiltSummary; concepts: ConceptHit[] }): Promise<WikiSnapshot> {
    const catalog = this.catalog();
    const conceptIds = new Set(catalog.concepts.keys());
    const raw = buildWikiSnapshot({ session, built: analysis.built, concepts: analysis.concepts, catalogVersion: catalog.version, conceptIds });
    const { snapshot } = enforceSnapshot(raw, conceptIds, session);
    await this.storage.lock(`project:${session.projectId}`, async () => {
      await this.storage.writeJson(this.snapshotFile(session.projectId, snapshot.revision), snapshot);
      const indexFile = this.indexFile(session.projectId, session.key);
      const prev = await this.storage.readJson<SessionWikiIndex>(indexFile);
      const entry = { revision: snapshot.revision, builtAt: snapshot.builtAt, status: snapshot.status, rulesVersion: RULES_VERSION };
      const history = [...(prev?.history ?? []).filter((h) => h.revision !== snapshot.revision), entry];
      await this.storage.writeJson(indexFile, { sessionKey: session.key, current: snapshot.revision, history } satisfies SessionWikiIndex);
    });
    return snapshot;
  }

  async current(projectId: string, sessionKey: string): Promise<WikiSnapshot | null> {
    const index = await this.storage.readJson<SessionWikiIndex>(this.indexFile(projectId, sessionKey));
    if (!index || index.sessionKey !== sessionKey) return null;
    const snapshot = await this.storage.readJson<WikiSnapshot>(this.snapshotFile(projectId, index.current));
    return snapshot && snapshot.sessionKey === sessionKey ? snapshot : null;
  }

  async history(projectId: string, sessionKey: string): Promise<SessionWikiIndex['history']> {
    const index = await this.storage.readJson<SessionWikiIndex>(this.indexFile(projectId, sessionKey));
    return index?.sessionKey === sessionKey ? index.history : [];
  }

  isStale(snapshot: WikiSnapshot, summary: SessionSummary): boolean {
    return snapshot.revision !== snapshotRevision(summary);
  }

  /** 프로젝트 원장 + 개인 상태 → 화면용 응답. profile 이 null 이면 개인화 없이 계획한다. */
  view(base: WikiSnapshot, profile: LearnerProfile | null, answeredQuestionIds: ReadonlySet<string>, stale: boolean, aiLayer: WikiAiLayer | null = null): WikiResponse {
    const catalog = this.catalog();
    const { snapshot, ai } = mergeWikiAi(base, aiLayer, new Set(catalog.concepts.keys()));
    const plan = planWiki({ snapshot, profile, concepts: catalog.concepts, graph: catalog.graph, settings: this.store.get().wiki, bank: this.bank(), answeredQuestionIds });
    const ids = new Set<string>();
    for (const item of snapshot.items) for (const c of item.conceptIds) ids.add(c);
    for (const f of snapshot.findings) for (const c of f.relatedConceptIds) ids.add(c);
    for (const b of plan.bundles) for (const p of b.prerequisites) ids.add(p.conceptId);
    for (const b of plan.bundles) for (const c of b.prerequisiteUnmet) ids.add(c);
    const concepts: Record<string, WikiConcept> = {};
    for (const id of ids) {
      const c = catalog.concepts.get(id);
      if (c) concepts[id] = c;
    }
    return { snapshot, plan, concepts, stale, ai };
  }
}

/**
 * 위키·학습자·출제·AI 보강 서비스를 같은 저장소(<home>/wiki)로 묶어 만든다.
 * resolveProvider 는 "AI로 자세히 분석"과 같은 제공자 설정을 쓰도록 EnrichService 에서 받는다.
 */
export function createWikiServices(
  home: string,
  store: ConfigStore,
  resolveProvider: () => Promise<ResolvedLlm>,
): { wiki: WikiService; learner: LearnerService; assessments: AssessmentService; wikiAi: WikiAiService } {
  const storage = new WikiStorage(home);
  const learner = new LearnerService(storage);
  const wiki = new WikiService(storage, store);
  return { wiki, learner, assessments: new AssessmentService(learner, () => wiki.bank()), wikiAi: new WikiAiService({ storage, store, wiki, resolveProvider }) };
}
