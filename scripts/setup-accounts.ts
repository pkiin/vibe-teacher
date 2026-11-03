import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cloudConfig } from '../server/src/cloud/client';
import { loadDotEnv } from '../server/src/config/dotenv';
import { MemoryDatabase, memoryDatabaseError } from '../server/src/memory/database';

const root = new URL('../', import.meta.url);
loadDotEnv(fileURLToPath(new URL('.env', root)));
loadDotEnv(fileURLToPath(new URL('.env.admin', root)));

class SetupError extends Error {}

/** 순서대로 적용한다. 표가 모두 있으면 건너뛰고, 일부만 있으면 기존 객체를 건드리지 않고 멈춘다. */
const MIGRATIONS = [
  { file: '202611030001_accounts_and_storage.sql', tables: ['vt_members', 'vt_documents', 'vt_events', 'vt_locks'], label: '회원·승인·RLS 저장소' },
  { file: '202611030002_ai_call_log.sql', tables: ['vt_ai_calls', 'vt_ai_runs'], label: 'AI 호출 기록' },
];

try {
  const config = cloudConfig({ ...process.env, VIBE_TEACHER_AUTH_MODE: 'supabase' })!;
  const url = process.env.VIBE_TEACHER_SUPABASE_DATABASE_URL;
  if (!url) throw new SetupError('관리자 .env.admin에 VIBE_TEACHER_SUPABASE_DATABASE_URL을 설정하세요. 일반 사용자에게 배포하지 마세요.');
  // API 프로젝트와 다른 DB에 회원 표를 만들지 않는다.
  const db = new URL(url);
  const project = new URL(config.url).hostname.split('.')[0];
  const sameProject = db.hostname === `db.${project}.supabase.co` || decodeURIComponent(db.username).endsWith(`.${project}`);
  if (!sameProject) throw new SetupError('SUPABASE_URL과 DB 접속 주소가 같은 프로젝트인지 확인하세요. 사용자명에 프로젝트 ID가 있는 Session pooler(5432)를 사용하세요.');
  const client = new MemoryDatabase({ url, source: 'supabase' }).client();
  try {
    await client.connect();
    await client.query("select pg_advisory_lock(hashtext('vibe-teacher-accounts-setup'))");
    for (const migration of MIGRATIONS) {
      const existing = await client.query<{ name: string }>("select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1)", [migration.tables]);
      if (existing.rows.length === migration.tables.length) {
        console.log(`[accounts] ${migration.label}: 이미 있어 기존 데이터를 변경하지 않았습니다.`);
        continue;
      }
      if (existing.rows.length) throw new SetupError(`${migration.label} 표가 일부만 존재합니다. 기존 객체는 변경하지 않았습니다. 관리자가 마이그레이션 상태를 확인하세요.`);
      const sql = await fs.readFile(new URL(`supabase/migrations/${migration.file}`, root), 'utf8');
      await client.query(sql);
      await client.query("notify pgrst, 'reload schema'");
      console.log(`[accounts] ${migration.label}: Supabase에 준비했습니다.`);
    }
  } finally { await client.end().catch(() => {}); }
} catch (error) {
  console.error(`[accounts] ${error instanceof SetupError ? error.message : memoryDatabaseError(error)}`);
  process.exitCode = 1;
}
