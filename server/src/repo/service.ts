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
import { REPO_AI_SYSTEM_PROMPT, RepoAiOutputSchema, applyRepoAi, buildRepoAiPrompt } from './ai';
import { scanRepo, type RepoScan } from './scan';
import { buildRepoWiki, type RepoSessionDigest } from './wiki';

const MAX_SESSIONS = 60;
const MAX_HISTORY = 30;

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
  handles: [string, string][];
  files: string[];
}

/** 읽는 사람 수준별 AI 문장 */
interface TextLayer {
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
 *   wiki/projects/<projectId>/repo/current.json        사실 초안 (규칙, 모든 수준이 함께 씀)
 *   wiki/projects/<projectId>/repo/history.json        판마다 달라진 점
 *   wiki/projects/<projectId>/repo/materials.json      AI 에 보낼 재료 (지금 판)
 *   wiki/projects/<projectId>/repo/text/<수준>.json     읽는 사람 수준별 AI 문장
 * 사실(명령·파일·API·변경)은 코드가 모으고, 사람이 읽는 문장은 AI 가 읽는 사람 수준에 맞춰 쓴다.
 * AI 를 쓸 수 없을 때(설정에서 끔, 권한 없음, 제공자 없음, 호출 실패)만 규칙 문장을 보여 주고 사유를 남긴다.
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

  /** 사실 초안에 이 수준의 AI 문장을 입힌다. 없으면 규칙 문장과 사유 */
  private compose(draft: RepoWiki, layer: TextLayer | null, gate: TextGate): { wiki: RepoWiki; canGenerate: boolean } {
    const fresh = layer && layer.revision === draft.revision ? layer : null;
    if (fresh && !fresh.failed && fresh.user && fresh.system) {
      return { wiki: { ...draft, user: fresh.user, system: fresh.system, warnings: [...draft.warnings, ...(fresh.warnings ?? [])], generator: fresh.generator }, canGenerate: false };
    }
    const reason = fresh?.failed ?? (gate.ok ? undefined : gate.reason);
    return { wiki: { ...draft, generator: { kind: 'rule', version: draft.generator.version, ...(reason ? { reason } : {}) } }, canGenerate: gate.ok && !fresh?.failed };
  }

