import os from 'node:os';
import path from 'node:path';
import type {
  Account,
  NormalizedSession,
  Project,
  Provider,
  RescanResponse,
  SessionSummary,
  Source,
  SourceStatus,
} from '@vibe-teacher/shared';
import type { HistoryAdapter, SessionDraft, SessionFileInfo } from '../adapters/types';
import type { ConfigStore } from '../config/store';
import { isInside, normalizePath, pathExists, realpathSafe, safeStat } from '../lib/fsx';
import { decodeKey, encodeKey, shortId } from '../lib/hash';
import { OTHER_ACCOUNT_ID, discoverAccounts, otherAccount } from './accounts';
import { loadIndexCache, saveIndexCache, type IndexCacheEntry } from './cache';
import { normalizeRoot, projectIdFor, projectNameFor } from './project-id';

export interface SessionIndexOptions {
  adapters: HistoryAdapter[];
  store: ConfigStore;
  cacheDir: string;
  /** 이 디렉터리 아래 프로젝트는 숨김 (앱 자신의 LLM 실행 cwd 등) */
  hiddenRoot: string;
  currentHome?: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export function sourceIdFor(provider: Provider, p: string): string {
  return shortId(`source:${provider}\0${normalizePath(p)}`);
}

export function sessionKeyFor(provider: Provider, filePath: string): string {
  return encodeKey([provider, filePath]);
}

export function parseSessionKey(key: string): { provider: Provider; filePath: string } | null {
  const parts = decodeKey(key);
  if (!parts || parts.length !== 2) return null;
  const [provider, filePath] = parts;
  if (!provider || !filePath) return null;
  return { provider: provider as Provider, filePath };
}

interface LoadedEntry {
  mtimeMs: number;
  size: number;
  session: NormalizedSession;
}

export class SessionIndex {
  private accounts = new Map<string, Account>();
  private sources = new Map<string, SourceStatus>();
  private sessions = new Map<string, SessionSummary>();
  private projects = new Map<string, Project>();
  private loaded = new Map<string, LoadedEntry>();
  private lastRescanAt = 0;
  private rescanning: Promise<RescanResponse> | null = null;
  private readonly currentHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: SessionIndexOptions) {
    this.currentHome = opts.currentHome ?? os.homedir();
    this.env = opts.env ?? process.env;
    this.log = opts.log ?? (() => {});
  }

  get lastRescan(): number {
    return this.lastRescanAt;
  }

  async ensureFresh(maxAgeMs = 30_000): Promise<void> {
    if (Date.now() - this.lastRescanAt > maxAgeMs) await this.rescan();
  }

  rescan(): Promise<RescanResponse> {
    if (!this.rescanning) {
      this.rescanning = this.doRescan().finally(() => {
        this.rescanning = null;
      });
    }
    return this.rescanning;
  }

  private adapterFor(provider: Provider): HistoryAdapter | undefined {
    return this.opts.adapters.find((a) => a.provider === provider);
  }

