import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';

type Spawn = (command: string, args: string[], options: SpawnOptions) => { on(event: 'error', listener: (err: Error) => void): unknown; unref(): void };

/** 이 컴퓨터 안의 앱 주소만 연다. 셸에 넘기는 문자열이므로 다른 주소·특수 문자는 받지 않는다. */
const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/$/;

/** 그 주소에서 이 앱이 이미 실행 중인지. 로그인 없이 열리는 /api/auth/me 의 응답 모양으로 확인한다. */
export async function isAppRunning(url: string, request: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await request(`${url}api/auth/me`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = await res.json() as Record<string, unknown>;
    return typeof body.mode === 'string' && typeof body.serviceUser === 'string';
  } catch {
    return false;
  }
}

/** 기본 브라우저로 주소를 연다. 실패하면 false 를 돌려주고, 호출한 쪽이 주소를 직접 열라고 안내한다. */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform, spawn: Spawn = nodeSpawn): Promise<boolean> {
  if (!LOCAL_URL.test(url)) return Promise.resolve(false);
  const [command, args, extra]: [string, string[], SpawnOptions] =
    platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsVerbatimArguments: true }]
    : platform === 'darwin' ? ['open', [url], {}]
    : ['xdg-open', [url], {}];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { ...extra, detached: true, stdio: 'ignore' });
      let failed = false;
      child.on('error', () => { failed = true; resolve(false); });
      child.unref();
      // spawn 오류는 다음 틱에 온다. 그 전에 오류가 없으면 실행을 시작한 것으로 본다.
      setImmediate(() => { if (!failed) resolve(true); });
    } catch {
      resolve(false);
    }
  });
}
