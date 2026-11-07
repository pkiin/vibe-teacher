import path from 'node:path';
import { READER_LEVELS, type Project, type ReaderLevel, type RepoFeature, type RepoSection, type RepoSource, type RepoWiki, type RepoWikiAiPreview, type RepoWikiBuildResponse, type RepoWikiHistoryEntry, type RepoWikiResponse } from '@vibe-teacher/shared';
import type { AnalysisService } from '../analyzers/index';
import type { ConfigStore } from '../config/store';
import type { SessionIndex } from '../index/session-index';
import { textGate, type TextGate } from '../llm/gate';
import { JobQueue } from '../llm/jobs';
import { withAiRun } from '../llm/log';
import { withReader } from '../llm/reader';
import { modelFor } from '../llm/select';
import type { EnrichService } from '../llm/service';
import { LlmError } from '../llm/types';
import type { WikiStorage } from '../storage/store';
import type { WikiService } from '../wiki/service';
import { ownWords } from '../learner/knowledge';
import { shortId } from '../lib/hash';
import { truncate } from '../lib/text';
import { REPO_AI_SYSTEM_PROMPT, REPO_DB_SYSTEM_PROMPT, REPO_FLOW_SYSTEM_PROMPT, RepoAiOutputSchema, RepoDbOutputSchema, applyRepoAi, assertRepoFlowComplete, buildRepoAiPrompt, dropRepeatedBlocks, incompleteRepoDbTables, mergeRepoDbRepair, mergeRepoFlowRepair, missingRepoFlowNodes, replaceRepoRefs, repoFlowOutputSchema, repoFlowRepairUser, unverifiedRepoRefs, type RepoAiOutput, type RepoDbAnswer } from './ai';
import { askDbFeatureLinks } from './db-link';
import { askRepoRefFixes } from './ref-fix';
import { askRepoFeatures, buildFeaturePickUser, pickedFeaturesText, REPO_FEATURE_PICK_SYSTEM_PROMPT, type RepoFeaturePick } from './feature-pick';
import { SESSION_MADE_LIMITS, SESSION_MADE_VERSION, sessionMade, type RepoSessionMade, type SessionMadeCache } from './session-made';
import { scanRepo, type RepoScan } from './scan';
import { buildRepoWiki, REPO_WIKI_VERSION, type RepoSessionDigest } from './wiki';
import { inspectRepo, REPO_INSPECTION_LIMITS } from './inspect';
import { mapConcurrent } from '../lib/concurrent';
import { beginActivity } from '../lib/progress';

const MAX_SESSIONS = 60;
const MAX_HISTORY = 30;
const REPO_TEXT_VERSION = 10;

type Allowed = { ok: boolean; reason?: string };

export interface RepoJobResult {
  revision: string;
  level: ReaderLevel;
  generator: RepoWiki['generator']['kind'];
  reason?: string;
}

/** AI 에 보낼 재료. 판(revision)마다 한 번 만들어 두고, 수준별 문장은 이것으로 쓴다 */
interface Materials {
  revision: string;
  user: string;
  flowUser?: string;
  /** 데이터베이스 표 자료 (표 설명 보완 호출용) */
  dbUser?: string;
  /** 표를 쓰는 파일 → 그 파일을 불러오는 파일 (기능 연결 질문용) */
  dbImporters?: Record<string, string[]>;
  /** 주요 기능 질문 자료 (README·경로·표를 쓰는 파일·모든 세션에서 만들어진 것·파일 목록) */
  featureUser?: string;
  handles: [string, string][];
  files: string[];
}

/** 읽는 사람 수준별 AI 문장 */
interface TextLayer {
  promptVersion?: number;
  revision: string;
  level: ReaderLevel;
  inputHash: string;
  at: string;
  generator: RepoWiki['generator'];
  user?: RepoSection[];
  system?: RepoSection[];
  features?: RepoFeature[];
  /** AI 결과에서 생긴 경고 (사실 초안의 경고는 따로) */
  warnings?: string[];
  /** 호출이 실패한 사유. 같은 입력으로는 자동으로 다시 부르지 않는다 ("다시 쓰기"로만) */
  failed?: string;
}

