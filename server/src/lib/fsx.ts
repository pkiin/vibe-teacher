import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from '@vibe-teacher/shared';

export function expandHome(p: string, home = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

export function normalizePath(p: string): string {
  return path.resolve(expandHome(p)).replace(/[\\/]+$/, '') || '/';
}

export async function safeStat(p: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  return (await safeStat(p)) !== null;
}

export async function isDir(p: string): Promise<boolean> {
  const st = await safeStat(p);
  return !!st && st.isDirectory();
}

/** 디렉터리 읽기 가능 여부. EACCES 는 오류가 아니라 상태로 돌려준다. */
export async function readability(p: string): Promise<Readable> {
  try {
    await fsp.access(p, fs.constants.R_OK | fs.constants.X_OK);
    const st = await fsp.stat(p);
    return st.isDirectory() ? 'ok' : 'missing';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return 'denied';
    return 'missing';
  }
}

export interface ListEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
}

/** 디렉터리 목록. 권한/존재 오류는 빈 배열 + 상태로 처리. */
export async function listDir(p: string): Promise<{ entries: ListEntry[]; readable: Readable }> {
  try {
    const dirents = await fsp.readdir(p, { withFileTypes: true });
    return {
      readable: 'ok',
      entries: dirents.map((d) => ({
        name: d.name,
        path: path.join(p, d.name),
        isDir: d.isDirectory(),
        isFile: d.isFile(),
      })),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { entries: [], readable: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing' };
  }
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export async function readJsonSafe<T = unknown>(p: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

export async function realpathSafe(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return path.resolve(p);
  }
}
