import type { BuiltSummary, FileFact, SessionSummary } from '@vibe-teacher/shared';
import { maskSecrets } from '../llm/digest';
import { truncate } from '../lib/text';
import { ownWords } from '../learner/knowledge';

/**
 * 세션마다 규칙으로 모은 '만들어진 것' 요약 (AI 호출 없음).
 * 레포 위키를 만들 때 프로젝트의 모든 세션에서 모아 저장하고, 주요 기능을 고르는 질문의 참고 자료로 쓴다.
 * 내 요청은 붙여 넣은 글·자동 문맥을 뺀 본인 말(ownWords)만, 에이전트 보고는 앞부분만 싣고 모두 마스킹한다.
 * 파일은 세션 작업 폴더 안의 상대 경로만 싣는다 (저장소 밖 경로·홈 경로는 싣지 않음).
 */
export const SESSION_MADE_VERSION = 1;
export const SESSION_MADE_LIMITS = { sessions: 400, turns: 6, request: 160, report: 240, files: 30, commits: 8, packages: 10, promptChars: 24_000, hotFiles: 40 } as const;

export interface RepoSessionMade {
  key: string;
  title: string;
  at?: string;
  /** 요청과 그 요청 뒤 에이전트 보고의 앞부분 (처음 2개와 마지막 몇 개) */
  turns: { request: string; report?: string }[];
  /** 만들거나 고친 파일 (많이 손댄 순) */
  files: string[];
  deleted: string[];
  commits: string[];
  packages: string[];
}

/** 저장 형식: 세션 파일이 그대로면(mtime·크기) 다시 읽지 않는다 */
export interface SessionMadeCache {
  version: number;
  sessions: Record<string, { mtime?: number; size?: number; made: RepoSessionMade }>;
}

const rel = (f: FileFact) => (f.relPath && !f.relPath.startsWith('..') && !f.relPath.startsWith('/') ? f.relPath : undefined);
const oneLine = (s: string, max: number) => truncate(maskSecrets(s.replace(/\s+/g, ' ').trim()), max);

export function sessionMade(summary: Pick<SessionSummary, 'key' | 'title' | 'startedAt' | 'endedAt'>, built: BuiltSummary): RepoSessionMade {
  const turns = built.timeline
    .map((t) => ({ request: oneLine(ownWords(t.promptText ?? ''), SESSION_MADE_LIMITS.request), ...(t.finalAssistantText ? { report: oneLine(t.finalAssistantText, SESSION_MADE_LIMITS.report) } : {}) }))
    .filter((t) => t.request);
  const keep = SESSION_MADE_LIMITS.turns;
  const picked = turns.length <= keep ? turns : [...turns.slice(0, 2), ...turns.slice(-(keep - 2))];
  const touched = [...built.filesCreated, ...built.filesModified].sort((a, b) => b.count - a.count);
  const files = [...new Set(touched.flatMap((f) => rel(f) ?? []))].slice(0, SESSION_MADE_LIMITS.files);
  const at = summary.endedAt ?? summary.startedAt;
  return {
    key: summary.key, title: oneLine(summary.title, 120), ...(at ? { at } : {}),
    turns: picked, files,
    deleted: [...new Set(built.filesDeleted.flatMap((f) => rel(f) ?? []))].slice(0, 10),
    commits: built.gitCommits.flatMap((c) => (c.message ? [oneLine(c.message.split('\n')[0] ?? '', 120)] : [])).slice(0, SESSION_MADE_LIMITS.commits),
    packages: [...new Set(built.packagesInstalled.map((p) => p.name))].slice(0, SESSION_MADE_LIMITS.packages),
  };
}

/**
 * 주요 기능 질문에 넣을 글. 여러 세션에서 손댄 파일을 먼저 모아 보이고, 최근 세션부터 글자 수 상한까지 싣는다.
 * handles: 세션 key → S1… (레포 위키 본문 근거와 같은 표시). 표시가 없는 세션은 제목만 쓴다.
 */
export function sessionMadeText(list: RepoSessionMade[], handles: Map<string, string>): string {
  if (!list.length) return '';
  const counts = new Map<string, number>();
  for (const s of list) for (const f of s.files) counts.set(f, (counts.get(f) ?? 0) + 1);
  const hot = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, SESSION_MADE_LIMITS.hotFiles);
  const out: string[] = [];
  if (hot.length) out.push(`여러 세션에서 만들고 고친 파일: ${hot.map(([f, n]) => `${f}(${n})`).join(', ')}`);
  let used = out.join('\n').length, skipped = 0;
  for (const s of list) {
    const lines = [`${handles.get(s.key) ?? '(세션)'} · ${s.title}${s.at ? ` · ${s.at.slice(0, 10)}` : ''}`];
    for (const t of s.turns) lines.push(`  요청: ${t.request}${t.report ? `\n  → 에이전트 보고: ${t.report}` : ''}`);
    if (s.files.length) lines.push(`  만들고 고친 파일: ${s.files.join(', ')}`);
    if (s.deleted.length) lines.push(`  지운 파일: ${s.deleted.join(', ')}`);
    if (s.commits.length) lines.push(`  커밋: ${s.commits.join(' / ')}`);
    if (s.packages.length) lines.push(`  설치한 패키지: ${s.packages.join(', ')}`);
    const text = lines.join('\n');
    if (used + text.length > SESSION_MADE_LIMITS.promptChars) { skipped++; continue; }
    out.push(text);
    used += text.length + 1;
  }
  if (skipped) out.push(`(글자 수 상한으로 세션 ${skipped}개는 생략)`);
  return out.join('\n');
}
