import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config/schema';
import { ConfigStore, resolveHome, resolvePaths } from '../src/config/store';
import { isLoopbackHost, parseServerArgs, readServerEnv } from '../src/config/env';

describe('config store', () => {
  it('creates defaults, persists updates atomically and recovers from bad JSON', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-cfg-'));
    const paths = resolvePaths(home);
    const store = new ConfigStore(paths);
    const cfg = await store.load();
    expect(cfg.scan.mode).toBe('current');
    expect(cfg.llm.provider).toBe('auto');
    await store.update((c) => {
      c.scan.mode = 'all';
      c.sources.push({ id: 'x', provider: 'codex', path: '/tmp/x', label: '', enabled: true });
    });
    const reread = new ConfigStore(paths);
    expect((await reread.load()).scan.mode).toBe('all');
    expect((await reread.load()).sources[0]?.provider).toBe('codex');
    await fs.writeFile(paths.configFile, '{ broken', 'utf8');
    expect((await new ConfigStore(paths).load()).scan.mode).toBe('current');
    expect((await fs.readdir(home)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('migrates legacy API choices and the free-router default without discarding other settings', () => {
    for (const provider of ['openai', 'anthropic-sdk']) {
      const cfg = ConfigSchema.parse({ llm: { provider, openrouterModel: 'openrouter/free' }, scan: { mode: 'list', homes: ['/tmp/fixture'] } });
      expect(cfg.llm.provider).toBe('openrouter');
      expect(cfg.llm.openrouterModel).toBe('openai/gpt-5-mini');
      expect(cfg.scan.homes).toEqual(['/tmp/fixture']);
    }
  });
  it('resolves home from env', () => {
    expect(resolveHome({ VIBE_TEACHER_HOME: '/x/y' })).toBe('/x/y');
    expect(resolveHome({})).toBe(path.join(os.homedir(), '.vibe-teacher'));
  });

  it('server env: loopback detection and token requirement inputs', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    const e = readServerEnv({ host: '127.0.0.1', port: 8787 }, { VIBE_TEACHER_HOST: '0.0.0.0', VIBE_TEACHER_PORT: '9000', VIBE_TEACHER_TOKEN: 't' });
    expect(e).toEqual({ host: '0.0.0.0', port: 9000, token: 't', isLoopback: false });
  });

  it('CLI args beat env which beats config', () => {
    const args = parseServerArgs(['--port', '3060', '--host', 'localhost', '--home', '~/x']);
    expect(args).toEqual({ port: 3060, host: 'localhost', home: path.join(os.homedir(), 'x') });
    const e = readServerEnv({ host: '0.0.0.0', port: 8787 }, { VIBE_TEACHER_PORT: '9000' }, args);
    expect(e).toMatchObject({ host: 'localhost', port: 3060, isLoopback: true });
    expect(readServerEnv({ host: '127.0.0.1', port: 8787 }, { VIBE_TEACHER_PORT: '9000' }, {}).port).toBe(9000);
    expect(readServerEnv({ host: '127.0.0.1', port: 8787 }, {}, {}).port).toBe(8787);
    expect(parseServerArgs([])).toEqual({});
    expect(() => parseServerArgs(['--port', 'abc'])).toThrow();
  });
});
