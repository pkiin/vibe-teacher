import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../../src/config/dotenv';

describe('loadDotEnv', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const k of ['VT_DOTENV_A', 'VT_DOTENV_B']) delete process.env[k];
    for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('reads new keys, keeps values already set in the shell, and ignores a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-dotenv-'));
    created.push(dir);
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, '# comment\nVT_DOTENV_A=from-file\nVT_DOTENV_B=only-file\n');
    process.env.VT_DOTENV_A = 'from-shell';
    const res = loadDotEnv(file);
    expect(res.loaded).toBe(true);
    expect(res.keys).toEqual(['VT_DOTENV_B']);
    expect(process.env.VT_DOTENV_A).toBe('from-shell');
    expect(process.env.VT_DOTENV_B).toBe('only-file');
    expect(loadDotEnv(path.join(dir, 'missing.env'))).toEqual({ loaded: false, keys: [] });
  });
});
