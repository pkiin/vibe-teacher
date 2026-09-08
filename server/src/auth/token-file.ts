import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const LOGIN_TOKEN_REL = path.join('.vibe-teacher', 'login-token');
export const MIN_TOKEN_LENGTH = 16;

export type TokenFileResult = { ok: true; token: string; hash: string } | { ok: false; reason: string; code: 'missing' | 'denied' | 'invalid' };

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32);
}

/**
 * 사용자 홈의 로그인 토큰 파일을 읽는다.
 * - 일반 파일이어야 하고, 알 수 있다면 소유자 uid 가 그 계정이어야 하며, 다른 사용자(other)에게 읽히면 안 된다.
 * - 그룹 비트는 ACL 마스크로도 쓰이므로 검사하지 않는다 (서비스 계정 ACL 을 주면 그룹 비트가 켜짐).
 */
export async function readLoginToken(homePath: string, expectedUid?: number): Promise<TokenFileResult> {
  const file = path.join(homePath, LOGIN_TOKEN_REL);
  let st;
  try {
    st = await fsp.stat(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'denied', reason: '토큰 파일을 읽을 권한이 없습니다 (서비스 계정 ACL 확인)' };
    return { ok: false, code: 'missing', reason: '토큰 파일이 없습니다 (~/.vibe-teacher/login-token)' };
  }
  if (!st.isFile()) return { ok: false, code: 'invalid', reason: '토큰 파일이 일반 파일이 아닙니다' };
  if (expectedUid !== undefined && expectedUid >= 0 && st.uid !== expectedUid) return { ok: false, code: 'invalid', reason: '토큰 파일의 소유자가 그 계정이 아닙니다' };
  if (st.mode & 0o004) return { ok: false, code: 'invalid', reason: '토큰 파일이 모두에게 읽힙니다. chmod 600 하세요' };
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'denied', reason: '토큰 파일을 읽을 권한이 없습니다 (서비스 계정 ACL 확인)' };
    return { ok: false, code: 'missing', reason: '토큰 파일을 읽지 못했습니다' };
  }
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH) return { ok: false, code: 'invalid', reason: `토큰이 너무 짧습니다 (${MIN_TOKEN_LENGTH}자 이상)` };
  return { ok: true, token, hash: tokenHash(token) };
}

/** 로그인 화면에 보여 줄 토큰 생성 명령 (서비스 계정 이름을 끼워 넣음) */
export function tokenSetupCommand(serviceUser: string): string {
  return (
    `( umask 077; mkdir -p ~/.vibe-teacher; head -c 32 /dev/urandom | base64 | tr -d '/+=\\n' > ~/.vibe-teacher/login-token; ` +
    `setfacl -m u:${serviceUser}:rx ~ ~/.vibe-teacher; setfacl -m u:${serviceUser}:r ~/.vibe-teacher/login-token; cat ~/.vibe-teacher/login-token )`
  );
}
