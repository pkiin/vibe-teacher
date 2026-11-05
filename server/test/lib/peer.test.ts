import net from 'node:net';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { canonicalIp, findPeerUid, parseProcNetTcp, procNetAvailable, readPeerUid, trustedPeerUid } from '../../src/lib/peer';

// 합성 /proc/net/tcp — little-endian 기기가 쓰는 형식. 3318 = 0CF6, 54321 = D431
const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const row = (local: string, remote: string, st: string, uid: number) => `   0: ${local} ${remote} ${st} 00000000:00000000 00:00000000 00000000  ${uid}        0 1 1 0000000000000000 20 4 30 10 -1`;
const TCP = [
  HEADER,
  row('0100007F:0CF6', '00000000:0000', '0A', 1000), // 서버 대기
  row('0100007F:0CF6', '0100007F:D431', '01', 1000), // 서버가 받은 소켓
  row('0100007F:D431', '0100007F:0CF6', '01', 1099), // user99 의 sshd 가 연 소켓
  row('0100007F:D432', '0100007F:0CF6', '06', 0), // TIME_WAIT
].join('\n');
const TCP6 = [
  HEADER,
  row('00000000000000000000000001000000:D433', '00000000000000000000000001000000:0CF6', '01', 1098), // ::1
].join('\n');
const ends = (remoteAddress: string, remotePort: number, localAddress = '127.0.0.1') => ({ remoteAddress, remotePort, localAddress, localPort: 3318 });

describe('연결을 연 OS 계정 찾기', () => {
  it('IPv4·IPv6·IPv4-mapped 주소를 같은 표기로 맞춘다', () => {
    expect(canonicalIp('127.0.0.1')).toBe('127.0.0.1');
    expect(canonicalIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(canonicalIp('::1')).toBe('0:0:0:0:0:0:0:1');
    expect(canonicalIp('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:1');
    expect(canonicalIp('not-an-ip')).toBeNull();
  });

  it.skipIf(os.endianness() !== 'LE')('서버가 받은 연결의 상대편 소켓 uid 를 고르고 대기·종료 중 소켓은 쓰지 않는다', () => {
    expect(parseProcNetTcp(TCP)).toHaveLength(4);
    expect(findPeerUid([TCP, TCP6], ends('127.0.0.1', 54321))).toBe(1099);
    expect(findPeerUid([TCP, TCP6], ends('::ffff:127.0.0.1', 54321, '::ffff:127.0.0.1'))).toBe(1099);
    expect(findPeerUid([TCP, TCP6], ends('::1', 54323, '::1'))).toBe(1098);
    expect(findPeerUid([TCP, TCP6], ends('127.0.0.1', 54322))).toBeNull();
    // 다른 기기에서 들어온 연결은 이 기기의 표에 상대편이 없다.
    expect(findPeerUid([TCP, TCP6], ends('192.0.2.10', 54321))).toBeNull();
    expect(findPeerUid([TCP, TCP6], {})).toBeNull();
  });

  it.skipIf(os.endianness() !== 'LE')('같은 연결에 서로 다른 uid 가 보이면 정하지 않는다', () => {
    const twice = `${TCP}\n${row('0100007F:D431', '0100007F:0CF6', '01', 1001)}`;
    expect(findPeerUid([twice], ends('127.0.0.1', 54321))).toBeNull();
  });

  it('개발 프록시 헤더는 서버와 같은 계정이 연 연결에서만 받아들인다', () => {
    expect(trustedPeerUid(1099, '1000', 1000)).toBe(1099);
    expect(trustedPeerUid(1000, undefined, 1000)).toBe(1000);
    expect(trustedPeerUid(1000, '1099', 1000)).toBe(1099);
    expect(trustedPeerUid(1000, '', 1000)).toBeNull();
    expect(trustedPeerUid(1000, '1099; 0', 1000)).toBeNull();
    expect(trustedPeerUid(null, '1099', 1000)).toBeNull();
  });

  it.skipIf(!procNetAvailable())('실제 loopback 연결에서 이 프로세스의 uid 를 찾는다', async () => {
    const found = new Promise<number | null>((resolve) => {
      const server = net.createServer((socket) => {
        void readPeerUid(socket).then((uid) => { socket.destroy(); server.close(); resolve(uid); });
      });
      server.listen(0, '127.0.0.1', () => {
        const client = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
        client.on('error', () => {});
      });
    });
    expect(await found).toBe(process.getuid?.());
  });
});
