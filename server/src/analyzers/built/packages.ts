import type { Evidence, NormalizedSession, PackageFact, PackageManager, ToolCall } from '@vibe-teacher/shared';
import { truncate } from '../../lib/text';
import type { ClassifiedCommand } from './commands';

function stripVersion(name: string): string {
  let n = name.trim().replace(/^["']|["']$/g, '');
  if (!n || n.startsWith('-')) return '';
  if (n.startsWith('@')) {
    const i = n.indexOf('@', 1);
    return i > 0 ? n.slice(0, i) : n;
  }
  n = n.replace(/\[.*\]$/, '');
  return n.split(/[@=<>~^!]/)[0] ?? n;
}

function isOpt(a: string): boolean {
  return a.startsWith('-');
}

export function packagesFromCommand(c: ClassifiedCommand, tc: ToolCall): PackageFact[] {
  if (c.category !== 'install') return [];
  const argv = c.argv;
  const head = argv[0] ?? '';
  const sub = argv[1] ?? '';
  const args = argv.slice(2);
  const evidence: Evidence = { toolCallId: tc.id, messageIndex: tc.messageIndex, snippet: truncate(c.cmd.raw || tc.command || '', 160) };
  const out: PackageFact[] = [];
  const push = (manager: PackageManager, name: string, dev?: boolean) => {
    const n = stripVersion(name);
    if (!n) return;
    out.push({ manager, name: n, dev, evidence: [evidence] });
  };

  if (head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun') {
    const manager = head as PackageManager;
    if (!['install', 'i', 'add', 'ci'].includes(sub)) return [];
    const dev = args.some((a) => a === '-D' || a === '--save-dev' || a === '--dev' || a === '-d');
    const names = args.filter((a) => !isOpt(a));
    if (!names.length) {
      out.push({ manager, name: '(package.json 의존성 전체)', evidence: [evidence] });
      return out;
    }
    for (const n of names) push(manager, n, dev);
    return out;
  }
  if (head === 'pip' || head === 'pip3' || (head === 'python' || head === 'python3') && sub === '-m' && argv[2] === 'pip') {
    const a = head.startsWith('python') ? argv.slice(4) : args;
    const verb = head.startsWith('python') ? argv[3] : sub;
    if (verb !== 'install') return [];
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i] ?? '';
      if (x === '-r' || x === '--requirement') {
        out.push({ manager: 'pip', name: `(${a[i + 1] ?? 'requirements.txt'})`, evidence: [evidence] });
        i += 1;
      } else if (x === '-e') {
        i += 1;
      } else if (!isOpt(x)) push('pip', x);
    }
    return out;
  }
  if (head === 'uv') {
    if (sub === 'add') for (const n of args.filter((a) => !isOpt(a))) push('uv', n, args.includes('--dev'));
    else if (sub === 'pip' && argv[2] === 'install') for (const n of argv.slice(3).filter((a) => !isOpt(a))) push('uv', n);
    else if (sub === 'sync') out.push({ manager: 'uv', name: '(pyproject 의존성 전체)', evidence: [evidence] });
    return out;
  }
  if (head === 'poetry' && sub === 'add') {
    for (const n of args.filter((a) => !isOpt(a))) push('poetry', n, args.includes('--group') || args.includes('-D'));
    return out;
  }
  if (head === 'cargo' && sub === 'add') {
    for (const n of args.filter((a) => !isOpt(a))) push('cargo', n);
    return out;
  }
  if (head === 'go' && sub === 'get') {
    for (const n of args.filter((a) => !isOpt(a))) push('go', n);
    return out;
  }
  if (head === 'gem' && sub === 'install') {
    for (const n of args.filter((a) => !isOpt(a))) push('gem', n);
    return out;
  }
  if (head === 'brew' && sub === 'install') {
    for (const n of args.filter((a) => !isOpt(a))) push('brew', n);
    return out;
  }
  if ((head === 'apt' || head === 'apt-get') && sub === 'install') {
    for (const n of args.filter((a) => !isOpt(a))) push('apt', n);
    return out;
  }
  return out;
}

/** Write 로 만든 package.json 의 의존성도 근거로 쓴다 */
export function packagesFromWrittenPackageJson(session: NormalizedSession): PackageFact[] {
  const out: PackageFact[] = [];
  for (const tc of session.toolCalls) {
    if (tc.category !== 'file_write') continue;
    const target = tc.paths[0] ?? '';
    if (!/(^|\/)package\.json$/.test(target)) continue;
    const input = tc.input as { content?: unknown } | undefined;
    const content = input && typeof input.content === 'string' ? input.content : '';
    if (!content) continue;
    let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;
    try {
      json = JSON.parse(content);
    } catch {
      json = null;
    }
    if (!json) continue;
    const evidence: Evidence = { toolCallId: tc.id, messageIndex: tc.messageIndex, snippet: 'package.json 작성' };
    for (const name of Object.keys(json.dependencies ?? {})) out.push({ manager: 'npm', name, evidence: [evidence] });
    for (const name of Object.keys(json.devDependencies ?? {})) out.push({ manager: 'npm', name, dev: true, evidence: [evidence] });
  }
  return out;
}

export function dedupePackages(list: PackageFact[]): PackageFact[] {
  const map = new Map<string, PackageFact>();
  for (const p of list) {
    const k = `${p.manager}:${p.name}`;
    const cur = map.get(k);
    if (cur) {
      if (cur.evidence.length < 5) cur.evidence.push(...p.evidence);
      if (p.dev) cur.dev = true;
    } else map.set(k, { ...p, evidence: p.evidence.slice() });
  }
  return Array.from(map.values()).sort((a, b) => a.manager.localeCompare(b.manager) || a.name.localeCompare(b.name));
}
