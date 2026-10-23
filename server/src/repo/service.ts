import path from 'node:path';
import type { Project, ReaderLevel, RepoSection, RepoWiki, RepoWikiAiPreview, RepoWikiBuildResponse, RepoWikiHistoryEntry, RepoWikiResponse } from '@vibe-teacher/shared';
import type { AnalysisService } from '../analyzers/index';
import type { ConfigStore } from '../config/store';
import type { SessionIndex } from '../index/session-index';
import { textGate, type TextGate } from '../llm/gate';
import { JobQueue } from '../llm/jobs';
import { withReader } from '../llm/reader';
import { modelFor } from '../llm/select';
import type { EnrichService } from '../llm/service';
import { LlmError } from '../llm/types';
import type { WikiStorage } from '../storage/store';
import type { WikiService } from '../wiki/service';
import { ownWords } from '../learner/knowledge';
import { shortId } from '../lib/hash';
import { truncate } from '../lib/text';
import { REPO_AI_SYSTEM_PROMPT, REPO_FLOW_SYSTEM_PROMPT, RepoAiOutputSchema, applyRepoAi, assertRepoFlowComplete, buildRepoAiPrompt, dropRepeatedBlocks, missingRepoFlowNodes, repoFlowOutputSchema, type RepoAiOutput } from './ai';
import { scanRepo, type RepoScan } from './scan';
import { buildRepoWiki, REPO_WIKI_VERSION, type RepoSessionDigest } from './wiki';
import { inspectRepo, REPO_INSPECTION_LIMITS } from './inspect';

const MAX_SESSIONS = 60;
const MAX_HISTORY = 30;
const REPO_TEXT_VERSION = 7;

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
  /** AI 결과에서 생긴 경고 (사실 초안의 경고는 따로) */
  warnings?: string[];
  /** 호출이 실패한 사유. 같은 입력으로는 자동으로 다시 부르지 않는다 ("다시 쓰기"로만) */
  failed?: string;
}

interface Draft {
  scan: RepoScan;
  digests: RepoSessionDigest[];
  draft: RepoWiki;
}

