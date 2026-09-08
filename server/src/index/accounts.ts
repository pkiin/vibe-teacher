import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Account, ScanSettings } from '@vibe-teacher/shared';
import { expandHome, listDir, normalizePath, readability } from '../lib/fsx';
import { shortId } from '../lib/hash';

export const OTHER_ACCOUNT_ID = 'other';

export function accountIdFor(homePath: string): string {
  return shortId(`account:${normalizePath(homePath)}`);
}

/** /etc/passwd 를 읽을 수 있으면 홈 → 사용자명 매핑 (uid ≥ 1000) */
export async function readPasswdHomes(): Promise<Map<string, { username: string; uid: number }>> {
  const map = new Map<string, { username: string; uid: number }>();
  try {
    const raw = await fsp.readFile('/etc/passwd', 'utf8');
    for (const line of raw.split('\n')) {
      const parts = line.split(':');
      if (parts.length < 7) continue;
      const username = parts[0] ?? '';
      const uid = Number(parts[2]);
      const home = parts[5] ?? '';
      if (!username || !isFinite(uid) || !home || home === '/' || home.includes('nonexistent')) continue;
      map.set(normalizePath(home), { username, uid });
    }
  } catch {
    // 읽을 수 없으면 빈 맵
  }
  return map;
}

export async function discoverAccounts(scan: ScanSettings, currentHome = os.homedir()): Promise<Account[]> {
  const homes = new Set<string>();
  const current = normalizePath(currentHome);
  homes.add(current);

  if (scan.mode === 'list') {
    for (const h of scan.homes) homes.add(normalizePath(expandHome(h, currentHome)));
  } else if (scan.mode === 'all') {
    const roots = scan.homeRoots.length ? scan.homeRoots : ['/home'];
    for (const root of roots) {
      const { entries } = await listDir(normalizePath(expandHome(root, currentHome)));
      for (const e of entries) if (e.isDir) homes.add(normalizePath(e.path));
    }
    for (const h of scan.homes) homes.add(normalizePath(expandHome(h, currentHome)));
    const passwd = await readPasswdHomes();
    for (const [home, info] of passwd) {
      if (info.uid >= 1000 && roots.some((r) => home.startsWith(normalizePath(expandHome(r, currentHome)) + path.sep))) homes.add(home);
    }
  }

  const passwd = scan.mode === 'current' ? new Map() : await readPasswdHomes();
  const accounts: Account[] = [];
  for (const home of homes) {
    const readable = await readability(home);
    const pw = passwd.get(home);
    accounts.push({
      id: accountIdFor(home),
      username: pw?.username ?? path.basename(home) ?? home,
      homePath: home,
      isCurrent: home === current,
      readable,
      sourceCount: 0,
      sessionCount: 0,
      projectCount: 0,
    });
  }
  accounts.sort((a, b) => (a.isCurrent === b.isCurrent ? a.username.localeCompare(b.username) : a.isCurrent ? -1 : 1));
  return accounts;
}

export function otherAccount(): Account {
  return {
    id: OTHER_ACCOUNT_ID,
    username: '기타 경로',
    homePath: '',
    isCurrent: false,
    readable: 'ok',
    sourceCount: 0,
    sessionCount: 0,
    projectCount: 0,
  };
}
