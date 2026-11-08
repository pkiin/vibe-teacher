import type { HelpMessage, MemoryRecord, MemorySearchResponse } from '@vibe-teacher/shared';
import path from 'node:path';
import type { LearnerService } from '../learner/service';
import { maskSecrets } from '../llm/digest';
import { truncate } from '../lib/text';
import { shortId } from '../lib/hash';
import type { WikiStorage } from '../storage/store';
import { eventMemory, searchMemories } from './search';
import { SupermemoryBackend, type MemoryBackend } from './supermemory';
import { Mem0Backend } from './mem0';
import { MemoryDatabaseError, memoryDatabaseSettings, memoryDatabaseError } from './database';
import { mapConcurrent } from '../lib/concurrent';
import { DEFAULT_OPENROUTER_MODEL } from '../llm/models';

export interface MemoryScope { projectId?: string; allowedProjectIds: string[] }
interface RemoteIndex { documents: Record<string, { id: string; fingerprint: string }>; notice?: string }

/**
 * events.jsonl·help.jsonl이 원본인 장기 기억. 기간 상한 없이 검색하고, 원격 결과도
 * 현재 권한으로 읽은 원기록과 대조한다. 외부에서 추출한 사용자 평가를 사실로 쓰지 않는다.
 */
export class MemoryService {
  private currentBackend?: MemoryBackend;
  private currentConfiguration?: string;
  private readonly openedBackends = new Set<MemoryBackend>();
  private configurationError?: string;
  private readonly configured: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly mode: string;
  private readonly running = new Map<string, Promise<void>>();
  private readonly queued = new Map<string, { learnerId: string; scope: MemoryScope }>();
  constructor(private readonly storage: WikiStorage, private readonly learner: LearnerService, private readonly opts: { backend?: MemoryBackend; env?: NodeJS.ProcessEnv; projectIds?: (id: string) => string[]; model?: () => string } = {}) {
    this.env = opts.env ?? process.env;
    this.mode = this.env.VIBE_TEACHER_MEMORY_BACKEND ?? 'mem0';
    this.configured = !!opts.backend || this.mode !== 'local';
    this.currentBackend = opts.backend ?? (this.mode === 'supermemory' && this.env.SUPERMEMORY_API_KEY ? new SupermemoryBackend(this.env.SUPERMEMORY_API_KEY) : undefined);
    this.projectIds = opts.projectIds ?? ((id) => [id]);
  }
  private readonly projectIds: (id: string) => string[];

  private get backend(): MemoryBackend | undefined {
    if (this.opts.backend || this.mode !== 'mem0') return this.currentBackend;
    const database = memoryDatabaseSettings(this.env);
    if (!this.env.OPENROUTER_API_KEY || !database) return undefined;
    const model = this.env.VIBE_TEACHER_MEMORY_MODEL || this.opts.model?.() || DEFAULT_OPENROUTER_MODEL;
    const configuration = shortId(JSON.stringify([model, database]), 20);
    if (this.currentConfiguration !== configuration) {
      try {
        this.currentBackend = new Mem0Backend(this.storage, { key: this.env.OPENROUTER_API_KEY, model, databaseUrl: database.url, databaseSource: database.source });
        this.openedBackends.add(this.currentBackend);
        this.configurationError = undefined;
      } catch (error) {
        this.configurationError = memoryDatabaseError(error);
        return undefined;
      }
      this.currentConfiguration = configuration;
    }
    return this.currentBackend;
  }

  private get missingConfiguration(): string {
    if (this.mode === 'mem0') {
      if (this.configurationError) return this.configurationError;
      if (!this.env.OPENROUTER_API_KEY) return 'OPENROUTER_API_KEY가 없어 로컬 키워드 검색을 사용합니다. 키 설정 후 mem0 의미 검색을 사용할 수 있습니다.';
      return 'VIBE_TEACHER_SUPABASE_DATABASE_URL 또는 VIBE_TEACHER_MEMORY_DATABASE_URL을 설정해 주세요. 현재는 로컬 키워드 검색을 사용합니다.';
    }
    if (this.mode === 'supermemory') return 'SUPERMEMORY_API_KEY가 없어 로컬 키워드 검색을 사용합니다.';
    return 'VIBE_TEACHER_MEMORY_BACKEND 설정을 확인해 주세요 (mem0, local, supermemory).';
  }

