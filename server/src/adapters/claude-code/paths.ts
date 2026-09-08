import path from 'node:path';
import type { DefaultRootContext, RootCandidate } from '../types';

export function claudeConfigRoot(ctx: DefaultRootContext): string {
  const override = ctx.isCurrent ? ctx.env.CLAUDE_CONFIG_DIR?.trim() : undefined;
  return override ? path.resolve(override) : path.join(ctx.home, '.claude');
}

export function claudeDefaultRoots(ctx: DefaultRootContext): RootCandidate[] {
  const root = claudeConfigRoot(ctx);
  return [{ path: path.join(root, 'projects'), label: 'Claude Code 세션 기록' }];
}

/** `~/.claude/projects` 경로에서 `~/.claude` 를 구한다 (커스텀 경로도 같은 규칙) */
export function configRootFromProjectsDir(projectsDir: string): string {
  return path.basename(projectsDir) === 'projects' ? path.dirname(projectsDir) : projectsDir;
}

/** cwd → 디렉터리명 인코딩 (손실: '/' 와 '-' 가 모두 '-') */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-');
}

/**
 * 디렉터리명을 cwd 로 복원. ~/.claude.json 의 projects 키(실제 경로)를 먼저 대조하고
 * 없으면 단순 디코딩('-' → '/')을 돌려준다. 두 번째 값은 확실한지 여부.
 */
export function decodeProjectDir(dirName: string, knownCwds: string[]): { cwd: string; certain: boolean } {
  for (const known of knownCwds) {
    if (encodeCwd(known) === dirName) return { cwd: known, certain: true };
  }
  const guess = dirName.startsWith('-') ? '/' + dirName.slice(1).replace(/-/g, '/') : dirName.replace(/-/g, '/');
  return { cwd: guess, certain: false };
}