interface Draft {
  scan: RepoScan;
  digests: RepoSessionDigest[];
  draft: RepoWiki;
  /** 모든 세션에서 규칙으로 모은 '만들어진 것' (최근 순) */
  made: RepoSessionMade[];
  /** 바뀐 세션이 있으면 저장할 '만들어진 것' 모음 (POST 에서만 저장) */
  madeCache?: SessionMadeCache;
}

/** 문장 레이어를 다시 쓸지 정하는 지문: 본문·주요 기능 질문의 시스템 프롬프트와 입력, 제공자·모델 */
function textInputHash(materials: Materials, level: ReaderLevel, providerId: string, model: string | null | undefined): string {
  return shortId(`${withReader(REPO_AI_SYSTEM_PROMPT, level)}|${materials.user}|${materials.featureUser ? `${withReader(REPO_FEATURE_PICK_SYSTEM_PROMPT, level)}|${materials.featureUser}` : ''}|${providerId}|${model ?? ''}`, 16);
}

/**
 * 레포 위키 저장·갱신:
 *   wiki/projects/<projectId>/repo/current.json        원본 자료 (모든 수준이 함께 씀)
 *   wiki/projects/<projectId>/repo/history.json        판마다 달라진 점
 *   wiki/projects/<projectId>/repo/materials.json      AI 에 보낼 재료 (지금 판)
 *   wiki/projects/<projectId>/repo/sessions-made.json  세션마다 규칙으로 모은 '만들어진 것' (세션 파일이 그대로면 다시 읽지 않음)
 *   wiki/projects/<projectId>/repo/text/<수준>.json     읽는 사람 수준별 AI 문장
 * 사실(명령·파일·API·변경)은 코드가 모으고, 사람이 읽는 문장은 AI 가 읽는 사람 수준에 맞춰 쓴다.
 * AI를 쓸 수 없으면 생성 실패 사유를 남기며 고정 설명으로 대체하지 않는다.
 */
export class RepoWikiService {
  readonly jobs = new JobQueue<RepoJobResult>();

  constructor(
    private readonly opts: {
      storage: WikiStorage;
      store: ConfigStore;
      index: SessionIndex;
      analysis: AnalysisService;
      wiki: WikiService;
      enrich: EnrichService;
    },
  ) {}

  static jobKey(projectId: string, level: ReaderLevel): string {
    return `repo:${projectId}:${level}`;
  }

  private files(projectId: string) {
    const dir = path.join(this.opts.storage.projectDir(projectId), 'repo');
    return {
      current: path.join(dir, 'current.json'),
      history: path.join(dir, 'history.json'),
      materials: path.join(dir, 'materials.json'),
      made: path.join(dir, 'sessions-made.json'),
      text: (level: ReaderLevel) => path.join(dir, 'text', `${level}.json`),
    };
  }

  /** 예전 프로젝트 ID 의 같은 파일을 함께 읽는다. 회원 모드에서는 읽기마다 Supabase 왕복이라 동시에 읽는다. */
  private readAll<T>(projectId: string, file: (files: ReturnType<RepoWikiService['files']>) => string): Promise<{ files: ReturnType<RepoWikiService['files']>; value: T | null }[]> {
    return Promise.all(this.opts.index.getProjectIds(projectId).map(async (id) => {
      const files = this.files(id);
      return { files, value: await this.opts.storage.readJson<T>(file(files)) };
    }));
  }

  private async saved(projectId: string) {
    const saved = (await this.readAll<RepoWiki>(projectId, (f) => f.current)).flatMap(({ files, value }) => value ? [{ files, draft: value }] : []);
    return saved.sort((a, b) => b.draft.builtAt.localeCompare(a.draft.builtAt))[0];
  }

  private async history(projectId: string): Promise<RepoWikiHistoryEntry[]> {
    const entries = new Map<string, RepoWikiHistoryEntry>();
    for (const { value } of await this.readAll<RepoWikiHistoryEntry[]>(projectId, (f) => f.history)) {
      for (const entry of value ?? []) if (!entries.has(entry.revision)) entries.set(entry.revision, entry);
    }
    return [...entries.values()].sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  }

