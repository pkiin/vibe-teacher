#!/usr/bin/env node
/**
 * 개발 서버 실행기.
 *   npm run dev -- --port 3050 --api-port 3060 [--host 0.0.0.0] [--api-host 127.0.0.1] [--home ~/.vibe-teacher]
 * 웹(Vite)과 API(Hono)를 함께 띄우고, 웹의 /api 프록시가 API 포트를 따라가도록 환경변수로 맞춘다.
 * 우선순위: CLI 인자 > 환경변수 > .env > 기본값 (API 는 설정 파일 server.port/host 도 읽음)
 */
import concurrently from 'concurrently';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// 저장소 루트의 .env (셸 환경변수가 우선). 웹 프록시도 같은 포트 값을 보도록 여기서 먼저 읽는다.
const dotenvFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(dotenvFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(dotenvFile);

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      'api-port': { type: 'string' },
      'api-host': { type: 'string' },
      home: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  }));
} catch (err) {
  console.error(`[dev] 인자 오류: ${err.message}`);
  usage();
  process.exit(2);
}

if (values.help) {
  usage();
  process.exit(0);
}

const env = { ...process.env };
const setPort = (key, raw, label) => {
  if (raw === undefined) return;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    console.error(`[dev] ${label} 포트가 올바르지 않습니다: ${raw}`);
    process.exit(2);
  }
  env[key] = raw;
};
setPort('VIBE_TEACHER_WEB_PORT', values.port, '웹');
setPort('VIBE_TEACHER_PORT', values['api-port'], 'API');
if (values.host) env.VIBE_TEACHER_WEB_HOST = values.host;
if (values['api-host']) env.VIBE_TEACHER_HOST = values['api-host'];
if (values.home) env.VIBE_TEACHER_HOME = values.home;

const webPort = env.VIBE_TEACHER_WEB_PORT ?? '5173';
const webHost = env.VIBE_TEACHER_WEB_HOST ?? '127.0.0.1';
const apiPort = env.VIBE_TEACHER_PORT ?? '8787 (설정 파일 값이 있으면 그 값)';
const apiHost = env.VIBE_TEACHER_HOST ?? '127.0.0.1';
console.log(`[dev] 웹 http://${webHost}:${webPort}  →  API http://${apiHost}:${apiPort}`);

const { result } = concurrently(
  [
    { command: 'tsx watch --clear-screen=false server/src/index.ts', name: 'server', prefixColor: 'blue', env },
    { command: 'vite web', name: 'web', prefixColor: 'green', env },
  ],
  { prefix: 'name', killOthersOn: ['failure', 'success'], handleInput: false },
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);

function usage() {
  console.log(`사용법: npm run dev -- [옵션]
  -p, --port <n>       웹(Vite) 포트            (기본 5173, 환경변수 VIBE_TEACHER_WEB_PORT)
      --host <h>       웹 바인딩 주소            (기본 127.0.0.1, VIBE_TEACHER_WEB_HOST)
      --api-port <n>   API(Hono) 포트           (기본 8787, VIBE_TEACHER_PORT 또는 설정 server.port)
      --api-host <h>   API 바인딩 주소           (기본 127.0.0.1, VIBE_TEACHER_HOST; loopback 이 아니면 VIBE_TEACHER_TOKEN 필요)
      --home <dir>     설정/캐시 디렉터리        (기본 ~/.vibe-teacher, VIBE_TEACHER_HOME)
예)  npm run dev -- --port 3050 --api-port 3060`);
}
