import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RepoFileView } from '@vibe-teacher/shared';
import { maskSecrets } from '../llm/digest';
import { sha1 } from '../lib/hash';

export const MAX_SOURCE_BYTES = 200_000;
const EXAMPLE = /^\.env\.(example|sample|template|dist)$/i;
const TEXT = /\.(?:[cm]?[jt]sx?|py|md|markdown|txt|json|ya?ml|toml|html|css|scss|sql|prisma|sh|go|rs|java|rb|php)$/i;
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'coverage', 'venv', 'target']);

/** 경로를 조립하기 전에 숨김 설정과 비밀 파일을 제외한다. */
export function readableRepoPath(relative: string): boolean {
  if (!relative || relative.length > 1000 || relative.includes('\\') || /[\x00-\x1f\x7f]/.test(relative) || path.posix.isAbsolute(relative)) return false;
  const parts = relative.split('/');
  if (parts.some((part, index) => !part || part === '.' || part === '..' || SKIP.has(part) || (part.startsWith('.') && !(index === parts.length - 1 && EXAMPLE.test(part))))) return false;
  const name = parts.at(-1)!;
  if (EXAMPLE.test(name)) return true;
  if (/^(?:.*(?:secret|credential|private[-_]?key).*|id_rsa.*|id_ed25519.*)$/i.test(name)) return false;
  return TEXT.test(name) || /^(README|Dockerfile)$/i.test(name);
}

/** 저장소 밖·심볼릭 링크·특수 파일은 읽지 않는다. 바이트 상한을 넘기지 않는다. */
export async function readRepoText(root: string, relative: string): Promise<{ text: string; hash: string; truncated: boolean; masked: boolean } | null> {
  if (!readableRepoPath(relative)) return null;
  try {
    const base = await fsp.realpath(root);
    const target = path.join(base, ...relative.split('/'));
    let current = base;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await fsp.lstat(current)).isSymbolicLink()) return null;
    }
    const resolved = await fsp.realpath(target);
    if (!resolved.startsWith(`${base}${path.sep}`)) return null;
    const before = await fsp.lstat(resolved);
    if (!before.isFile()) return null;
    const handle = await fsp.open(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || await fsp.realpath(target) !== resolved) return null;
      // Linux에서는 열린 파일 자체의 위치도 확인해 상위 폴더 교체를 거른다.
      if (process.platform === 'linux') {
        const actual = await fsp.realpath(`/proc/self/fd/${handle.fd}`);
        if (!actual.startsWith(`${base}${path.sep}`)) return null;
      }
      const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const raw = buffer.subarray(0, Math.min(bytesRead, MAX_SOURCE_BYTES)).toString('utf8');
      if (raw.includes('\0')) return null;
      const namesOnly = EXAMPLE.test(path.basename(relative));
      const text = namesOnly
        ? [...new Set([...raw.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{1,63})\s*=/gm)].map((m) => m[1]!))].map((key) => `${key}=…`).join('\n')
        : maskSecrets(raw);
      return { text, hash: sha1(text).slice(0, 16), truncated: bytesRead > MAX_SOURCE_BYTES, masked: namesOnly || text !== raw };
    } finally { await handle.close(); }
  } catch { return null; }
}

export async function repoFileView(root: string, relative: string, line = 1): Promise<RepoFileView | null> {
  const file = await readRepoText(root, relative);
  if (!file) return null;
  const lines = file.text.split(/\r?\n/);
  const start = Math.max(0, Math.min(Math.floor(line) - 1, lines.length - 1));
  const shown = lines.slice(start, start + 500);
  return { path: relative, lines: shown, startLine: start + 1, endLine: start + shown.length, lineCount: lines.length, hash: file.hash, truncated: file.truncated, masked: file.masked };
}