/**
 * 레포 위키 저장·갱신:
 *   wiki/projects/<projectId>/repo/current.json        원본 자료 (모든 수준이 함께 씀)
 *   wiki/projects/<projectId>/repo/history.json        판마다 달라진 점
 *   wiki/projects/<projectId>/repo/materials.json      AI 에 보낼 재료 (지금 판)
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
      text: (level: ReaderLevel) => path.join(dir, 'text', `${level}.json`),
    };
  }

  private async saved(projectId: string) {
    const saved = [];
    for (const id of this.opts.index.getProjectIds(projectId)) {
      const files = this.files(id);
      const draft = await this.opts.storage.readJson<RepoWiki>(files.current);
      if (draft) saved.push({ files, draft });
    }
    return saved.sort((a, b) => b.draft.builtAt.localeCompare(a.draft.builtAt))[0];
  }

  private async history(projectId: string): Promise<RepoWikiHistoryEntry[]> {
    const entries = new Map<string, RepoWikiHistoryEntry>();
    for (const id of this.opts.index.getProjectIds(projectId)) {
      for (const entry of (await this.opts.storage.readJson<RepoWikiHistoryEntry[]>(this.files(id).history)) ?? []) {
        if (!entries.has(entry.revision)) entries.set(entry.revision, entry);
      }
    }
    return [...entries.values()].sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  }

  private async layer(projectId: string, revision: string, level: ReaderLevel): Promise<TextLayer | null> {
    for (const id of this.opts.index.getProjectIds(projectId)) {
      const layer = await this.opts.storage.readJson<TextLayer>(this.files(id).text(level));
      if (layer?.revision === revision && layer.promptVersion === REPO_TEXT_VERSION) return layer;
    }
    return null;
  }

  private sessions(projectId: string) {
    return this.opts.index
      .getSessions(projectId)
      .slice()
      .sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? ''))
      .slice(0, MAX_SESSIONS);
  }

  gate(allowed: Allowed): Promise<TextGate> {
    return textGate({ store: this.opts.store, resolveProvider: () => this.opts.enrich.resolveProvider(), allowed });
  }

  /** 원본 자료에 이 수준의 AI 결과를 입힌다. 없으면 대기·실패 상태만 반환한다. */
  private compose(draft: RepoWiki, layer: TextLayer | null, gate: TextGate): { wiki: RepoWiki; canGenerate: boolean } {
    const fresh = layer && layer.revision === draft.revision && layer.promptVersion === REPO_TEXT_VERSION ? layer : null;
    if (fresh && !fresh.failed && fresh.user && fresh.system) {
      // 예전 레이어에는 같은 그림이 두 절에 들어 있을 수 있어 읽을 때 한 번만 남긴다
      return { wiki: { ...draft, user: dropRepeatedBlocks(fresh.user), system: dropRepeatedBlocks(fresh.system), warnings: [...draft.warnings, ...(fresh.warnings ?? [])], generator: fresh.generator }, canGenerate: false };
    }
    const reason = fresh?.failed ?? (gate.ok ? undefined : gate.reason);
    return { wiki: { ...draft, user: [], system: [], generator: { kind: reason ? 'unavailable' : 'pending', version: draft.generator.version, ...(reason ? { reason } : {}) } }, canGenerate: gate.ok && !fresh?.failed };
  }

  async get(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiResponse> {
    const saved = await this.saved(project.id);
    const draft = saved ? { ...saved.draft, projectId: project.id, rootPath: project.rootPath } : null;
    const history = await this.history(project.id);
    if (!draft) return { wiki: null, stale: false, staleReasons: [], history };
    const reasons: string[] = [];
    if (draft.generator.version !== REPO_WIKI_VERSION) reasons.push('새 설명 형식과 보안 점검을 반영하려면 업데이트가 필요합니다');
    const known = new Map(draft.inputs.sessions.map((s) => [s.key, s]));
    const now = this.sessions(project.id);
    const added = now.filter((s) => !known.has(s.key));
    const changed = now.filter((s) => known.has(s.key) && known.get(s.key)!.mtime !== undefined && known.get(s.key)!.mtime !== s.fileMtime);
    if (added.length) reasons.push(`새 세션 ${added.length}개`);
    if (changed.length) reasons.push(`내용이 늘어난 세션 ${changed.length}개`);
    const light = await scanRepo(project.rootPath, { light: true });
    if (light.readable === 'ok' && draft.inputs.repo.signature && light.signature !== draft.inputs.repo.signature) reasons.push('저장소 파일이 바뀜');
    const layer = await this.layer(project.id, draft.revision, level);
    const gate = draft.generator.version === REPO_WIKI_VERSION ? await this.gate(allowed) : { ok: false as const, reason: '이전 형식의 위키입니다. 업데이트한 뒤 AI 설명을 생성해 주세요.' };
    const { wiki, canGenerate } = this.compose(draft, layer, gate);
    return { wiki, stale: reasons.length > 0, staleReasons: reasons, history, text: { level, canGenerate: canGenerate && this.opts.store.get().llm.autoText } };
  }

  /** AI 입력으로 사용할 원본 자료와 세션 요약을 수집한다. */
  private async draft(project: Project): Promise<Draft> {
    const scan = await scanRepo(project.rootPath);
    const digests: RepoSessionDigest[] = [];
    for (const summary of this.sessions(project.id)) {
      const session = await this.opts.index.loadSession(summary.key);
      if (!session) continue;
      const { built } = await this.opts.analysis.analyze(session);
      const snapshot = await this.opts.wiki.current(project.id, summary.key);
      const enrichment = await this.opts.enrich.getCached(session, 'any');
      const first = session.messages.find((m) => m.role === 'human' && m.text && !m.meta?.subagentId)?.text;
      digests.push({
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
      });
    }
    const previous = (await this.saved(project.id))?.draft ?? null;
    const draft = buildRepoWiki({ project: { id: project.id, name: project.name, rootPath: project.rootPath }, scan, sessions: digests, previous });
    return { scan, digests, draft };
  }

  /** 기본 AI 입력과 추가 파일 확인 범위를 보여 준다 (AI를 호출하지 않음). */
  async preview(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiAiPreview> {
    const { scan, digests, draft } = await this.draft(project);
    const { user } = buildRepoAiPrompt({ draft, scan, sessions: digests });
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
    const { scan, digests, draft } = await this.draft(project);
    const { user, flowUser, handles } = buildRepoAiPrompt({ draft, scan, sessions: digests });
    const f = this.files(project.id);
    await this.opts.storage.lock(`repo:${project.id}`, async () => {
      await this.opts.storage.writeJson(f.current, draft);
      await this.opts.storage.writeJson(f.materials, { revision: draft.revision, user, flowUser, handles: [...handles.entries()], files: scan.files.map((x) => x.path) } satisfies Materials);
      const history = (await this.history(project.id)).filter((h) => h.revision !== draft.revision);
      history.unshift({ revision: draft.revision, builtAt: draft.builtAt, changes: draft.changes, sessions: digests.length });
      await this.opts.storage.writeJson(f.history, history.slice(0, MAX_HISTORY));
    });
    return this.writeText(project, level, allowed, false);
  }

  /**
   * 지금 판의 문장을 AI가 쓴다. 생성할 수 없으면 오류를 반환한다.
   * 같은 입력(판·수준·제공자·모델)이면 다시 부르지 않는다. 실패한 입력도 force 없이는 다시 부르지 않는다.
   */
  async writeText(project: Project, level: ReaderLevel, allowed: Allowed, force: boolean): Promise<RepoWikiBuildResponse> {
    const done = async (): Promise<RepoWikiBuildResponse> => ({ status: 'done', response: await this.get(project, level, allowed) });
    const key = RepoWikiService.jobKey(project.id, level);
    const active = this.jobs.findActive(key);
    if (active) return { status: active.state === 'running' ? 'running' : 'queued', jobId: active.id };
    const gate = await this.gate(allowed);
    if (!gate.ok) throw Object.assign(new Error(gate.reason), { status: 409, code: 'llm_unavailable' });
    const f = this.files(project.id);
    const saved = await this.saved(project.id);
    const draft = saved?.draft;
    const materials = saved ? await this.opts.storage.readJson<Materials>(saved.files.materials) : null;
    if (!draft || !materials || materials.revision !== draft.revision) return done();
    if (draft.generator.version !== REPO_WIKI_VERSION) throw Object.assign(new Error('이전 형식의 위키입니다. 먼저 업데이트해 주세요.'), { status: 409, code: 'wiki_stale' });

    const provider = gate.provider;
    const cfg = this.opts.store.get().llm;
    const system = withReader(REPO_AI_SYSTEM_PROMPT, level);
    const inputHash = shortId(`${system}|${materials.user}|${provider.id}|${modelFor(provider.id, cfg) ?? ''}`, 16);
    const layer = await this.layer(project.id, draft.revision, level);
    if (!force && layer?.revision === draft.revision && layer.promptVersion === REPO_TEXT_VERSION && layer.inputHash === inputHash) return done();

    const job = this.jobs.enqueue(key, async (signal) => {
      const base = { promptVersion: REPO_TEXT_VERSION, revision: draft.revision, level, inputHash, at: new Date().toISOString() };
      try {
        const inspection = await inspectRepo({ root: project.rootPath, draft, files: materials.files, provider, level, signal });
        const user = inspection.text ? `${materials.user}\n\n=== 추가 파일 확인 질문과 답변 (코드 발췌에 근거한 보조 설명) ===\n${inspection.text}` : materials.user;
        const res = await provider.complete({ system, user, schema: RepoAiOutputSchema, schemaName: 'repo_wiki_text', maxTokens: 32_000, timeoutMs: Math.max(cfg.timeoutMs, 300_000), signal });
        const { data, ...meta } = res;
        const apply = (output: RepoAiOutput) => applyRepoAi({ draft, output, handles: new Map(materials.handles), fileSet: new Set(materials.files), result: meta, additionalSources: inspection.sources });
        let wiki = apply(data);
        if (missingRepoFlowNodes(draft, wiki).length) {
          const flow = await provider.complete({ task: 'repo-inspect', system: withReader(REPO_FLOW_SYSTEM_PROMPT, level),
            user: `${materials.flowUser ?? materials.user}\n\n=== 추가 파일 확인 답변 ===\n${inspection.text || '없음'}`,
            schema: repoFlowOutputSchema(draft), schemaName: 'repo_wiki_flow', maxTokens: 8000, timeoutMs: Math.max(cfg.timeoutMs, 90_000), signal });
          wiki = apply({ ...data, ...flow.data });
          wiki.generator.durationMs = (wiki.generator.durationMs ?? 0) + flow.durationMs;
          if (flow.costUsd !== undefined) wiki.generator.costUsd = (wiki.generator.costUsd ?? 0) + flow.costUsd;
        }
        assertRepoFlowComplete(draft, wiki);
        wiki.warnings.push(...inspection.warnings);
        const next: TextLayer = { ...base, generator: { ...wiki.generator, inputHash }, user: wiki.user, system: wiki.system, warnings: wiki.warnings.slice(draft.warnings.length) };
        await this.opts.storage.writeJson(f.text(level), next);
        return { revision: draft.revision, level, generator: 'llm' };
      } catch (e) {
        if (signal.aborted || (e instanceof LlmError && e.kind === 'cancelled')) throw e;
        const reason = `AI 설명을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
        await this.opts.storage.writeJson(f.text(level), { ...base, generator: { kind: 'unavailable', version: draft.generator.version, reason }, failed: reason } satisfies TextLayer);
        throw e;
      }
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}