  private async doRescan(): Promise<RescanResponse> {
    const started = Date.now();
    const cfg = this.opts.store.get();
    const accounts = await discoverAccounts(cfg.scan, this.currentHome);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    // 1) 소스 후보 만들기 (계정별 기본 경로 + 커스텀)
    const candidates: Source[] = [];
    for (const account of accounts) {
      if (account.readable !== 'ok') continue;
      for (const adapter of this.opts.adapters) {
        for (const root of adapter.defaultRoots({
          home: account.homePath,
          env: this.env,
          isCurrent: account.isCurrent,
          platform: process.platform,
        })) {
          const id = sourceIdFor(adapter.provider, root.path);
          candidates.push({
            id,
            accountId: account.id,
            provider: adapter.provider,
            path: normalizePath(root.path),
            label: root.label,
            kind: 'default',
            enabled: !cfg.disabledDefaultSourceIds.includes(id),
          });
        }
      }
    }
    for (const custom of cfg.sources) {
      const p = normalizePath(custom.path);
      let accountId = custom.accountId;
      if (!accountId || !accountMap.has(accountId)) {
        const owner = accounts.find((a) => a.homePath && isInside(a.homePath, p));
        accountId = owner?.id ?? OTHER_ACCOUNT_ID;
      }
      if (accountId === OTHER_ACCOUNT_ID && !accountMap.has(OTHER_ACCOUNT_ID)) accountMap.set(OTHER_ACCOUNT_ID, otherAccount());
      candidates.push({
        id: custom.id,
        accountId,
        provider: custom.provider,
        path: p,
        label: custom.label || path.basename(p),
        kind: 'custom',
        enabled: custom.enabled,
      });
    }

    // 2) realpath 기준 중복 제거 (기본 경로 우선)
    const seen = new Map<string, Source>();
    for (const c of candidates) {
      const real = `${c.provider}\0${await realpathSafe(c.path)}`;
      const prev = seen.get(real);
      if (!prev || (prev.kind === 'custom' && c.kind === 'default')) seen.set(real, c);
    }

    // 3) probe + scan
    const nextSources = new Map<string, SourceStatus>();
    const nextSessions = new Map<string, SessionSummary>();
    for (const source of seen.values()) {
      const adapter = this.adapterFor(source.provider);
      if (!adapter) continue;
      const account = accountMap.get(source.accountId) ?? otherAccount();
      let status: SourceStatus;
      try {
        status = { ...source, ...(await adapter.probe(source)) };
      } catch (err) {
        status = { ...source, exists: false, readable: 'missing', sessionCount: 0, note: `조회 실패: ${(err as Error).message}` };
      }
      if (status.readable === 'denied') status.note = '권한 없음 (읽기 권한이 필요합니다)';
      else if (!status.exists) status.note = '없음';
      else if (status.sessionCount === 0 && !status.note) status.note = '디렉터리는 있지만 세션이 없습니다';
      nextSources.set(source.id, status);

      if (!source.enabled || !status.exists || status.readable !== 'ok') continue;
      try {
        const summaries = await this.scanSource(adapter, source, account);
        for (const s of summaries) nextSessions.set(s.key, s);
      } catch (err) {
        status.note = `스캔 실패: ${(err as Error).message}`;
        this.log(`[index] scan failed for ${source.path}: ${(err as Error).message}`);
      }
    }

    // 4) 프로젝트 집계
    const nextProjects = new Map<string, Project>();
    for (const s of nextSessions.values()) {
      let p = nextProjects.get(s.projectId);
      if (!p) {
        p = {
          id: s.projectId,
          accountId: s.accountId,
          rootPath: normalizeRoot(s.projectRoot),
          name: projectNameFor(s.projectRoot),
          exists: false,
          providers: [],
          sessionCount: 0,
        };
        nextProjects.set(p.id, p);
      }
      p.sessionCount += 1;
      if (!p.providers.includes(s.provider)) p.providers.push(s.provider);
      const at = s.endedAt ?? s.startedAt;
      if (at && (!p.lastActivityAt || at > p.lastActivityAt)) p.lastActivityAt = at;
    }
    for (const p of nextProjects.values()) {
      p.exists = p.rootPath !== '(unknown)' && (await pathExists(p.rootPath));
    }

    // 5) 계정 집계
    for (const a of accountMap.values()) {
      a.sourceCount = 0;
      a.sessionCount = 0;
      a.projectCount = 0;
      a.lastActivityAt = undefined;
    }
    for (const st of nextSources.values()) {
      const a = accountMap.get(st.accountId);
      if (a && st.exists) a.sourceCount += 1;
    }
    for (const p of nextProjects.values()) {
      const a = accountMap.get(p.accountId);
      if (!a) continue;
      a.projectCount += 1;
      a.sessionCount += p.sessionCount;
      if (p.lastActivityAt && (!a.lastActivityAt || p.lastActivityAt > a.lastActivityAt)) a.lastActivityAt = p.lastActivityAt;
    }

    this.accounts = accountMap;
    this.sources = nextSources;
    this.sessions = nextSessions;
    this.projects = nextProjects;
    this.lastRescanAt = Date.now();
    return {
      accounts: accountMap.size,
      sources: nextSources.size,
      projects: nextProjects.size,
      sessions: nextSessions.size,
      durationMs: Date.now() - started,
    };
  }

  private finalize(draft: SessionDraft, source: Source): SessionSummary {
    const root = normalizeRoot(draft.projectRoot);
    return {
      ...draft,
      key: sessionKeyFor(source.provider, draft.filePath),
      provider: source.provider,
      sourceId: source.id,
      accountId: source.accountId,
      projectId: projectIdFor(source.accountId, root),
      projectRoot: root,
    };
  }

