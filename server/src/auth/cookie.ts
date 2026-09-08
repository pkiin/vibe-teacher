import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const COOKIE_NAME = 'vt_session';

export interface SessionPayload {
  /** username */
  u: string;
  /** 로그인 당시 토큰 파일 해시 (파일이 바뀌면 세션 무효) */
  h: string;
  /** 만료 (epoch ms) */
  exp: number;
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

export class CookieSigner {
  constructor(private readonly secret: Buffer) {}

  sign(payload: SessionPayload): string {
    const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
    const mac = b64u(createHmac('sha256', this.secret).update(body).digest());
    return `${body}.${mac}`;
  }

  verify(value: string | undefined, now = Date.now()): SessionPayload | null {
    if (!value) return null;
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = value.slice(0, dot);
    const mac = value.slice(dot + 1);
    const expected = b64u(createHmac('sha256', this.secret).update(body).digest());
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
      if (!payload || typeof payload.u !== 'string' || typeof payload.h !== 'string' || typeof payload.exp !== 'number') return null;
      if (payload.exp <= now) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

/** 쿠키 서명 비밀을 상태 디렉터리에 0600 으로 보관 (없으면 생성) */
export async function loadOrCreateSecret(file: string): Promise<Buffer> {
  try {
    const raw = (await fsp.readFile(file, 'utf8')).trim();
    if (raw.length >= 32) return Buffer.from(raw, 'base64url');
  } catch {
    // 생성
  }
  const secret = randomBytes(32);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, secret.toString('base64url'), { encoding: 'utf8', mode: 0o600 });
  return secret;
}
