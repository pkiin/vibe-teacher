import type { BuiltSummary, RepoFacts, RepoSection, RepoSource, RepoWiki, RiskFinding } from '@vibe-teacher/shared';
import { shortId } from '../lib/hash';
import { codeFlow } from './code';
import type { RepoScan } from './scan';

export const REPO_WIKI_VERSION = 'repo-ai-3';
export interface RepoSessionDigest {
  key: string; title: string; at?: string; mtime?: number; request?: string; oneLiner?: string;
  features: { name: string; detail: string }[]; built: BuiltSummary; findings: RiskFinding[]; securityReviewed?: boolean;
}

/** AI 입력용 자료만 조립한다. 폴더 역할·기술 설명·위험 목록을 규칙으로 추정하지 않는다. */
export function buildRepoWiki(input: { project: { id: string; name: string; rootPath: string }; scan: RepoScan; sessions: RepoSessionDigest[]; previous?: RepoWiki | null; now?: Date }): RepoWiki {
  const { project, scan, sessions } = input;
  const system: RepoSection[] = [];
  for (const p of scan.packages) system.push({
    id: `scripts-${shortId(p.path, 8)}`, title: p.path,
    blocks: [{ kind: 'table', head: ['스크립트', '명령'], rows: Object.entries(p.scripts) }], sources: [{ kind: 'file', path: p.path }], origin: 'source',
  });
  if (scan.routes.length) system.push({ id: 'api', title: '코드에 적힌 경로', blocks: [{ kind: 'table', head: ['방식', '경로', '동작 설명', '파일'], rows: scan.routes.map((r) => [r.method, r.path, '', r.file]) }],
    sources: scan.routes.map((r): RepoSource => ({ kind: 'file', path: r.file, ...(r.line ? { startLine: r.line, endLine: r.endLine ?? r.line } : {}), ...(r.hash ? { hash: r.hash } : {}) })), origin: 'source' });
  if (scan.code?.length) {
    const graph = codeFlow(scan.code, scan.entries ?? []);
    graph.limited ||= !!scan.codeLimited;
    system.push({ id: 'mechanism', title: '코드 연결', blocks: [{ kind: 'flow', graph }], sources: scan.code.flatMap((c) => c.excerpts.map((e) => e.source)), origin: 'source' });
  }
  const facts: RepoFacts = {
    sessions: sessions.map((s) => s.key), features: sessions.flatMap((s) => s.features.map((f) => f.name)),
    scripts: scan.packages.flatMap((p) => Object.entries(p.scripts).map(([k, v]) => `${p.path}:${k}=${v}`)), routes: scan.routes.map((r) => `${r.method} ${r.path}`),
    dirs: [...new Set(scan.files.map((f) => f.path.split('/')[0]!))], deps: [...new Set(scan.packages.flatMap((p) => [...p.dependencies, ...p.devDependencies]))],
    findings: sessions.flatMap((s) => s.findings.map((f) => f.id)),
  };
  const revision = `r_${shortId(`${REPO_WIKI_VERSION}|${scan.signature}|${JSON.stringify(facts)}|${sessions.map((s) => s.mtime).join(',')}`, 16)}`;
  return {
    schemaVersion: 1, projectId: project.id, projectName: project.name, rootPath: project.rootPath, revision, builtAt: (input.now ?? new Date()).toISOString(),
    generator: { kind: 'pending', version: REPO_WIKI_VERSION },
    inputs: { sessions: sessions.map((s) => ({ key: s.key, title: s.title, ...(s.at ? { at: s.at } : {}), ...(s.mtime !== undefined ? { mtime: s.mtime } : {}) })),
      repo: { readable: scan.readable, fileCount: scan.files.length, truncated: scan.truncated, head: scan.head, branch: scan.branch, signature: scan.signature } },
    user: [], system, previousFacts: input.previous?.facts, changes: [], warnings: scan.truncated ? ['저장소 파일 일부만 읽었습니다.'] : [], facts,
  };
}