  private namespace(learnerId: string): string {
    return `vt-${learnerId}`;
  }
  private indexFile(learnerId: string, backend?: MemoryBackend): string {
    return path.join(this.storage.learnerDir(learnerId), 'memory', `${backend?.indexKey ?? this.namespace(learnerId)}.json`);
  }
  private async index(learnerId: string, backend?: MemoryBackend): Promise<RemoteIndex> {
    return (await this.storage.readJson<RemoteIndex>(this.indexFile(learnerId, backend))) ?? { documents: {} };
  }

  async records(learnerId: string, scope: MemoryScope): Promise<MemoryRecord[]> {
    const allowed = new Set(scope.allowedProjectIds.flatMap((id) => this.projectIds(id)));
    const projects = scope.projectId ? this.projectIds(scope.projectId).filter((id) => allowed.has(id)) : [...allowed];
    const selected = new Set(projects);
    const remembered = await this.learner.concepts(learnerId);
    const names = new Map(Object.values(remembered).map(({ concept }) => [concept.id, concept.name]));
    const records = (await this.learner.events(learnerId)).filter((e) => !e.projectId || selected.has(e.projectId))
      .map((e) => eventMemory(e, names)).filter((r): r is MemoryRecord => !!r);
    const messages = new Map<string, { message: HelpMessage; projectId: string }>();
    // 이전 프로젝트 별칭보다 대표 폴더의 최신 답변을 우선한다 (HelpService와 같은 순서).
    const ledgers = await mapConcurrent([...projects].reverse(), 6, async (projectId) => {
      const file = path.join(this.storage.learnerProjectDir(learnerId, projectId), 'help.jsonl');
      return { projectId, ledger: await this.storage.readJsonl<HelpMessage>(file) };
    });
    for (const { projectId, ledger } of ledgers) {
      for (const message of ledger.items) messages.set(message.id, { message, projectId });
    }
    for (const { message: m, projectId } of messages.values()) {
      const conceptIds = [...new Set([...(m.focus.kind === 'concept' && m.focus.id ? [m.focus.id] : []), ...(m.answer?.conceptIds ?? [])])];
      records.push({ id: m.id, sourceId: m.id, kind: 'question', at: m.askedAt, projectId, sessionKey: m.sessionKey, conceptIds,
        text: truncate(maskSecrets(`사용자의 질문: ${m.question}${m.status === 'done' && m.answer ? `\n당시 AI 답변 (현재 프로젝트 사실의 근거로 쓰지 않음): ${m.answer.answer}` : ''}`), 1800) });
    }
    return records.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  }

  async search(learnerId: string, scope: MemoryScope, input: { query: string; conceptIds?: string[]; sessionKey?: string; limit?: number; remote?: boolean; excludeId?: string }): Promise<MemorySearchResponse> {
    const all = (await this.records(learnerId, scope)).filter((r) => r.id !== input.excludeId);
    const backend = this.backend;
    const local = searchMemories(all, input);
    const configuredBackend = backend?.kind ?? (this.mode === 'mem0' || this.mode === 'supermemory' ? this.mode : 'local');
    const result: MemorySearchResponse = { records: local, total: all.length, backend: 'local', configuredBackend, databaseProvider: backend?.databaseProvider, notices: [], canSync: !!backend };
    if (this.configured && !backend) result.notices.push(this.missingConfiguration);
    if (backend) {
      const index = await this.index(learnerId, backend);
      const pending = all.filter((r) => index.documents[r.id]?.fingerprint !== shortId(r.text, 20)).length;
      if (pending) result.notices.push(`의미 검색에 아직 반영되지 않은 기록 ${pending}개는 로컬 키워드 검색으로 보완합니다. 기억 인덱스를 업데이트할 수 있습니다.`);
      if (index.notice) result.notices.push(index.notice);
    }
    if (!input.remote || !this.configured) return result;
    if (!backend || !all.length) return result;
    try {
      const index = await this.index(learnerId, backend);
      const ids = await backend.search(this.namespace(learnerId), maskSecrets(input.query).slice(0, 2000) || input.conceptIds?.join(' ') || '최근 학습 활동', input.limit ?? 6, all);
      const byId = new Map(all.map((r) => [r.id, r]));
      const remoteToLocal = new Map(Object.entries(index.documents).filter(([id, doc]) => {
        const record = byId.get(id);
        return record && doc.fingerprint === shortId(record.text, 20);
      }).map(([id, doc]) => [doc.id, id]));
      const remote = ids.flatMap((id) => { const r = byId.get(remoteToLocal.get(id) ?? ''); return r ? [r] : []; });
      result.records = [...new Map([...remote, ...local].map((r) => [r.id, r])).values()].slice(0, input.limit ?? 6);
      result.backend = backend.kind ?? 'supermemory';
    } catch (error) {
      const reason = error instanceof MemoryDatabaseError || (error as { code?: string })?.code ? memoryDatabaseError(error) : 'OpenRouter 연결·키·잔액과 PostgreSQL 연결·pgvector 확장을 확인해 주세요.';
      result.notices.push(`의미 검색에 실패해 로컬 기록에서 검색했습니다. ${reason}`);
    }
    if (!input.excludeId) this.scheduleSync(learnerId, scope);
    return result;
  }