  private async scanSource(adapter: HistoryAdapter, source: Source, account: Account): Promise<SessionSummary[]> {
    const cache = await loadIndexCache(this.opts.cacheDir, source.id);
    const nextCache: Record<string, IndexCacheEntry> = {};
    const out: SessionSummary[] = [];
    let extra: unknown;
    if (adapter.prepare) {
      try {
        extra = await adapter.prepare(source, account);
      } catch (err) {
        this.log(`[index] prepare failed for ${source.path}: ${(err as Error).message}`);
      }
    }
    for await (const file of adapter.listSessionFiles(source)) {
      const cached = cache[file.filePath];
      let summary: SessionSummary;
      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs && cached.summary?.key) {
        summary = cached.summary;
      } else {
        try {
          const draft = await adapter.scan(file, source, { account, extra });
          summary = this.finalize(draft, source);
        } catch (err) {
          this.log(`[index] scan error ${file.filePath}: ${(err as Error).message}`);
          continue;
        }
      }
      if (this.isHidden(summary)) continue;
      nextCache[file.filePath] = { size: file.size, mtimeMs: file.mtimeMs, summary };
      out.push(summary);
    }
    try {
      await saveIndexCache(this.opts.cacheDir, source.id, nextCache);
    } catch (err) {
      this.log(`[index] cache write failed: ${(err as Error).message}`);
    }
    return out;
  }

  private isHidden(summary: SessionSummary): boolean {
    return !!this.opts.hiddenRoot && summary.projectRoot !== '(unknown)' && isInside(this.opts.hiddenRoot, summary.projectRoot);
  }

  // ---- 조회 ----

  getAccounts(): Account[] {
    return Array.from(this.accounts.values());
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  getSources(accountId?: string): SourceStatus[] {
    const all = Array.from(this.sources.values());
    return accountId ? all.filter((s) => s.accountId === accountId) : all;
  }

  getSource(id: string): SourceStatus | undefined {
    return this.sources.get(id);
  }

  getProjects(accountId?: string): Project[] {
    const all = Array.from(this.projects.values()).filter((p) => !accountId || p.accountId === accountId);
    return all.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  getSessions(projectId: string): SessionSummary[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }

  getSummary(key: string): SessionSummary | undefined {
    return this.sessions.get(key);
  }

  /** 세션 key 가 활성화된 소스 안의 파일을 가리키는지 검증 */
  resolveKey(key: string): { summary: SessionSummary; source: SourceStatus; adapter: HistoryAdapter } | null {
    const parsed = parseSessionKey(key);
    if (!parsed) return null;
    const summary = this.sessions.get(key);
    if (!summary) return null;
    const source = this.sources.get(summary.sourceId);
    if (!source || !source.enabled || !isInside(source.path, summary.filePath)) return null;
    const adapter = this.adapterFor(summary.provider);
    if (!adapter) return null;
    return { summary, source, adapter };
  }

  async loadSession(key: string): Promise<NormalizedSession | null> {
    const resolved = this.resolveKey(key);
    if (!resolved) return null;
    const { summary, source, adapter } = resolved;
    const st = await safeStat(summary.filePath);
    if (!st) return null;
    const cached = this.loaded.get(key);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      this.loaded.delete(key);
      this.loaded.set(key, cached);
      return cached.session;
    }
    const account = this.accounts.get(source.accountId) ?? otherAccount();
    let extra: unknown;
    if (adapter.prepare) {
      try {
        extra = await adapter.prepare(source, account);
      } catch {
        extra = undefined;
      }
    }
    const file: SessionFileInfo = { filePath: summary.filePath, size: st.size, mtimeMs: st.mtimeMs };
    const draft = await adapter.load(file, source, { account, extra });
    const session: NormalizedSession = { ...this.finalize(draft, source), messages: draft.messages, toolCalls: draft.toolCalls, parseWarnings: draft.parseWarnings };
    this.loaded.set(key, { mtimeMs: st.mtimeMs, size: st.size, session });
    while (this.loaded.size > 8) {
      const oldest = this.loaded.keys().next().value;
      if (oldest === undefined) break;
      this.loaded.delete(oldest);
    }
    return session;
  }
}
