import path from 'node:path';
import type { DefaultRootContext, RootCandidate } from '../types';

export function copilotHome(ctx: DefaultRootContext): string {
  const override = ctx.isCurrent ? ctx.env.COPILOT_HOME?.trim() : undefined;
  return override ? path.resolve(override) : path.join(ctx.home, '.copilot');
}

export function copilotCliDefaultRoots(ctx: DefaultRootContext): RootCandidate[] {
  return [{ path: copilotHome(ctx), label: 'GitHub Copilot CLI 세션 기록' }];
}

export function copilotSessionDirs(sourcePath: string): string[] {
  const base = path.basename(sourcePath);
  if (base === 'session-state' || base === 'history-session-state') return [sourcePath];
  return [path.join(sourcePath, 'session-state'), path.join(sourcePath, 'history-session-state')];
}
