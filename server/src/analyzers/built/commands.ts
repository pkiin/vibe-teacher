import type { CommandCategory, CommandFact, Evidence, NormalizedSession, ServerFact, ToolCall } from '@vibe-teacher/shared';
import { effectiveArgv, splitCommands, type SimpleCommand } from '../../lib/shell';
import { truncate } from '../../lib/text';
import { isScaffoldCommand } from './files';

const INSPECT = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'ugrep', 'find', 'fd', 'wc', 'pwd', 'which', 'tree', 'jq', 'echo', 'printf', 'stat', 'du', 'df', 'ps',
  'env', 'printenv', 'less', 'more', 'file', 'type', 'whoami', 'id', 'date', 'uname', 'sort', 'uniq', 'diff', 'cut', 'awk', 'sed', 'true', 'test',
  'realpath', 'readlink', 'basename', 'dirname', 'md5sum', 'sha256sum', 'lsof', 'netstat', 'ss', 'ping', 'hostname', 'ip', 'free', 'top', 'nproc',
]);
const FILE_CMDS = new Set(['touch', 'mkdir', 'cp', 'mv', 'rm', 'ln', 'chmod', 'chown', 'tee', 'unzip', 'tar', 'zip', 'rmdir']);
const TEST_BIN = new Set(['vitest', 'jest', 'pytest', 'mocha', 'playwright', 'cypress', 'ava', 'tap', 'phpunit', 'rspec']);
const RUN_BIN = new Set(['vite', 'next', 'nodemon', 'uvicorn', 'gunicorn', 'flask', 'serve', 'http-server', 'live-server', 'ts-node', 'tsx', 'streamlit', 'nuxt', 'astro', 'hono']);
const BUILD_BIN = new Set(['tsc', 'esbuild', 'rollup', 'webpack', 'parcel', 'swc', 'babel', 'eslint', 'prettier', 'biome', 'ruff', 'black', 'mypy', 'flake8']);
const CONTROL_WORDS = new Set(['fi', 'do', 'done', 'then', 'else', 'elif', 'if', 'for', 'while', 'until', 'case', 'esac', '{', '}', 'export', 'set', 'source', '.', 'local', 'return', 'exit', 'break', 'continue', 'function', 'shift', 'wait', 'trap', 'eval', 'read', 'true', 'false', ':', 'cd', 'unset', 'alias', 'declare', 'readonly', 'let', 'pushd', 'popd']);
const DEPLOY_BIN = new Set(['vercel', 'netlify', 'wrangler', 'firebase', 'flyctl', 'fly', 'heroku', 'railway', 'render', 'surge', 'gcloud', 'aws', 'az', 'kubectl', 'helm', 'supabase', 'eas']);
const INSTALL_HEADS = new Set(['pip', 'pip3', 'poetry', 'gem', 'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'choco', 'winget', 'conda']);

export interface ClassifiedCommand {
  cmd: SimpleCommand;
  argv: string[];
  category: CommandCategory;
  key: string;
}

export function classifyCommand(cmd: SimpleCommand): ClassifiedCommand {
  const argv = effectiveArgv(cmd.argv);
  const head = argv[0] ?? '';
  const sub = argv[1] ?? '';
  const rest = argv.slice(1);
  const hasWriteRedirect = cmd.redirects.some((r) => r.target && r.target !== '/dev/null' && (r.op === '>' || r.op === '>>' || r.op === '&>' || r.op === '&>>'));
  let category: CommandCategory = 'other';

  const npmLike = head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun';
  const scriptName = npmLike ? (sub === 'run' || sub === 'run-script' ? argv[2] ?? '' : sub) : '';

  if (isScaffoldCommand(argv)) category = 'scaffold';
  else if (head === 'git') {
    category = 'git';
  } else if (head === 'gh') {
    category = sub === 'repo' && argv[2] === 'create' ? 'deploy' : 'git';
  } else if (npmLike) {
    if (['install', 'i', 'add', 'ci', 'update', 'up', 'upgrade', 'remove', 'uninstall', 'rm', 'link'].includes(sub)) category = 'install';
    else if (sub === 'test' || sub === 't' || /^test/.test(scriptName) || scriptName === 'e2e') category = 'test';
    else if (['dev', 'start', 'serve', 'preview'].includes(scriptName) || (head === 'bun' && (sub === 'run' || sub === '--watch') && /\.(ts|js|tsx)$/.test(argv[2] ?? ''))) category = 'run';
    else if (['build', 'compile', 'typecheck', 'lint', 'check', 'format'].includes(scriptName)) category = 'build';
    else if (head === 'bun' && /\.(ts|js|tsx)$/.test(sub)) category = 'run';
    else if (sub === 'run' || sub === 'exec' || sub === 'x') category = 'run';
    else if (sub === 'publish') category = 'deploy';
    else category = 'other';
  } else if (head === 'npx' || head === 'bunx' || head === 'pnpx') {
    const bin = sub.replace(/@.*$/, '');
    if (TEST_BIN.has(bin)) category = 'test';
    else if (RUN_BIN.has(bin) && !['build', 'create'].includes(argv[2] ?? '')) category = argv[2] === 'build' ? 'build' : 'run';
    else if (BUILD_BIN.has(bin)) category = 'build';
    else if (DEPLOY_BIN.has(bin)) category = 'deploy';
    else category = 'run';
  } else if (head === 'uv') {
    if (['add', 'pip', 'sync', 'remove', 'lock'].includes(sub)) category = 'install';
    else if (sub === 'run' && (argv[2] === 'pytest' || argv[2] === 'python' && argv[3] === '-m' && argv[4] === 'pytest')) category = 'test';
    else if (sub === 'run') category = 'run';
    else category = 'other';
  } else if (INSTALL_HEADS.has(head) && (sub === 'install' || sub === 'add' || sub === 'update' || sub === 'upgrade')) {
    category = 'install';
  } else if (head === 'cargo') {
    if (sub === 'add' || sub === 'install') category = 'install';
    else if (sub === 'test') category = 'test';
    else if (sub === 'run') category = 'run';
    else if (sub === 'build' || sub === 'check' || sub === 'clippy') category = 'build';
  } else if (head === 'go') {
    if (sub === 'get' || sub === 'mod') category = 'install';
    else if (sub === 'test') category = 'test';
    else if (sub === 'run') category = 'run';
    else if (sub === 'build' || sub === 'vet') category = 'build';
  } else if (TEST_BIN.has(head)) category = 'test';
  else if (head === 'python' || head === 'python3') {
    if (sub === '-m' && (argv[2] === 'pytest' || argv[2] === 'unittest')) category = 'test';
    else if (sub === '-m' && (argv[2] === 'http.server' || argv[2] === 'flask' || argv[2] === 'uvicorn' || argv[2] === 'streamlit')) category = 'run';
    else if (sub === '-m' && (argv[2] === 'pip' || argv[2] === 'venv' || argv[2] === 'ensurepip')) category = 'install';
    else if (/\.py$/.test(sub) && /(test|spec)/.test(sub)) category = 'test';
    else if (/\.py$/.test(sub)) category = 'run';
    else category = 'other';
  } else if (head === 'node') {
    if (/\.(m?js|cjs)$/.test(sub) && !hasWriteRedirect) category = 'run';
    else category = 'other';
  } else if (head === 'docker' || head === 'docker-compose' || head === 'podman') {
    if (sub === 'build') category = 'build';
    else if (sub === 'run' || sub === 'up' || (sub === 'compose' && argv[2] === 'up')) category = 'run';
    else if (sub === 'push') category = 'deploy';
    else category = 'other';
  } else if (RUN_BIN.has(head)) category = sub === 'build' ? 'build' : 'run';
  else if (BUILD_BIN.has(head) || head === 'make' || head === 'cmake' || head === 'gradle' || head === 'mvn') category = 'build';
  else if (DEPLOY_BIN.has(head)) category = 'deploy';
  else if (head === 'curl' || head === 'wget' || head === 'http' || head === 'httpie') category = hasWriteRedirect || rest.some((a) => a === '-o' || a === '-O') ? 'file' : 'inspect';
  else if (FILE_CMDS.has(head) || hasWriteRedirect || (head === 'sed' && rest.some((a) => a === '-i' || a.startsWith('-i')))) category = 'file';
  else if (head === 'cd' || head === 'export' || head === 'source' || head === '.' || head === 'set' || head === 'alias' || head === 'unset') category = 'other';
  else if (INSPECT.has(head)) category = 'inspect';
  else if (head === 'chmod' || head === 'chown') category = 'file';

  const key = `${category}:${normalizeForKey(argv)}`;
  return { cmd, argv, category, key };
}

function normalizeForKey(argv: string[]): string {
  const cleaned = argv.filter((a) => a !== '2>&1');
  return cleaned.join(' ').replace(/\s+/g, ' ').trim();
}

const FAIL_RE = /command not found|npm ERR!|Traceback \(most recent call last\)|ModuleNotFoundError|SyntaxError:|error TS\d+|Cannot find module|EADDRINUSE|Permission denied|fatal:/i;

export function commandFailed(tc: ToolCall): boolean {
  if (tc.result?.ok === false) return true;
  const s = tc.result?.structured;
  if (s && 'stderr' in s) {
    if (s.interrupted) return false;
    if (FAIL_RE.test(s.stderr) || FAIL_RE.test(s.stdout)) return true;
  }
  return false;
}

export interface CommandFacts {
  commands: CommandFact[];
  tests: CommandFact[];
  servers: ServerFact[];
  classified: { tc: ToolCall; c: ClassifiedCommand; failed: boolean }[];
}

export function collectCommandFacts(session: NormalizedSession): CommandFacts {
  const byKey = new Map<string, CommandFact>();
  const classified: CommandFacts['classified'] = [];
  const servers: ServerFact[] = [];
  const root = session.projectRoot !== '(unknown)' ? session.projectRoot : undefined;

  for (const tc of session.toolCalls) {
    if (tc.category !== 'shell' || !tc.command) continue;
    let cmds: SimpleCommand[] = [];
    try {
      cmds = splitCommands(tc.command, root);
    } catch {
      cmds = [];
    }
    if (!cmds.length) cmds = [{ argv: [tc.command], assignments: [], redirects: [], heredocs: [], raw: tc.command }];
    const failed = commandFailed(tc);
    for (const cmd of cmds) {
      const c = classifyCommand(cmd);
      const head = c.argv[0] ?? '';
      if (!head || CONTROL_WORDS.has(head) || head.startsWith('{') || head.startsWith('$') || head.startsWith('}')) continue;
      classified.push({ tc, c, failed: failed && c.category !== 'inspect' });
      const evidence: Evidence = { toolCallId: tc.id, messageIndex: tc.messageIndex, snippet: truncate(cmd.raw || tc.command, 200) };
      const existing = byKey.get(c.key);
      const cmdFailed = failed && c.category !== 'inspect';
      if (existing) {
        existing.count += 1;
        if (cmdFailed) existing.failed += 1;
        if (existing.evidence.length < 5) existing.evidence.push(evidence);
      } else {
        byKey.set(c.key, { command: truncate(c.argv.join(' ').replace(/\s+/g, ' '), 200), category: c.category, count: 1, failed: cmdFailed ? 1 : 0, evidence: [evidence] });
      }
      if (c.category === 'run') {
        const port = detectPort(c.argv, tc);
        if (!servers.some((s) => s.command === c.argv.join(' '))) servers.push({ command: truncate(c.argv.join(' '), 120), port, evidence: [evidence] });
      }
    }
  }
  const commands = Array.from(byKey.values()).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
  return { commands, tests: commands.filter((c) => c.category === 'test'), servers, classified };
}

function detectPort(argv: string[], tc: ToolCall): number | undefined {
  const joined = argv.join(' ');
  let m = /(?:--port|-p|PORT=)\s*=?\s*(\d{2,5})/.exec(joined);
  if (m?.[1]) return Number(m[1]);
  const s = tc.result?.structured;
  const out = s && 'stdout' in s ? s.stdout : '';
  m = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/.exec(out);
  if (m?.[1]) return Number(m[1]);
  return undefined;
}
