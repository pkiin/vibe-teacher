import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyedMutex, WikiStorage, safeSegment } from '../../src/storage/store';

const dirs: string[] = [];
const tmpHome = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-store-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('wiki storage', () => {
  it('keeps everything under <home>/wiki and rejects path-escaping ids', () => {
    const home = tmpHome();
    const s = new WikiStorage(home);
    expect(s.projectDir('abc123')).toBe(path.join(home, 'wiki', 'projects', 'abc123'));
    expect(s.learnerProjectDir('l_1', 'p1')).toBe(path.join(home, 'wiki', 'learners', 'l_1', 'projects', 'p1'));
    expect(() => s.projectDir('../etc')).toThrow();
    expect(() => s.learnerProjectDir('a/b', 'p')).toThrow();
    expect(() => safeSegment('', 'x')).toThrow();
  });

  it('appends JSONL and skips a torn trailing line instead of failing', async () => {
    const s = new WikiStorage(tmpHome());
    const file = path.join(s.root, 'ledger.jsonl');
    await s.appendJsonl(file, { n: 1 });
    await s.appendJsonl(file, { n: 2 });
    fs.appendFileSync(file, '{"n":3');
    const { items, warnings } = await s.readJsonl<{ n: number }>(file);
    expect(items.map((i) => i.n)).toEqual([1, 2]);
    expect(warnings).toHaveLength(1);
    expect((await s.readJsonl(path.join(s.root, 'missing.jsonl'))).items).toEqual([]);
  });

  it('serializes work on the same key and lets other keys run', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      m.run('a', async () => {
        log.push('a1-start');
        await wait(20);
        log.push('a1-end');
      }),
      m.run('a', async () => {
        log.push('a2-start');
        log.push('a2-end');
      }),
      m.run('b', async () => {
        log.push('b-start');
      }),
    ]);
    expect(log.indexOf('a2-start')).toBeGreaterThan(log.indexOf('a1-end'));
    expect(log.indexOf('b-start')).toBeLessThan(log.indexOf('a1-end'));
  });

  it('releases the lock when a task throws', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(m.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});
