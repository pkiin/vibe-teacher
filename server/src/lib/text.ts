/** 코드 포인트 기준 절단 (서로게이트 쌍이 깨지지 않도록). */
export function truncate(s: string, max: number, marker = '…'): string {
  if (!s) return s;
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  return cps.slice(0, Math.max(0, max - marker.length)).join('') + marker;
}

export function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
}

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `<tag>…</tag>` 블록을 통째로 제거 */
export function stripTagBlock(s: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>\\s*`, 'g');
  return s.replace(re, '');
}

export function stringifyUnknown(v: unknown, max = 4000): string {
  if (v == null) return '';
  if (typeof v === 'string') return truncate(v, max);
  try {
    return truncate(JSON.stringify(v), max);
  } catch {
    return truncate(String(v), max);
  }
}

/** 객체 안의 긴 문자열을 재귀적으로 잘라 메모리를 줄인다. */
export function capStrings<T>(v: T, max: number, depth = 0): T {
  if (depth > 12) return v;
  if (typeof v === 'string') return truncate(v, max) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => capStrings(x, max, depth + 1)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = capStrings(val, max, depth + 1);
    }
    return out as T;
  }
  return v;
}

export function toIso(v: unknown): string | undefined {
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'number' && isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  return undefined;
}
