import path from 'node:path';
import type { Evidence, FileFact, NormalizedSession, ToolCall } from '@vibe-teacher/shared';
import { effectiveArgv, splitCommands, type SimpleCommand } from '../../lib/shell';
import { truncate } from '../../lib/text';

export type FileAction = 'create' | 'update' | 'delete';

export interface FileEvent {
  action: FileAction;
  path: string;
  via: FileFact['via'];
  evidence: Evidence;
  order: number;
}

const IGNORED_PATH_RE = /(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|dist|build|\.next|\.cache)(\/|$)|^\/dev\/|^\/proc\/|^\/tmp\//;

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.py': 'Python',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.env': '환경 변수',
  '.txt': '텍스트',
  '.csv': 'CSV',
  '.svg': 'SVG',
  '.png': '이미지',
  '.jpg': '이미지',
};

export function languageFor(p: string): string | undefined {
  const base = path.basename(p);
  if (base === 'Dockerfile') return 'Docker';
  if (/^\.env(\..*)?$/.test(base)) return '환경 변수';
  if (base === 'package.json') return 'npm 설정';
  if (base === 'tsconfig.json') return 'TypeScript 설정';
  return LANGUAGE_BY_EXT[path.extname(base).toLowerCase()];
}

export function resolveFilePath(p: string, cwd: string | undefined, projectRoot: string, home?: string): string | null {
  if (!p) return null;
  let s = p.trim().replace(/^["']|["']$/g, '');
  if (!s || s.startsWith('-') || s.startsWith('$') || s.includes('*') || s.includes('{')) return null;
  if (s === '~' || s.startsWith('~/')) {
    if (!home) return null;
    s = path.join(home, s.slice(1));
  }
  const base = cwd ?? (projectRoot && projectRoot !== '(unknown)' ? projectRoot : undefined);
  if (!path.isAbsolute(s)) {
    if (!base) return null;
    s = path.resolve(base, s);
  }
  s = path.normalize(s);
  if (IGNORED_PATH_RE.test(s)) return null;
  return s;
}

function ev(tc: ToolCall, snippet: string): Evidence {
  return { toolCallId: tc.id, messageIndex: tc.messageIndex, snippet: truncate(snippet, 160) };
}

const WRITE_CMDS = new Set(['cat', 'echo', 'printf', 'tee', 'curl', 'wget', 'python', 'python3', 'node', 'jq', 'sed', 'awk', 'head', 'tail', 'sort', 'base64', 'openssl']);

/** 셸 단순 명령 하나에서 파일 이벤트를 뽑는다. */
export function fileEventsFromCommand(cmd: SimpleCommand, tc: ToolCall, projectRoot: string, home: string | undefined, order: number): { events: FileEvent[]; dirs: string[] } {
  const events: FileEvent[] = [];
  const dirs: string[] = [];
  const argv = effectiveArgv(cmd.argv);
  const head = argv[0] ?? '';
  const args = argv.slice(1);
  const positional = args.filter((a) => !a.startsWith('-'));
  const cwd = cmd.cwd;
  const res = (p: string) => resolveFilePath(p, cwd, projectRoot, home);
  const add = (action: FileAction, p: string | null) => {
    if (!p) return;
    events.push({ action, path: p, via: 'shell', evidence: ev(tc, cmd.raw || tc.command || ''), order });
  };

  // 리다이렉트로 파일 만들기: cat > f, echo … > f, cat <<EOF > f, > f
  for (const r of cmd.redirects) {
    if (!r.target || r.target === '/dev/null') continue;
    if (r.op === '>' || r.op === '&>') add('create', res(r.target));
    else if (r.op === '>>' || r.op === '&>>') add('update', res(r.target));
  }
  if (cmd.redirects.some((r) => r.target && r.target !== '/dev/null' && (r.op === '>' || r.op === '>>')) && !WRITE_CMDS.has(head) && head) {
    // 다른 명령의 출력 저장도 파일 생성으로 본다 (이미 위에서 추가됨)
  }

  switch (head) {
    case 'tee': {
      const append = args.includes('-a') || args.includes('--append');
      for (const p of positional) add(append ? 'update' : 'create', res(p));
      break;
    }
    case 'touch':
      for (const p of positional) add('create', res(p));
      break;
    case 'mkdir':
      for (const p of positional) {
        const d = res(p);
        if (d) dirs.push(d);
      }
      break;
    case 'cp': {
      if (positional.length >= 2) add('create', res(positional[positional.length - 1] ?? ''));
      break;
    }
    case 'mv': {
      if (positional.length >= 2) {
        for (const p of positional.slice(0, -1)) add('delete', res(p));
        add('create', res(positional[positional.length - 1] ?? ''));
      }
      break;
    }
    case 'rm':
      for (const p of positional) add('delete', res(p));
      break;
    case 'ln':
      if (positional.length >= 2) add('create', res(positional[positional.length - 1] ?? ''));
      break;
    case 'sed':
      if (args.some((a) => a === '-i' || a.startsWith('-i'))) {
        for (const p of positional.slice(1)) add('update', res(p));
      }
      break;
    case 'git': {
      const sub = args[0];
      if (sub === 'mv' && positional.length >= 3) {
        add('delete', res(positional[1] ?? ''));
        add('create', res(positional[2] ?? ''));
      } else if (sub === 'rm') {
        for (const p of positional.slice(1)) add('delete', res(p));
      } else if (sub === 'clone') {
        const target = positional[2] ?? path.basename(positional[1] ?? '', '.git');
        const d = res(target);
        if (d) dirs.push(d);
      } else if (sub === 'init') {
        const d = res(positional[1] ?? '.');
        if (d) dirs.push(d);
      }
      break;
    }
    case 'unzip':
    case 'tar': {
      const idx = args.findIndex((a) => a === '-d' || a === '-C');
      const target = idx >= 0 ? args[idx + 1] : undefined;
      const d = target ? res(target) : null;
      if (d) dirs.push(d);
      break;
    }
    default:
      break;
  }
  return { events, dirs };
}

export function isScaffoldCommand(argv: string[]): { target?: string } | null {
  const a = effectiveArgv(argv);
  const head = a[0] ?? '';
  const sub = a[1] ?? '';
  const positional = a.slice(1).filter((x) => !x.startsWith('-'));
  if ((head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun') && (sub === 'create' || sub === 'init')) return { target: positional[2] };
  if ((head === 'npx' || head === 'bunx' || head === 'pnpx') && /^(create-|degit$)/.test(sub)) return { target: positional[1] };
  if (head === 'cargo' && (sub === 'new' || sub === 'init')) return { target: positional[1] };
  if (head === 'django-admin' && sub === 'startproject') return { target: positional[1] };
  if (head === 'rails' && sub === 'new') return { target: positional[1] };
  if (head === 'vite' && sub === 'create') return { target: positional[1] };
  if (head === 'git' && sub === 'clone') return { target: positional[2] };
  return null;
}

export interface FileFacts {
  created: FileFact[];
  modified: FileFact[];
  deleted: FileFact[];
  dirs: string[];
}

export function collectFileFacts(session: NormalizedSession, home?: string): FileFacts {
  const events: FileEvent[] = [];
  const dirs = new Set<string>();
  let order = 0;
  const root = session.projectRoot;

  for (const tc of session.toolCalls) {
    if (tc.result && tc.result.ok === false) continue;
    order += 1;
    if (tc.category === 'file_write' || tc.category === 'file_edit') {
      const s = tc.result?.structured;
      const target = (s && 'filePath' in s && s.filePath) || tc.paths[0];
      const p = target ? resolveFilePath(target, undefined, root, home) : null;
      if (!p) continue;
      let action: FileAction = tc.category === 'file_write' ? 'create' : 'update';
      if (s && 'kind' in s) action = s.kind;
      events.push({ action, path: p, via: tc.name === 'apply_patch' ? 'patch' : 'tool', evidence: ev(tc, `${tc.name} ${target}`), order });
    } else if (tc.category === 'shell' && tc.command) {
      let cmds: SimpleCommand[] = [];
      try {
        cmds = splitCommands(tc.command, root !== '(unknown)' ? root : undefined);
      } catch {
        cmds = [];
      }
      for (const c of cmds) {
        const r = fileEventsFromCommand(c, tc, root, home, order);
        events.push(...r.events);
        for (const d of r.dirs) dirs.add(d);
        const sc = isScaffoldCommand(c.argv);
        if (sc?.target) {
          const d = resolveFilePath(sc.target, c.cwd, root, home);
          if (d) dirs.add(d);
        }
      }
    }
  }

  const state = new Map<string, { status: FileAction; via: FileFact['via']; count: number; evidence: Evidence[]; everCreated: boolean }>();
  for (const e of events) {
    const cur = state.get(e.path);
    if (!cur) {
      state.set(e.path, { status: e.action, via: e.via, count: 1, evidence: [e.evidence], everCreated: e.action === 'create' });
      continue;
    }
    cur.count += 1;
    if (cur.evidence.length < 5) cur.evidence.push(e.evidence);
    if (e.action === 'delete') cur.status = 'delete';
    else if (e.action === 'create') {
      cur.status = 'create';
      cur.everCreated = true;
      cur.via = e.via;
    } else if (cur.status === 'delete') cur.status = 'create';
    else if (cur.status === 'create') cur.status = 'create';
    else cur.status = 'update';
  }

  const toFact = (p: string, s: { via: FileFact['via']; count: number; evidence: Evidence[] }): FileFact => ({
    path: p,
    relPath: root && root !== '(unknown)' && p.startsWith(root + '/') ? p.slice(root.length + 1) : undefined,
    language: languageFor(p),
    via: s.via,
    count: s.count,
    evidence: s.evidence,
  });
  const created: FileFact[] = [];
  const modified: FileFact[] = [];
  const deleted: FileFact[] = [];
  for (const [p, s] of state) {
    const f = toFact(p, s);
    if (s.status === 'create') created.push(f);
    else if (s.status === 'update') modified.push(f);
    else deleted.push(f);
  }
  const byPath = (a: FileFact, b: FileFact) => (a.relPath ?? a.path).localeCompare(b.relPath ?? b.path);
  return {
    created: created.sort(byPath),
    modified: modified.sort(byPath),
    deleted: deleted.sort(byPath),
    dirs: Array.from(dirs).sort(),
  };
}
