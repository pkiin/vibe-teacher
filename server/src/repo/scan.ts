import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from '@vibe-teacher/shared';
import { sha1 } from '../lib/hash';
import { maskSecrets } from '../llm/digest';
import { entryPaths, inspectCode, selectCode, type CodeFile } from './code';
import { readRepoText } from './source';

/**
 * 저장소 읽기 전용 스캔. 아무것도 쓰거나 실행하지 않는다 (git 명령도 쓰지 않고 .git/HEAD 만 읽음).
 * - 의존성·빌드 폴더는 건너뛰고, 심볼릭 링크는 따라가지 않는다.
 * - .env·키 파일은 열지 않는다. .env.example 류는 변수 이름만 읽는다.
 * - 파일 수·크기 상한이 있고, 넘으면 truncated 로 표시한다.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.pytest_cache', '.turbo', '.parcel-cache', 'target', 'vendor', '.idea', '.vscode', '.svelte-kit', '.mypy_cache', '.gradle']);
const SECRET_FILE_RE = /^(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_rsa.*|id_ed25519.*|credentials.*|secrets?\..*)$/i;
const ENV_EXAMPLE_RE = /^\.env\.(example|sample|template|dist)$/i;
const SOURCE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
const MAX_FILES = 4000;
const MAX_DEPTH = 10;
const MAX_SOURCE_SCAN = 400;
const MAX_SOURCE_BYTES = 200_000;

export interface PackageInfo {
  path: string;
  name?: string;
  description?: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  workspaces: string[];
  main?: string;
}

export interface RouteInfo {
  file: string;
  method: string;
  path: string;
  line?: number;
  endLine?: number;
  code?: string;
  hash?: string;
}

export interface RepoScan {
  root: string;
  readable: Readable;
  scannedAt: string;
  signature: string;
  head?: string;
  branch?: string;
  files: { path: string; size: number }[];
  truncated: boolean;
  readme?: { path: string; text: string };
  packages: PackageInfo[];
  python?: { path: string; dependencies: string[] };
  envExample?: { path: string; keys: string[] };
  docker: boolean;
  routes: RouteInfo[];
  code?: CodeFile[];
  entries?: string[];
  codeLimited?: boolean;
}

async function readText(file: string, max: number): Promise<string | null> {
  try {
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await fh.read(buf, 0, max, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function readGit(root: string): Promise<{ head?: string; branch?: string }> {
  const head = (await readText(path.join(root, '.git', 'HEAD'), 200))?.trim();
  if (!head) return {};
  const m = /^ref: (refs\/heads\/(.+))$/.exec(head);
  if (!m) return { head: head.slice(0, 12) };
  const branch = m[2];
  let hash = (await readText(path.join(root, '.git', m[1]!), 100))?.trim();
  if (!hash) {
    const packed = await readText(path.join(root, '.git', 'packed-refs'), 500_000);
    hash = packed?.split('\n').find((l) => l.endsWith(` ${m[1]}`))?.split(' ')[0];
  }
  return { ...(hash ? { head: hash.slice(0, 12) } : {}), ...(branch ? { branch } : {}) };
}

const ROUTE_RES: { re: RegExp; lang: 'js' | 'py' }[] = [
  { re: /\b(?:app|router|api|server|routes|r)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`\s]+)['"`]/g, lang: 'js' },
  { re: /@(?:app|router|bp|blueprint|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"\s]+)['"]/g, lang: 'py' },
];

export function extractRoutes(file: string, text: string): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const { re, lang } of ROUTE_RES) {
    if (lang === 'py' && !file.endsWith('.py')) continue;
    if (lang === 'js' && file.endsWith('.py')) continue;
    for (const m of text.matchAll(re)) out.push({ file, method: (m[1] === 'route' ? 'ANY' : m[1] ?? '').toUpperCase(), path: m[2] ?? '', line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

function parsePackage(rel: string, text: string): PackageInfo | null {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const ws = p.workspaces;
    return {
      path: rel,
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(typeof p.description === 'string' ? { description: maskSecrets(p.description) } : {}),
      scripts: Object.fromEntries(Object.entries(obj(p.scripts)).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, maskSecrets(String(v))])),
      dependencies: Object.keys(obj(p.dependencies)),
      devDependencies: Object.keys(obj(p.devDependencies)),
      workspaces: Array.isArray(ws) ? ws.filter((x): x is string => typeof x === 'string') : Array.isArray(obj(ws).packages) ? (obj(ws).packages as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      ...(typeof p.main === 'string' ? { main: p.main } : {}),
    };
  } catch {
    return null;
  }
}

/** light: 파일 목록과 서명만 (갱신 필요 여부 확인용, 파일 내용은 읽지 않음) */
export async function scanRepo(root: string, opts: { light?: boolean } = {}): Promise<RepoScan> {
  const base: RepoScan = { root, readable: 'missing', scannedAt: new Date().toISOString(), signature: '', files: [], truncated: false, packages: [], docker: false, routes: [] };
  try {
    const st = await fsp.stat(root);
    if (!st.isDirectory()) return base;
    await fsp.access(root, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ...base, readable: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing' };
  }

  const files: RepoScan['files'] = [];
  let truncated = false;
  let maxMtime = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || depth >= MAX_DEPTH) continue;
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        try {
          const s = await fsp.stat(full);
          files.push({ path: path.relative(root, full).split(path.sep).join('/'), size: s.size });
          if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
        } catch {
          // 읽을 수 없는 파일은 건너뛴다
        }
      }
      if (truncated) return;
    }
  };
  await walk(root, 0);

  const git = await readGit(root);
  const scan: RepoScan = { ...base, readable: 'ok', files, truncated, ...git };
  const signature = sha1(`${git.head ?? ''}|${files.length}|${files.reduce((n, f) => n + f.size, 0)}|${Math.round(maxMtime)}`).slice(0, 16);
  if (opts.light) return { ...scan, signature };
  const byName = (re: RegExp) => files.filter((f) => re.test(path.basename(f.path)));

  const readme = files.find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f.path)) ?? byName(/^readme\.md$/i).sort((a, b) => a.path.length - b.path.length)[0];
  if (readme) {
    const text = await readText(path.join(root, readme.path), 20_000);
    if (text) scan.readme = { path: readme.path, text: maskSecrets(text) };
  }
  for (const f of byName(/^package\.json$/).sort((a, b) => a.path.length - b.path.length).slice(0, 12)) {
    const text = await readText(path.join(root, f.path), 200_000);
    const p = text && parsePackage(f.path, text);
    if (p) scan.packages.push(p);
  }
  const req = files.find((f) => f.path === 'requirements.txt');
  if (req) {
    const text = (await readText(path.join(root, req.path), 50_000)) ?? '';
    scan.python = { path: req.path, dependencies: text.split('\n').map((l) => l.trim().split(/[=<>~! ;\[]/)[0] ?? '').filter((x) => x && !x.startsWith('#')) };
  }
  const envEx = files.find((f) => ENV_EXAMPLE_RE.test(path.basename(f.path)) && !f.path.includes('/'));
  if (envEx) {
    const text = (await readText(path.join(root, envEx.path), 50_000)) ?? '';
    // 값은 버리고 변수 이름만 (주석 처리된 이름 포함)
    const keys = [...new Set([...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{1,63})\s*=/gm)].map((m) => m[1]!))];
    scan.envExample = { path: envEx.path, keys };
  }
  scan.docker = files.some((f) => /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(f.path));

  let scanned = 0;
  let routeCodeBudget = 40_000;
  const code: CodeFile[] = [];
  const fileSet = new Set(files.map((file) => file.path));
  scan.entries = entryPaths(scan.packages, fileSet);
  const entrySet = new Set(scan.entries);
  const priority = (file: string) => entrySet.has(file) ? 0 : /(^|\/)(app|main|index)\.[cm]?[jt]sx?$/.test(file) ? 1 : /(^|\/)(routes?|services?|handlers?|core|domain|store|storage)\//.test(file) ? 2 : 3;
  for (const f of files.slice().sort((a, b) => priority(a.path) - priority(b.path))) {
    if (scanned >= MAX_SOURCE_SCAN) break;
    if (!(SOURCE_RE.test(f.path) || /(^|\/)index\.html$/.test(f.path)) || f.size > MAX_SOURCE_BYTES || SECRET_FILE_RE.test(path.basename(f.path)) || /(^|\/)(test|tests|__tests__|fixtures)\/|\.(?:test|spec)\.[jt]sx?$/.test(f.path)) continue;
    scanned += 1;
    const source = await readRepoText(root, f.path);
    if (source) {
      const routes = extractRoutes(f.path, source.text).slice(0, Math.max(0, 300 - scan.routes.length));
      const lines = source.text.split('\n');
      scan.routes.push(...routes.map((route, index) => {
        const start = (route.line ?? 1) - 1;
        const end = Math.min(start + 40, (routes[index + 1]?.line ?? lines.length + 1) - 1);
        const excerpt: string[] = [];
        let chars = 0;
        for (const line of lines.slice(start, end)) {
          if (chars + line.length + 1 > Math.min(2400, routeCodeBudget)) break;
          excerpt.push(line); chars += line.length + 1;
        }
        routeCodeBudget -= chars;
        return { ...route, hash: source.hash, ...(excerpt.length ? { code: excerpt.join('\n'), endLine: start + excerpt.length } : {}) };
      }));
      code.push(inspectCode(f.path, source.text, source.hash, fileSet));
    }
  }

  scan.code = selectCode(code, scan.entries);
  scan.codeLimited = code.length > scan.code.length || scanned >= MAX_SOURCE_SCAN;
  scan.routes.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));

  scan.signature = signature;
  return scan;
}
