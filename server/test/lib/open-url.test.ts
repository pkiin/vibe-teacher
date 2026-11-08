import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../../src/config/layout';
import { isAppRunning, openUrl } from '../../src/lib/open-url';

function fakeSpawn(fail = false) {
  const calls: { command: string; args: string[]; options: SpawnOptions }[] = [];
  const spawn = (command: string, args: string[], options: SpawnOptions) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    if (fail) process.nextTick(() => child.emit('error', new Error('ENOENT')));
    return child;
  };
  return { calls, spawn };
}

describe('배포 묶음 실행 위치', () => {
  it('app/release.env 가 있으면 묶음으로 보고 .env.admin 은 읽지 않는다', () => {
    const app = path.join('/synthetic', 'vibe-teacher', 'app');
    const layout = resolveLayout(app, (file) => file === path.join(app, 'release.env'));
    expect(layout).toEqual({ packaged: true, envFiles: [path.join(app, '..', '.env'), path.join(app, 'release.env')], distDir: path.join(app, 'web') });
  });
  it('저장소에서는 .env → .env.admin, web/dist 를 쓴다', () => {
    const root = path.resolve('/synthetic/repo');
    const layout = resolveLayout(path.join(root, 'server', 'src'), () => false);
    expect(layout).toEqual({ packaged: false, envFiles: [path.join(root, '.env'), path.join(root, '.env.admin')], distDir: path.join(root, 'web', 'dist') });
  });
});

describe('브라우저 열기', () => {
  it('운영체제별 명령으로 이 컴퓨터의 앱 주소만 연다', async () => {
    const win = fakeSpawn();
    expect(await openUrl('http://127.0.0.1:3318/', 'win32', win.spawn)).toBe(true);
    expect(win.calls[0]).toMatchObject({ command: 'cmd.exe', args: ['/d', '/s', '/c', 'start "" "http://127.0.0.1:3318/"'], options: { windowsVerbatimArguments: true, detached: true } });
    const mac = fakeSpawn();
    expect(await openUrl('http://127.0.0.1:3318/', 'darwin', mac.spawn)).toBe(true);
    expect(mac.calls[0]).toMatchObject({ command: 'open', args: ['http://127.0.0.1:3318/'] });
    const other = fakeSpawn();
    // 셸로 넘기는 문자열이므로 다른 주소나 특수 문자는 실행하지 않는다.
    for (const url of ['https://example.test/', 'http://127.0.0.1:3318/" & calc & "', 'http://localhost:3318/']) {
      expect(await openUrl(url, 'win32', other.spawn)).toBe(false);
    }
    expect(other.calls).toEqual([]);
  });
  it('브라우저 열기 명령이 없으면 false 를 돌려 주소를 직접 열라고 안내하게 한다', async () => {
    expect(await openUrl('http://127.0.0.1:3318/', 'linux', fakeSpawn(true).spawn)).toBe(false);
  });
  it('이미 실행 중인지는 /api/auth/me 응답 모양으로 판단한다', async () => {
    const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    expect(await isAppRunning('http://127.0.0.1:3318/', reply({ mode: 'supabase', serviceUser: 'synthetic' }))).toBe(true);
    expect(await isAppRunning('http://127.0.0.1:3318/', reply({ hello: 'other app' }))).toBe(false);
    expect(await isAppRunning('http://127.0.0.1:3318/', reply({}, 404))).toBe(false);
    expect(await isAppRunning('http://127.0.0.1:3318/', (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)).toBe(false);
  });
});
