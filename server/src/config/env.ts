import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

export interface ServerEnv {
  host: string;
  port: number;
  token: string | null;
  isLoopback: boolean;
}

export interface ServerArgs {
  port?: number;
  host?: string;
  home?: string;
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (net.isIP(host) === 4) return host.startsWith('127.');
  if (net.isIP(host) === 6) return host === '::1';
  return false;
}

/** `--port`, `--host`, `--home` CLI 인자 (예: `npm start -- --port 3060`) */
export function parseServerArgs(argv: string[]): ServerArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        home: { type: 'string' },
      },
      allowPositionals: true,
      strict: false,
    }));
  } catch {
    return {};
  }
  const str = (k: string): string | undefined => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const out: ServerArgs = {};
  const port = str('port');
  if (port !== undefined) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port 값이 올바르지 않습니다: ${port}`);
    out.port = n;
  }
  const host = str('host');
  if (host) out.host = host;
  const home = str('home');
  if (home) out.home = path.resolve(home.replace(/^~(?=$|\/)/, os.homedir()));
  return out;
}

/** 우선순위: CLI 인자 > 환경변수 > 설정 파일 */
export function readServerEnv(cfg: { host: string; port: number }, env: NodeJS.ProcessEnv = process.env, args: ServerArgs = {}): ServerEnv {
  const host = args.host || env.VIBE_TEACHER_HOST?.trim() || cfg.host;
  const portRaw = env.VIBE_TEACHER_PORT?.trim();
  const envPort = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : undefined;
  const port = args.port ?? envPort ?? cfg.port;
  const token = env.VIBE_TEACHER_TOKEN?.trim() || null;
  return { host, port, token, isLoopback: isLoopbackHost(host) };
}

export function currentUser(): { uid: number; username: string } {
  try {
    const info = os.userInfo();
    return { uid: info.uid, username: info.username };
  } catch {
    return { uid: -1, username: 'unknown' };
  }
}