  /** POST 활동 후 mem0 색인을 갱신한다. 연속 클릭은 합치며 원장 저장·채점 응답을 기다리게 하지 않는다. */
  scheduleSync(learnerId: string, scope: MemoryScope): void {
    if (this.backend?.kind !== 'mem0') return;
    const key = JSON.stringify([learnerId, scope.projectId, [...scope.allowedProjectIds].sort()]);
    this.queued.set(key, { learnerId, scope });
    if (this.running.has(key)) return;
    const task = Promise.resolve().then(async () => {
      while (this.queued.has(key)) {
        const next = this.queued.get(key)!;
        this.queued.delete(key);
        await this.sync(next.learnerId, next.scope, { limit: 2, newestFirst: true });
      }
    }).catch(() => { /* sync가 실패 사유를 저장한다. 원장 응답에 영향을 주지 않는다. */ }).finally(() => { this.running.delete(key); });
    this.running.set(key, task);
  }

  /** 종료·검사 때 진행 중인 색인만 기다린다. GET에서는 호출하지 않는다. */
  async idle(): Promise<void> { await Promise.all(this.running.values()); }

  async close(): Promise<void> {
    await this.idle();
    for (const backend of this.openedBackends) await backend.close?.();
  }

  /** 명시적 POST 또는 권한을 확인한 POST 활동에서만 호출한다. */
  async sync(learnerId: string, scope: MemoryScope, options: { limit?: number; newestFirst?: boolean } = {}): Promise<{ indexed: number; remaining: number; notices: string[] }> {
    const backend = this.backend;
    if (!backend) return { indexed: 0, remaining: 0, notices: [this.configured ? this.missingConfiguration : '로컬 키워드 검색은 별도 인덱스가 필요하지 않습니다.'] };
    return this.storage.lock(`memory-sync:${learnerId}`, async () => {
      const all = await this.records(learnerId, scope), index = await this.index(learnerId, backend);
      const pending = all.filter((r) => index.documents[r.id]?.fingerprint !== shortId(r.text, 20));
      let indexed = 0;
      const notices: string[] = [];
      const selected = options.newestFirst ? [...pending].reverse() : pending;
      for (const record of selected.slice(0, options.limit ?? 10)) {
        try {
          const id = await backend.add(this.namespace(learnerId), record);
          index.documents[record.id] = { id, fingerprint: shortId(record.text, 20) };
          await this.storage.writeJson(this.indexFile(learnerId, backend), index);
          indexed++;
        } catch (error) {
          const reason = error instanceof MemoryDatabaseError || (error as { code?: string })?.code ? memoryDatabaseError(error) : 'OpenRouter 연결·키·잔액과 PostgreSQL 연결·pgvector 확장을 확인해 주세요.';
          notices.push(`기억 인덱스 갱신에 실패했습니다. ${reason} 원기록과 로컬 검색은 유지됩니다.`);
          break;
        }
      }
      index.notice = notices[0];
      await this.storage.writeJson(this.indexFile(learnerId, backend), index);
      return { indexed, remaining: pending.length - indexed, notices };
    });
  }
}