  private async layer(projectId: string, revision: string, level: ReaderLevel): Promise<TextLayer | null> {
    return (await this.readAll<TextLayer>(projectId, (f) => f.text(level))).map((r) => r.value).find((layer) => layer?.revision === revision && layer.promptVersion === REPO_TEXT_VERSION) ?? null;
  }

  private sessions(projectId: string, limit: number = MAX_SESSIONS) {
    return this.opts.index
      .getSessions(projectId)
      .slice()
      .sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? ''))
      .slice(0, limit);
  }

  gate(allowed: Allowed): Promise<TextGate> {
    return textGate({ store: this.opts.store, resolveProvider: () => this.opts.enrich.resolveProvider(), allowed });
  }

  /** 원본 자료에 이 수준의 AI 결과를 입힌다. 없으면 대기·실패 상태만 반환한다. */
  private compose(draft: RepoWiki, layer: TextLayer | null, gate: TextGate): { wiki: RepoWiki; canGenerate: boolean } {
    const fresh = layer && layer.revision === draft.revision && layer.promptVersion === REPO_TEXT_VERSION ? layer : null;
    if (fresh && !fresh.failed && fresh.user && fresh.system) {
      // 예전 레이어에는 같은 그림이 두 절에 들어 있을 수 있어 읽을 때 한 번만 남긴다
      return { wiki: { ...draft, user: dropRepeatedBlocks(fresh.user), system: dropRepeatedBlocks(fresh.system), features: fresh.features ?? [], warnings: [...draft.warnings, ...(fresh.warnings ?? [])], generator: fresh.generator }, canGenerate: false };
    }
    const reason = fresh?.failed ?? (gate.ok ? undefined : gate.reason);
    return { wiki: { ...draft, user: [], system: [], generator: { kind: reason ? 'unavailable' : 'pending', version: draft.generator.version, ...(reason ? { reason } : {}) } }, canGenerate: gate.ok && !fresh?.failed };
  }

  /**
   * 주요 기능 목록 (AI 를 부르지 않는다). files 를 요청하면 기능 분석이 읽을 수 있는 파일 목록도 돌려준다.
   * 목록만 볼 때는 큰 재료 파일(materials.json)을 읽지 않는다.
   */
  async catalog(projectId: string, level: ReaderLevel, opts: { files?: boolean } = {}): Promise<{ revision: string; features: RepoFeature[]; files: string[] } | null> {
    const saved = await this.saved(projectId);
    if (!saved || saved.draft.generator.version !== REPO_WIKI_VERSION) return null;
    const order = [level, ...READER_LEVELS.filter((x) => x !== level)];
    const [layers, materials] = await Promise.all([
      Promise.all(order.map((l) => this.readAll<TextLayer>(projectId, (f) => f.text(l)))),
      opts.files ? this.opts.storage.readJson<Materials>(saved.files.materials) : Promise.resolve(null),
    ]);
    // 기능의 id·파일·세션은 수준·문장 형식과 무관하다. 이 수준의 목록이 없으면 같은 판의 다른 수준 목록을 쓴다.
    const layer = layers.flat().map((r) => r.value).find((l) => l?.revision === saved.draft.revision && !l.failed && l.features?.length);
    return { revision: saved.draft.revision, features: layer?.features ?? [], files: materials?.revision === saved.draft.revision ? materials.files : [] };
  }

  /** 다시 생성할 때 같은 기능에 같은 id 를 쓰도록 지금까지 만든 기능 이름을 모은다 (모든 수준·판). */
  private async knownFeatures(projectId: string): Promise<{ id: string; name: string }[]> {
    const known = new Map<string, string>();
    for (const rows of await Promise.all(READER_LEVELS.map((level) => this.readAll<TextLayer>(projectId, (f) => f.text(level))))) {
      for (const { value } of rows) for (const f of value?.features ?? []) if (!known.has(f.id)) known.set(f.id, f.name);
    }
    return [...known].slice(0, 40).map(([id, name]) => ({ id, name }));
  }

  async get(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiResponse> {
    const saved = await this.saved(project.id);
    const draft = saved ? { ...saved.draft, projectId: project.id, rootPath: project.rootPath } : null;
    // 이력·문장 레이어 읽기(회원 모드에서는 Supabase 왕복)와 저장소 변경 확인을 동시에 한다
    const [history, light, layer] = await Promise.all([
      this.history(project.id),
      draft ? scanRepo(project.rootPath, { light: true }) : null,
      draft ? this.layer(project.id, draft.revision, level) : null,
    ]);
    if (!draft) return { wiki: null, stale: false, staleReasons: [], history };
    const reasons: string[] = [];
    if (draft.generator.version !== REPO_WIKI_VERSION) reasons.push('새 설명 형식(데이터베이스 표와 쓰는 기능 등)을 반영하려면 업데이트가 필요합니다');
    const known = new Map(draft.inputs.sessions.map((s) => [s.key, s]));
    const now = this.sessions(project.id);
    const added = now.filter((s) => !known.has(s.key));
    const changed = now.filter((s) => known.has(s.key) && known.get(s.key)!.mtime !== undefined && known.get(s.key)!.mtime !== s.fileMtime);
    if (added.length) reasons.push(`새 세션 ${added.length}개`);
    if (changed.length) reasons.push(`내용이 늘어난 세션 ${changed.length}개`);
    if (light?.readable === 'ok' && draft.inputs.repo.signature && light.signature !== draft.inputs.repo.signature) reasons.push('저장소 파일이 바뀜');
    const gate = draft.generator.version === REPO_WIKI_VERSION ? await this.gate(allowed) : { ok: false as const, reason: '이전 형식의 위키입니다. 업데이트한 뒤 AI 설명을 생성해 주세요.' };
    const { wiki, canGenerate } = this.compose(draft, layer, gate);
    return { wiki, stale: reasons.length > 0, staleReasons: reasons, history, text: { level, canGenerate: canGenerate && this.opts.store.get().llm.autoText } };
  }

  /**
   * AI 입력으로 사용할 원본 자료와 세션 요약을 수집한다.
   * 최근 세션(MAX_SESSIONS)은 요약을 만들고, 모든 세션은 규칙으로 '만들어진 것'을 모은다 (AI 호출 없음).
   * '만들어진 것'은 저장해 두고, 세션 파일(수정 시각·크기)이 그대로면 다시 읽지 않는다.
   */
  private async draft(project: Project): Promise<Draft> {
    const all = this.sessions(project.id, SESSION_MADE_LIMITS.sessions);
    const made = new Map<string, RepoSessionMade>();
    const [scan, sessionDigests, saved, cached] = await Promise.all([scanRepo(project.rootPath), mapConcurrent(all.slice(0, MAX_SESSIONS), 6, async (summary): Promise<RepoSessionDigest | null> => {
      const session = await this.opts.index.loadSession(summary.key);
      if (!session) return null;
      const [{ built }, snapshot, enrichment] = await Promise.all([
        this.opts.analysis.analyze(session), this.opts.wiki.current(project.id, summary.key), this.opts.enrich.getCached(session, 'any'),
      ]);
      made.set(summary.key, sessionMade(summary, built));
      const first = session.messages.find((m) => m.role === 'human' && m.text && !m.meta?.subagentId)?.text;
      return {
        key: summary.key,
        title: summary.title,
        ...((summary.endedAt ?? summary.startedAt) ? { at: summary.endedAt ?? summary.startedAt } : {}),
        mtime: summary.fileMtime,
        ...(first && ownWords(first) ? { request: truncate(ownWords(first), 120) } : {}),
        ...(enrichment ? { oneLiner: enrichment.data.summary.oneLiner } : {}),
        features: enrichment?.data.summary.features.map((x) => ({ name: x.name, detail: x.detail })) ?? [],
        built,
        findings: snapshot?.findings ?? [],
        securityReviewed: !!snapshot,
      };
    }), this.saved(project.id), this.opts.storage.readJson<SessionMadeCache>(this.files(project.id).made)]);
    const cache = cached?.version === SESSION_MADE_VERSION ? cached.sessions : {};
    // 요약을 만들지 않은 예전 세션은 저장해 둔 것을 쓰고, 바뀐 세션만 읽는다
    await mapConcurrent(all.slice(MAX_SESSIONS), 6, async (summary) => {
      const hit = cache[summary.key];
      if (hit && hit.mtime === summary.fileMtime && hit.size === summary.fileSize) { made.set(summary.key, hit.made); return; }
      const session = await this.opts.index.loadSession(summary.key);
      if (session) made.set(summary.key, sessionMade(summary, (await this.opts.analysis.analyze(session)).built));
    });
    const madeList = all.flatMap((s) => made.get(s.key) ?? []);
    const next: SessionMadeCache = { version: SESSION_MADE_VERSION, sessions: Object.fromEntries(all.flatMap((s) => {
      const m = made.get(s.key);
      return m ? [[s.key, { ...(s.fileMtime !== undefined ? { mtime: s.fileMtime } : {}), ...(s.fileSize !== undefined ? { size: s.fileSize } : {}), made: m }]] : [];
    })) };
    const changed = cached?.version !== SESSION_MADE_VERSION || JSON.stringify(next.sessions) !== JSON.stringify(cache);
    const digests = sessionDigests.filter((digest): digest is RepoSessionDigest => !!digest);
    const previous = saved?.draft ?? null;
    const draft = buildRepoWiki({ project: { id: project.id, name: project.name, rootPath: project.rootPath }, scan, sessions: digests, previous });
    return { scan, digests, draft, made: madeList, ...(changed ? { madeCache: next } : {}) };
  }

  /** 기본 AI 입력과 추가 파일 확인 범위를 보여 준다 (AI를 호출하지 않음). */
  async preview(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiAiPreview> {
    const { scan, digests, draft, made } = await this.draft(project);
    const prompt = buildRepoAiPrompt({ draft, scan, sessions: digests });
    // 주요 기능 질문은 본문보다 먼저 따로 보낸다. 미리 보기에서는 두 입력을 함께 보인다
    const featureUser = buildFeaturePickUser({ draft, scan, made, handles: prompt.handles });
    const user = `${prompt.user}\n\n=== (먼저 따로 보내는) 주요 기능 질문 ===\n${withReader(REPO_FEATURE_PICK_SYSTEM_PROMPT, level)}\n\n${featureUser}`;
    const system = withReader(REPO_AI_SYSTEM_PROMPT, level);
    const gate = await this.gate(allowed);
    const { status } = await this.opts.enrich.resolveProvider();
    return { llmStatus: status, ...(gate.ok ? {} : { fallbackReason: gate.reason }), chars: system.length + user.length, system, user, inspection: REPO_INSPECTION_LIMITS };
  }

  /** 새 판(사실 초안)을 만들어 저장한 뒤, 이 수준의 문장을 AI 로 쓴다 */
  async build(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiBuildResponse> {
    const active = this.jobs.findActive(RepoWikiService.jobKey(project.id, level));
    if (active) return { status: active.state === 'running' ? 'running' : 'queued', jobId: active.id };
    const gate = await this.gate(allowed);
    if (!gate.ok) throw Object.assign(new Error(gate.reason), { status: 409, code: 'llm_unavailable' });
    const job = this.jobs.enqueue(RepoWikiService.jobKey(project.id, level), async (signal) => {
      const end = beginActivity('reading', 'local');
      const prepared = await this.draft(project).finally(end);
      signal.throwIfAborted();
      const { scan, digests, draft, made, madeCache } = prepared;
      const { user, flowUser, dbUser, handles } = buildRepoAiPrompt({ draft, scan, sessions: digests });
      const featureUser = buildFeaturePickUser({ draft, scan, made, handles });
      const f = this.files(project.id);
      await this.opts.storage.lock(`repo:${project.id}`, async () => {
        signal.throwIfAborted();
        const history = (await this.history(project.id)).filter((h) => h.revision !== draft.revision);
        history.unshift({ revision: draft.revision, builtAt: draft.builtAt, changes: draft.changes, sessions: digests.length });
        await this.opts.storage.writeJsonBatch([
          { file: f.current, value: draft },
          { file: f.materials, value: { revision: draft.revision, user, flowUser, ...(dbUser ? { dbUser, dbImporters: scan.database?.importers ?? {} } : {}), featureUser, handles: [...handles.entries()], files: scan.files.map((x) => x.path) } satisfies Materials },
          { file: f.history, value: history.slice(0, MAX_HISTORY) },
          ...(madeCache ? [{ file: f.made, value: madeCache }] : []),
        ]);
      });
      return this.generateText(project, level, gate, false, signal);
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }

  /**
   * 지금 판의 문장을 AI가 쓴다. 생성할 수 없으면 오류를 반환한다.
   * 같은 입력(판·수준·제공자·모델)이면 다시 부르지 않는다. 실패한 입력도 force 없이는 다시 부르지 않는다.
   */
  async writeText(project: Project, level: ReaderLevel, allowed: Allowed, force: boolean): Promise<RepoWikiBuildResponse> {
    const key = RepoWikiService.jobKey(project.id, level);
    const active = this.jobs.findActive(key);
    if (active) return { status: active.state === 'running' ? 'running' : 'queued', jobId: active.id };
    const gate = await this.gate(allowed);
    if (!gate.ok) throw Object.assign(new Error(gate.reason), { status: 409, code: 'llm_unavailable' });
    if (!force) {
      const saved = await this.saved(project.id);
      const [materials, layer] = await Promise.all([
        saved ? this.opts.storage.readJson<Materials>(saved.files.materials) : null,
        saved ? this.layer(project.id, saved.draft.revision, level) : null,
      ]);
      const inputHash = materials ? textInputHash(materials, level, gate.provider.id, modelFor(gate.provider.id, this.opts.store.get().llm)) : null;
      if (!saved || !materials || materials.revision !== saved.draft.revision || (saved.draft.generator.version === REPO_WIKI_VERSION && layer?.inputHash === inputHash)) {
        return { status: 'done', response: await this.get(project, level, allowed) };
      }
    }
    // 새 판 수집·저장·AI 실행을 같은 작업으로 관찰할 수 있도록 준비도 큐 안에서 한다.
    const job = this.jobs.enqueue(key, (signal) => this.generateText(project, level, gate, force, signal));
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }

  private async generateText(project: Project, level: ReaderLevel, gate: Extract<TextGate, { ok: true }>, force: boolean, signal: AbortSignal): Promise<RepoJobResult> {
    const f = this.files(project.id);
    const saved = await this.saved(project.id);
    const draft = saved?.draft;
    const materials = saved ? await this.opts.storage.readJson<Materials>(saved.files.materials) : null;
    if (!draft || !materials || materials.revision !== draft.revision) return { revision: draft?.revision ?? '', level, generator: draft?.generator.kind ?? 'pending' };
    if (draft.generator.version !== REPO_WIKI_VERSION) throw Object.assign(new Error('이전 형식의 위키입니다. 먼저 업데이트해 주세요.'), { status: 409, code: 'wiki_stale' });

    const provider = gate.provider;
    const cfg = this.opts.store.get().llm;
    const system = withReader(REPO_AI_SYSTEM_PROMPT, level);
    const inputHash = textInputHash(materials, level, provider.id, modelFor(provider.id, cfg));
    const layer = await this.layer(project.id, draft.revision, level);
    if (!force && layer?.revision === draft.revision && layer.promptVersion === REPO_TEXT_VERSION && layer.inputHash === inputHash) return { revision: draft.revision, level, generator: layer.generator.kind };

    const known = await this.knownFeatures(project.id);
    signal.throwIfAborted();
    return withAiRun(this.opts.storage, { feature: 'repo_wiki', projectId: project.id, readerLevel: level }, signal, async (run) => {
      const base = { promptVersion: REPO_TEXT_VERSION, revision: draft.revision, level, inputHash, at: new Date().toISOString() };
      try {
        const inspection = await inspectRepo({ root: project.rootPath, draft, files: materials.files, provider, level, signal, trace: run.trace });
        const inspected = inspection.text ? `=== 추가 파일 확인 질문과 답변 (코드 발췌에 근거한 보조 설명) ===\n${inspection.text}` : '';
        const knownText = known.length ? `=== 기존 주요 기능 id (같은 기능이면 같은 id를 다시 쓰세요) ===\n${JSON.stringify(known)}` : '';
        // 보완 호출의 시간·요금은 마지막에 한 번 더한다 (apply 가 생성 정보를 첫 호출 기준으로 다시 만들기 때문)
        const extra = { durationMs: 0, costUsd: undefined as number | undefined };
        const add = (r: { durationMs: number; costUsd?: number }) => { extra.durationMs += r.durationMs; if (r.costUsd !== undefined) extra.costUsd = (extra.costUsd ?? 0) + r.costUsd; };
        const warnings: string[] = [];
        // 주요 기능은 본문보다 먼저 따로 묻는다: "이 프로젝트 자체의 주요 기능은 무엇이라고 생각하나요?"
        // (사용자가 하는 일 기준, 공통 기반은 따로). 실패하면 본문 작성에서 함께 고른다
        let pick: RepoFeaturePick | null = null;
        if (materials.featureUser) {
          const asked = await askRepoFeatures({ user: materials.featureUser, extra: [inspected, knownText].filter(Boolean).join('\n\n'), provider, level, timeoutMs: Math.max(cfg.timeoutMs, 180_000), signal, trace: run.trace });
          warnings.push(...asked.warnings);
          pick = asked.output;
          add(asked);
        }
        const user = [materials.user, inspected, pick ? pickedFeaturesText(pick) : knownText].filter(Boolean).join('\n\n');
        const res = await provider.complete({ system, user, schema: RepoAiOutputSchema, schemaName: 'repo_wiki_text', maxTokens: 32_000, timeoutMs: Math.max(cfg.timeoutMs, 300_000), signal, trace: run.trace });
        const { data, ...meta } = res;
        // 표 연결 질문에 보낸 발췌와 받은 답도 근거 검사에 함께 쓴다
        const linkSources: RepoSource[] = [];
        let dbAnswers: RepoDbAnswer[] = [];
        const apply = (output: RepoAiOutput) => applyRepoAi({ draft, output, handles: new Map(materials.handles), fileSet: new Set(materials.files), result: meta, additionalSources: [...inspection.sources, ...linkSources], dbAnswers });
        // 정해진 주요 기능이 있으면 본문 응답의 features 대신 그 목록을 쓴다 (검사는 applyRepoAi 가 같게 한다)
        let output: RepoAiOutput = pick ? { ...data, features: pick.features } : data;
        let wiki = apply(output);
        // 보낸 발췌 밖의 줄을 인용한 표시는 그 설명을 버리게 만든다. 확인하지 못한 표시만 모아
        // 서버가 실제로 보낸 표시 중에서 다시 고르게 한다 (고른 표시도 같은 검사를 거친다). 같은 표시는 두 번 묻지 않는다
        const askedRefs = new Set<string>();
        const fixRefs = async () => {
          const problems = unverifiedRepoRefs({ draft, output, handles: new Map(materials.handles), fileSet: new Set(materials.files), additionalSources: [...inspection.sources, ...linkSources], skip: askedRefs });
          if (!problems.length) return;
          for (const p of problems) askedRefs.add(p.ref);
          const fixed = await askRepoRefFixes({ problems, provider, signal, trace: run.trace });
          warnings.push(...fixed.warnings);
          if (fixed.fixes.size) { output = replaceRepoRefs(output, fixed.fixes); wiki = apply(output); }
          add(fixed);
        };
        await fixRefs();
        const missing = missingRepoFlowNodes(draft, wiki);
        if (missing.length) {
          // 통과한 노드·영역은 두고, 빠진 노드와 그 파일 발췌만 보내 묻는다
          const groups = [...wiki.user, ...wiki.system].some((s) => s.blocks.some((b) => b.kind === 'flow' && b.graph.groups?.length));
          const flowUser = materials.flowUser ? repoFlowRepairUser(materials.flowUser, wiki, missing) : materials.user;
          const flow = await provider.complete({ task: 'repo-inspect', system: withReader(REPO_FLOW_SYSTEM_PROMPT, level),
            user: `${flowUser}\n\n=== 추가 파일 확인 답변 ===\n${inspection.text || '없음'}`,
            schema: repoFlowOutputSchema(draft, { ids: missing, groups }), schemaName: 'repo_wiki_flow', maxTokens: 8000, timeoutMs: Math.max(cfg.timeoutMs, 90_000), signal, trace: run.trace });
          output = mergeRepoFlowRepair(output, flow.data, wiki);
          wiki = apply(output);
          add(flow);
          if (missingRepoFlowNodes(draft, wiki).length) await fixRefs();
        }
        assertRepoFlowComplete(draft, wiki);
        // 설명을 받지 못한 표는 표 자료만 다시 보내 설명을 받는다. 실패해도 표·컬럼 원문은 그대로 싣는다
        const db = incompleteRepoDbTables(draft, wiki);
        if (db.undescribed.length && materials.dbUser) {
          try {
            const features = (wiki.features ?? []).map((x) => ({ id: x.id, name: x.name, summary: x.summary }));
            const repair = await provider.complete({ system: withReader(REPO_DB_SYSTEM_PROMPT, level),
              user: `${materials.dbUser}\n\n=== 지금 주요 기능 (features의 id) ===\n${JSON.stringify(features)}\n\n=== 설명할 표 id ===\n${JSON.stringify(db.undescribed)}`,
              schema: RepoDbOutputSchema, schemaName: 'repo_wiki_database', maxTokens: 16_000, timeoutMs: Math.max(cfg.timeoutMs, 180_000), signal, trace: run.trace });
            output = mergeRepoDbRepair(output, repair.data, { undescribed: db.undescribed, unlinked: [] });
            wiki = apply(output);
            add(repair);
            if (incompleteRepoDbTables(draft, wiki).undescribed.length) await fixRefs();
          } catch (e) {
            if (signal.aborted || (e instanceof LlmError && e.kind === 'cancelled')) throw e;
            warnings.push(`데이터베이스 표 설명을 보완하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        // 코드에서 쓰는 곳이 있는데 어떤 주요 기능과도 이어지지 않은 표는 주요 기능을 잘못 고른 신호다.
        // 전체 자료를 다시 보내지 않고, 표마다 "이 표는 주요 기능 중 무엇과 관계가 있나요?"를 쓰는 줄 발췌와 함께 짧게 묻는다
        const unlinkedUsed = incompleteRepoDbTables(draft, wiki).unlinkedUsed;
        if (unlinkedUsed.length) {
          const links = await askDbFeatureLinks({ root: project.rootPath, draft, wiki, tableIds: unlinkedUsed, files: materials.files, importers: materials.dbImporters ?? {}, provider, level, signal, trace: run.trace, newFeatures: !pick });
          warnings.push(...links.warnings);
          if (links.output) {
            linkSources.push(...links.sources);
            dbAnswers = links.output.answers.map((a) => ({ table: a.table, answer: a.answer, sources: a.sources }));
            output = mergeRepoDbRepair(output, {
              databaseTables: links.output.answers.map((a) => ({ table: a.table, description: '', sources: [], columns: [], features: a.features })),
              newFeatures: links.output.newFeatures,
            }, { undescribed: [], unlinked: links.asked });
            wiki = apply(output);
            add(links);
          }
        }
        const unlinked = incompleteRepoDbTables(draft, wiki).unlinkedUsed;
        if (unlinked.length) warnings.push(`코드에서 쓰는 곳은 있지만 주요 기능과 연결하지 못한 데이터베이스 표 ${unlinked.length}개: ${unlinked.slice(0, 10).join(', ')}${unlinked.length > 10 ? ' 외' : ''}. 다시 쓰기를 누르면 기능을 다시 고릅니다.`);
        wiki.generator.durationMs = (wiki.generator.durationMs ?? 0) + extra.durationMs;
        if (extra.costUsd !== undefined) wiki.generator.costUsd = (wiki.generator.costUsd ?? 0) + extra.costUsd;
        wiki.warnings.push(...inspection.warnings, ...warnings);
        const next: TextLayer = { ...base, generator: { ...wiki.generator, inputHash }, user: wiki.user, system: wiki.system, features: wiki.features ?? [], warnings: wiki.warnings.slice(draft.warnings.length) };
        await this.opts.storage.writeJson(f.text(level), next);
        run.result(f.text(level), next);
        return { revision: draft.revision, level, generator: 'llm' };
      } catch (e) {
        if (signal.aborted || (e instanceof LlmError && e.kind === 'cancelled')) throw e;
        const reason = `AI 설명을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
        const failed = { ...base, generator: { kind: 'unavailable', version: draft.generator.version, reason }, failed: reason } satisfies TextLayer;
        await this.opts.storage.writeJson(f.text(level), failed);
        run.result(f.text(level), failed);
        throw e;
      }
    });
  }
}
