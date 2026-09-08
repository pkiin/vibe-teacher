import path from 'node:path';
import type { DefaultRootContext, RootCandidate } from '../types';

const APPS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];

/** VS Code 계열 앱의 workspaceStorage 후보 (플랫폼별) */
export function copilotVscodeDefaultRoots(ctx: DefaultRootContext): RootCandidate[] {
  const out: RootCandidate[] = [];
  const add = (p: string, label: string) => out.push({ path: p, label });
  if (ctx.platform === 'darwin') {
    for (const app of APPS) add(path.join(ctx.home, 'Library', 'Application Support', app, 'User', 'workspaceStorage'), `${app} Copilot Chat`);
  } else if (ctx.platform === 'win32') {
    const appData = ctx.isCurrent && ctx.env.APPDATA ? ctx.env.APPDATA : path.join(ctx.home, 'AppData', 'Roaming');
    for (const app of APPS) add(path.join(appData, app, 'User', 'workspaceStorage'), `${app} Copilot Chat`);
  } else {
    const xdg = ctx.isCurrent && ctx.env.XDG_CONFIG_HOME ? ctx.env.XDG_CONFIG_HOME : path.join(ctx.home, '.config');
    for (const app of APPS) add(path.join(xdg, app, 'User', 'workspaceStorage'), `${app} Copilot Chat`);
  }
  add(path.join(ctx.home, '.vscode-server', 'data', 'User', 'workspaceStorage'), 'VS Code Server Copilot Chat');
  return out;
}
