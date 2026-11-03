#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
let contents = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
if (contents && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
const adminEnvFile = path.join(root, '.env.admin');
if (fs.existsSync(adminEnvFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(adminEnvFile);

// Supabase 설정이 있으면 로컬 DB를 띄우거나 접속 주소를 덮어쓰지 않는다.
if (process.env.VIBE_TEACHER_SUPABASE_DATABASE_URL) {
  console.log('[memory-db] Supabase DB 설정이 있습니다. npm run memory:check로 연결을 검사하세요.');
  process.exit(0);
}

// 이미 지정한 DB 주소는 재작성하거나 임의로 다른 DB에 접속하지 않는다.
if (process.env.VIBE_TEACHER_MEMORY_DATABASE_URL && !process.env.VIBE_TEACHER_POSTGRES_PASSWORD) {
  console.log('[memory-db] 기존 PostgreSQL 연결 주소가 설정되어 있습니다. 해당 DB에서 pgvector 확장을 준비한 뒤 앱을 실행하세요.');
  process.exit(0);
}
const port = process.env.VIBE_TEACHER_POSTGRES_PORT || '55432';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  console.error('[memory-db] VIBE_TEACHER_POSTGRES_PORT는 1024~65535여야 합니다.');
  process.exit(1);
}
const password = process.env.VIBE_TEACHER_POSTGRES_PASSWORD || randomBytes(24).toString('hex');
const databaseUrl = `postgresql://vibe_teacher:${encodeURIComponent(password)}@127.0.0.1:${port}/vibe_teacher_memory`;
if (process.env.VIBE_TEACHER_MEMORY_DATABASE_URL && process.env.VIBE_TEACHER_MEMORY_DATABASE_URL !== databaseUrl) {
  console.error('[memory-db] 기존 DB 주소와 로컬 DB 설정이 다릅니다. 기존 주소를 유지했습니다. 별도의 로컬 DB가 필요하면 .env 설정을 먼저 확인하세요.');
  process.exit(1);
}
const values = { VIBE_TEACHER_POSTGRES_PASSWORD: password, VIBE_TEACHER_MEMORY_DATABASE_URL: databaseUrl };
for (const [key, value] of Object.entries(values)) {
  if (!/^[A-Za-z0-9:/@._%-]+$/.test(value)) {
    console.error('[memory-db] 자동 설정에는 영문·숫자로 된 암호를 사용하세요.');
    process.exit(1);
  }
  const line = new RegExp(`^${key}=.*$`, 'm');
  contents = line.test(contents) ? contents.replace(line, `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`;
}
const temporary = `${envFile}.memory-tmp`;
fs.writeFileSync(temporary, contents, { mode: 0o600 });
fs.renameSync(temporary, envFile);
const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', path.join(root, 'compose.yaml'), 'up', '-d', '--wait', 'memory-db'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ...values },
});
if (result.error) console.error('[memory-db] Docker를 실행할 수 없습니다. Docker와 Compose 설치 상태를 확인하세요.');
if (result.status === 0) console.log(`[memory-db] PostgreSQL + pgvector 준비 완료 (127.0.0.1:${port}). 앱을 다시 시작하세요.`);
process.exitCode = result.status ?? 1;
