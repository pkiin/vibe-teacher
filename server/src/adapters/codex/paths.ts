import path from 'node:path';
import type { DefaultRootContext, RootCandidate } from '../types';

export function codexHome(ctx: DefaultRootContext): string {
  const override = ctx.isCurrent ? ctx.env.CODEX_HOME?.trim() : undefined;
  return override ? path.resolve(override) : path.join(ctx.home, '.codex');
}

export function codexDefaultRoots(ctx: DefaultRootContext): RootCandidate[] {
  const home = codexHome(ctx);
  return [{ path: home, label: 'Codex CLI 세션 기록' }];
}

/** 소스 경로가 `~/.codex` 이든 `~/.codex/sessions` 이든 세션 디렉터리 후보를 돌려준다 */
export function codexSessionDirs(sourcePath: string): string[] {
  const base = path.basename(sourcePath);
  if (base === 'sessions' || base === 'archived_sessions') return [sourcePath];
  return [path.join(sourcePath, 'sessions'), path.join(sourcePath, 'archived_sessions')];
}