  async get(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiResponse> {
    const f = this.files(project.id);
    const draft = await this.opts.storage.readJson<RepoWiki>(f.current);
    const history = (await this.opts.storage.readJson<RepoWikiHistoryEntry[]>(f.history)) ?? [];
    if (!draft) return { wiki: null, stale: false, staleReasons: [], history };
    const reasons: string[] = [];
    const known = new Map(draft.inputs.sessions.map((s) => [s.key, s]));
    const now = this.sessions(project.id);
    const added = now.filter((s) => !known.has(s.key));
    const changed = now.filter((s) => known.has(s.key) && known.get(s.key)!.mtime !== undefined && known.get(s.key)!.mtime !== s.fileMtime);
    if (added.length) reasons.push(`새 세션 ${added.length}개`);
    if (changed.length) reasons.push(`내용이 늘어난 세션 ${changed.length}개`);
    const light = await scanRepo(project.rootPath, { light: true });
    if (light.readable === 'ok' && draft.inputs.repo.signature && light.signature !== draft.inputs.repo.signature) reasons.push('저장소 파일이 바뀜');
    const layer = await this.opts.storage.readJson<TextLayer>(f.text(level));
    const { wiki, canGenerate } = this.compose(draft, layer, await this.gate(allowed));
    return { wiki, stale: reasons.length > 0, staleReasons: reasons, history, text: { level, canGenerate } };
  }

  /** 사실 초안 (규칙 기반). AI 의 재료이자, AI 를 쓸 수 없을 때 보여 주는 문장 */
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
      });
    }
    const previous = await this.opts.storage.readJson<RepoWiki>(this.files(project.id).current);
    const draft = buildRepoWiki({ project: { id: project.id, name: project.name, rootPath: project.rootPath }, scan, sessions: digests, previous });
    return { scan, digests, draft };
  }

  /** AI 에 보낼 내용을 그대로 보여 준다 (보내지는 않음) */
  async preview(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiAiPreview> {
    const { scan, digests, draft } = await this.draft(project);
    const { user } = buildRepoAiPrompt({ draft, scan, sessions: digests });
    const system = withReader(REPO_AI_SYSTEM_PROMPT, level);
    const gate = await this.gate(allowed);
    const { status } = await this.opts.enrich.resolveProvider();
    return { llmStatus: status, ...(gate.ok ? {} : { fallbackReason: gate.reason }), chars: system.length + user.length, system, user };
  }

  /** 새 판(사실 초안)을 만들어 저장한 뒤, 이 수준의 문장을 AI 로 쓴다 */
  async build(project: Project, level: ReaderLevel, allowed: Allowed): Promise<RepoWikiBuildResponse> {
    const active = this.jobs.findActive(RepoWikiService.jobKey(project.id, level));
    if (active) return { status: active.state === 'running' ? 'running' : 'queued', jobId: active.id };
    const { scan, digests, draft } = await this.draft(project);
    const { user, handles } = buildRepoAiPrompt({ draft, scan, sessions: digests });
    const f = this.files(project.id);
    await this.opts.storage.lock(`repo:${project.id}`, async () => {
      await this.opts.storage.writeJson(f.current, draft);
      await this.opts.storage.writeJson(f.materials, { revision: draft.revision, user, handles: [...handles.entries()], files: scan.files.map((x) => x.path) } satisfies Materials);
      const history = ((await this.opts.storage.readJson<RepoWikiHistoryEntry[]>(f.history)) ?? []).filter((h) => h.revision !== draft.revision);
      history.unshift({ revision: draft.revision, builtAt: draft.builtAt, changes: draft.changes, sessions: digests.length });
      await this.opts.storage.writeJson(f.history, history.slice(0, MAX_HISTORY));
    });
    return this.writeText(project, level, allowed, false);
  }

  /**
   * 지금 판의 문장을 이 수준으로 AI 가 쓴다. 쓸 수 없으면 규칙 문장인 채로 바로 돌려준다.
   * 같은 입력(판·수준·제공자·모델)이면 다시 부르지 않는다. 실패한 입력도 force 없이는 다시 부르지 않는다.
   */
  async writeText(project: Project, level: ReaderLevel, allowed: Allowed, force: boolean): Promise<RepoWikiBuildResponse> {
    const done = async (): Promise<RepoWikiBuildResponse> => ({ status: 'done', response: await this.get(project, level, allowed) });
    const key = RepoWikiService.jobKey(project.id, level);
    const active = this.jobs.findActive(key);
    if (active) return { status: active.state === 'running' ? 'running' : 'queued', jobId: active.id };
    const gate = await this.gate(allowed);
    if (!gate.ok) return done();
    const f = this.files(project.id);
    const draft = await this.opts.storage.readJson<RepoWiki>(f.current);
    const materials = await this.opts.storage.readJson<Materials>(f.materials);
    if (!draft || !materials || materials.revision !== draft.revision) return done();

    const provider = gate.provider;
    const cfg = this.opts.store.get().llm;
    const system = withReader(REPO_AI_SYSTEM_PROMPT, level);
    const inputHash = shortId(`${system}|${materials.user}|${provider.id}|${modelFor(provider.id, cfg) ?? ''}`, 16);
    const layer = await this.opts.storage.readJson<TextLayer>(f.text(level));
    if (!force && layer?.revision === draft.revision && layer.inputHash === inputHash) return done();

    const job = this.jobs.enqueue(key, async (signal) => {
      const base = { revision: draft.revision, level, inputHash, at: new Date().toISOString() };
      try {
        const res = await provider.complete({ system, user: materials.user, schema: RepoAiOutputSchema, schemaName: 'repo_wiki_text', maxTokens: 32_000, timeoutMs: Math.max(cfg.timeoutMs, 300_000), signal });
        const { data, ...meta } = res;
        const wiki = applyRepoAi({ draft, output: data, handles: new Map(materials.handles), fileSet: new Set(materials.files), result: meta });
        const next: TextLayer = { ...base, generator: { ...wiki.generator, inputHash }, user: wiki.user, system: wiki.system, warnings: wiki.warnings.slice(draft.warnings.length) };
        await this.opts.storage.writeJson(f.text(level), next);
        return { revision: draft.revision, level, generator: 'llm' };
      } catch (e) {
        if (signal.aborted || (e instanceof LlmError && e.kind === 'cancelled')) throw e;
        const reason = `AI 호출이 실패해 규칙 기반 문장을 보여 줍니다: ${e instanceof Error ? e.message : String(e)}`;
        await this.opts.storage.writeJson(f.text(level), { ...base, generator: { kind: 'rule', version: draft.generator.version, reason }, failed: reason } satisfies TextLayer);
        return { revision: draft.revision, level, generator: 'rule', reason };
      }
    });
    return { status: job.state === 'running' ? 'running' : 'queued', jobId: job.id };
  }
}
