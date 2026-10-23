import path from 'node:path';
import { shortId } from '../lib/hash';
import { normalizePath } from '../lib/fsx';

export function normalizeRoot(root: string): string {
  if (!root || root === '(unknown)') return '(unknown)';
  return normalizePath(root);
}

export function projectIdFor(accountId: string, root: string): string {
  return shortId(`project:${accountId}\0${normalizeRoot(root)}`);
}

export function projectNameFor(root: string): string {
  const n = normalizeRoot(root);
  if (n === '(unknown)') return '(알 수 없는 폴더)';
  return path.basename(n) || n;
}
