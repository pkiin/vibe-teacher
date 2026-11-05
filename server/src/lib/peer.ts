import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';

/**
 * 같은 기기의 loopback TCP 연결을 연 OS 계정(uid)을 찾는다 (identd 와 같은 방식).
 *
 * SSH 터널(`ssh -L`)의 연결은 로그인한 사용자 권한으로 도는 sshd 가 직접 연다. 리눅스는 소켓마다 만든 계정의
 * uid 를 `/proc/net/tcp`·`tcp6` 에 기록하므로, 서버가 받은 연결의 상대편 소켓을 찾으면 누가 접속했는지 알 수 있다.
 * 일반 사용자는 다른 uid 의 소켓을 만들 수 없다. 다른 기기에서 직접 들어온 연결은 표에 상대편이 없어 null 이다.
 *
 * 개발 서버(vite)의 /api 프록시도 이 파일을 쓰므로 node 내장 모듈만 import 한다.
 */

/** 같은 OS 계정으로 실행한 개발 프록시가 원래 접속자의 uid 를 넘기는 헤더 */
export const PEER_UID_HEADER = 'x-vibe-teacher-peer-uid';

const TABLES = ['/proc/net/tcp', '/proc/net/tcp6'];
const ESTABLISHED = '01';
const LITTLE_ENDIAN = os.endianness() === 'LE';

export interface SocketEnds {
  remoteAddress?: string | undefined;
  remotePort?: number | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
}

interface TcpEntry { local: string; remote: string; state: string; uid: number }

function ipv6Bytes(address: string): number[] | null {
  let text = address;
  let v4: number[] = [];
  const embedded = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    v4 = embedded[2]!.split('.').map(Number);
    text = embedded[1]!.endsWith('::') ? embedded[1]! : embedded[1]!.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const head = groups(halves[0] ?? '');
  const tail = halves.length === 2 ? groups(halves[1] ?? '') : [];
  const needed = v4.length ? 6 : 8;
  const fill = halves.length === 2 ? needed - head.length - tail.length : 0;
  const all = [...head, ...new Array<number>(Math.max(fill, 0)).fill(0), ...tail];
  if (fill < 0 || all.length !== needed || all.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return [...all.flatMap((g) => [g >> 8, g & 0xff]), ...v4];
}

/** IPv4 와 IPv4-mapped IPv6 는 점 표기, 나머지 IPv6 는 생략 없는 8묶음 */
function fromBytes(bytes: number[]): string {
  if (bytes.length === 4) return bytes.join('.');
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12).join('.');
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  return groups.join(':');
}

export function canonicalIp(address: string): string | null {
  const text = address.replace(/%.*$/, '').toLowerCase();
  if (net.isIPv4(text)) return text;
  if (!net.isIPv6(text)) return null;
  const bytes = ipv6Bytes(text);
  return bytes ? fromBytes(bytes) : null;
}

/** 커널은 주소를 32비트 단위로 호스트 바이트 순서의 16진수로 적는다 */
function procEndpoint(field: string | undefined): string | null {
  const [hex, portHex] = (field ?? '').split(':');
  if (!hex || !portHex || (hex.length !== 8 && hex.length !== 32)) return null;
  const bytes: number[] = [];
  for (let w = 0; w < hex.length; w += 8) {
    const word = [0, 2, 4, 6].map((i) => parseInt(hex.slice(w + i, w + i + 2), 16));
    if (word.some((b) => Number.isNaN(b))) return null;
    bytes.push(...(LITTLE_ENDIAN ? word.reverse() : word));
  }
  const port = parseInt(portHex, 16);
  return Number.isInteger(port) ? `${fromBytes(bytes)}|${port}` : null;
}

/** `/proc/net/tcp` 형식: sl local_address rem_address st tx:rx tr:when retrnsmt uid ... */
export function parseProcNetTcp(text: string): TcpEntry[] {
  const out: TcpEntry[] = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    const local = procEndpoint(f[1]);
    const remote = procEndpoint(f[2]);
    const uid = Number(f[7]);
    if (local && remote && f[3] && Number.isInteger(uid)) out.push({ local, remote, state: f[3], uid });
  }
  return out;
}

/** 서버가 받은 소켓의 상대편(접속자 쪽) 소켓을 찾아 uid 를 돌려준다. 못 찾거나 둘 이상이면 null. */
export function findPeerUid(tables: string[], ends: SocketEnds): number | null {
  const peerIp = ends.remoteAddress ? canonicalIp(ends.remoteAddress) : null;
  const selfIp = ends.localAddress ? canonicalIp(ends.localAddress) : null;
  if (!peerIp || !selfIp || !ends.remotePort || !ends.localPort) return null;
  const peer = `${peerIp}|${ends.remotePort}`;
  const self = `${selfIp}|${ends.localPort}`;
  const uids = new Set<number>();
  for (const table of tables) {
    for (const e of parseProcNetTcp(table)) if (e.state === ESTABLISHED && e.local === peer && e.remote === self) uids.add(e.uid);
  }
  return uids.size === 1 ? [...uids][0]! : null;
}

export function procNetAvailable(): boolean {
  try {
    fs.accessSync(TABLES[0]!, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readPeerUid(ends: SocketEnds): Promise<number | null> {
  const tables = await Promise.all(TABLES.map((f) => fsp.readFile(f, 'utf8').catch(() => '')));
  return findPeerUid(tables, ends);
}

/** 개발 프록시처럼 요청마다 동기로 헤더를 붙여야 하는 곳에서 쓴다 */
export function readPeerUidSync(ends: SocketEnds): number | null {
  const tables = TABLES.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  });
  return findPeerUid(tables, ends);
}

/**
 * 프록시 헤더는 연결을 연 쪽이 서버와 같은 OS 계정일 때만 믿는다 (그 계정은 이미 모든 기록을 읽을 수 있다).
 * 다른 계정이 직접 연결해 보낸 헤더는 무시한다. 프록시가 접속자를 확인하지 못해 빈 값을 넘기면 null.
 */
export function trustedPeerUid(socketUid: number | null, forwarded: string | undefined, selfUid: number): number | null {
  if (socketUid === null) return null;
  if (socketUid !== selfUid || forwarded === undefined) return socketUid;
  return /^\d{1,10}$/.test(forwarded) ? Number(forwarded) : null;
}
