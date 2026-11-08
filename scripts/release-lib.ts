/**
 * 배포 묶음(npm run package)에 넣는 공개 설정과 실행 안내 글. 파일 IO 가 없어 테스트에서 바로 검사한다.
 * 배포 묶음은 누구에게나 전달될 수 있으므로 공개해도 되는 값(Supabase 주소와 publishable 키)만 담는다.
 */

/** 배포 묶음에 넣는 Node 버전. 공식 배포본을 받아 SHASUMS256 으로 확인한다 */
export const NODE_VERSION = '22.21.0';
export const RELEASE_PORT = 3318;

/** `.env.release` 에 적을 수 있는 이름. 그 밖의 이름(키·DB 주소 등)이 있으면 묶음을 만들지 않는다 */
export const RELEASE_KEYS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const;

/** KEY=VALUE 줄만 읽는다. 값을 오류 문구에 넣지 않는다. */
export function parseEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error('.env.release 에 KEY=VALUE 형식이 아닌 줄이 있습니다');
    let value = match[2]!.trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]!)) value = value.slice(1, -1);
    values.set(match[1]!, value);
  }
  return values;
}

function jwtRole(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part || token.split('.').length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

/** 공개 설정만 검사해 `app/release.env` 내용을 만든다. 실행 방식은 노트북 설치(local)로 고정한다. */
export function releaseEnvText(values: Map<string, string>): string {
  const extra = [...values.keys()].filter((k) => !(RELEASE_KEYS as readonly string[]).includes(k));
  if (extra.length) throw new Error(`.env.release 에는 ${RELEASE_KEYS.join(', ')} 만 적습니다. 지울 이름: ${extra.join(', ')}`);
  const url = values.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
  const key = values.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (!url || !key) throw new Error('.env.release 에 SUPABASE_URL 과 SUPABASE_PUBLISHABLE_KEY 를 모두 적으세요');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('SUPABASE_URL 이 주소 형식이 아닙니다'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SUPABASE_URL 은 https://<프로젝트>.supabase.co 같은 HTTPS 프로젝트 주소여야 합니다');
  }
  const publishable = /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key) || jwtRole(key) === 'anon';
  if (!publishable) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY 는 publishable 키(sb_publishable_…) 또는 anon 키여야 합니다. secret·service_role 키는 배포 묶음에 넣지 않습니다');
  }
  return [
    '# Vibe Teacher 배포 묶음의 공개 설정입니다. npm run package 가 만들었습니다.',
    '# 비밀값은 없습니다. 바꿀 값이 있으면 묶음 폴더에 .env 파일을 만들어 적으세요 (그 파일이 우선합니다).',
    'VIBE_TEACHER_AUTH_MODE=supabase',
    'VIBE_TEACHER_DEPLOYMENT=local',
    'VIBE_TEACHER_LLM_PROVIDER=openrouter',
    'VIBE_TEACHER_HOST=127.0.0.1',
    `VIBE_TEACHER_PORT=${RELEASE_PORT}`,
    `SUPABASE_URL=${url}`,
    `SUPABASE_PUBLISHABLE_KEY=${key}`,
    '',
  ].join('\n');
}

const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

/** 두 번 누르면 실행되는 Windows 실행 파일. zip 안에서 바로 열면 runtime 폴더가 없으므로 먼저 풀라고 안내한다. */
export function windowsLauncher(): string {
  return crlf([
    '@echo off',
    'chcp 65001 >nul',
    'title Vibe Teacher',
    'cd /d "%~dp0"',
    'if not exist "%~dp0runtime\\node.exe" goto missing',
    '"%~dp0runtime\\node.exe" "%~dp0app\\server.mjs"',
    'if errorlevel 1 pause',
    'exit /b',
    ':missing',
    'echo 압축을 먼저 풀어 주세요. zip 파일 안에서 바로 실행하면 동작하지 않습니다.',
    'pause',
    'exit /b 1',
  ]);
}

/** 메모장에서 한글이 깨지지 않도록 BOM 을 붙인다. */
export function windowsReadme(version: string): string {
  return `\uFEFF${crlf([
    `Vibe Teacher ${version} (Windows)`,
    '',
    '[시작하기]',
    '1. 이 zip 파일을 원하는 폴더에 풉니다. zip 안에서 바로 실행하면 동작하지 않습니다.',
    '2. 풀어 둔 vibe-teacher 폴더의 start.bat 을 두 번 누릅니다.',
    '   보안 경고 창이 나오면 [추가 정보] → [실행] 또는 [실행]을 누릅니다.',
    `3. 잠시 뒤 브라우저가 열립니다. 열리지 않으면 주소창에 http://127.0.0.1:${RELEASE_PORT}/ 을 입력합니다.`,
    '4. 회원가입하고 로그인한 뒤, 화면 안내에 따라 OpenRouter 키를 입력합니다.',
    '   관리자가 준 키가 있으면 그 키를, 받지 못했다면 https://openrouter.ai/keys 에서 본인이 발급한 키를 넣습니다.',
    '',
    '쓰는 동안 검은 창을 열어 두세요. 창을 닫으면 Vibe Teacher 가 종료됩니다.',
    '',
    '[저장 위치]',
    '설정과 화면에서 입력한 키는 C:\\Users\\<사용자>\\.vibe-teacher 에 저장되고, 학습 기록은 로그인한 계정에 저장됩니다.',
    '이 vibe-teacher 폴더를 지우거나 새 버전으로 바꿔도 기록은 남습니다.',
    '',
    '[포트 바꾸기]',
    `${RELEASE_PORT} 포트를 다른 프로그램이 쓰고 있다면 이 폴더에 .env 파일을 만들고 VIBE_TEACHER_PORT=3328 처럼 한 줄을 적습니다.`,
    '메모장으로 저장할 때 파일 형식을 "모든 파일"로 바꿔야 .env.txt 가 되지 않습니다.',
  ])}`;
}
