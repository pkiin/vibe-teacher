import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonl } from '../../src/lib/jsonl';

async function tmpFile(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-jsonl-'));
  const p = path.join(dir, 'x.jsonl');
  await fs.writeFile(p, content, 'utf8');
  return p;
}

describe('readJsonl', () => {
  it('parses lines, tolerates a partial trailing line and mid-file garbage', async () => {
    const p = await tmpFile('{"a":1}\nnot json\n{"a":2}\n{"a":3');
    const warnings: string[] = [];
    const out: unknown[] = [];
    for await (const r of readJsonl(p, { warnings })) out.push(r.value);
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
    expect(warnings.some((w) => w.includes('line 2'))).toBe(true);
    expect(warnings.some((w) => w.includes('partial trailing'))).toBe(true);
  });

  it('applies the strip hook and handles UTF-8 Korean text', async () => {
    const p = await tmpFile('{"t":"한국어","big":"xxxxxxxxxx"}\n');
    const out: unknown[] = [];
    for await (const r of readJsonl(p, { strip: (v) => ({ ...(v as object), big: undefined }) })) out.push(r.value);
    expect(out).toEqual([{ t: '한국어', big: undefined }]);
  });
});
