import { createHash } from 'node:crypto';

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export function shortId(input: string, len = 12): string {
  return sha1(input).slice(0, len);
}

export function encodeKey(parts: string[]): string {
  return Buffer.from(parts.join('\0'), 'utf8').toString('base64url');
}

export function decodeKey(key: string): string[] | null {
  try {
    const raw = Buffer.from(key, 'base64url').toString('utf8');
    if (!raw) return null;
    return raw.split('\0');
  } catch {
    return null;
  }
}
