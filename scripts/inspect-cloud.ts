import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../server/src/config/dotenv';
import { MemoryDatabase, databaseIdentifier, memoryDatabaseError } from '../server/src/memory/database';
import { cloudConfig } from '../server/src/cloud/client';

const root = new URL('../', import.meta.url);
loadDotEnv(fileURLToPath(new URL('.env', root)));
loadDotEnv(fileURLToPath(new URL('.env.admin', root)));
class InspectionError extends Error {}

/** 운영 DB 읽기 전용 진단. 개인 데이터·UUID·키·연결 주소는 출력하지 않는다. */
async function inspect() {
  const url = process.env.VIBE_TEACHER_SUPABASE_DATABASE_URL;
  if (!url) throw new InspectionError('관리자 .env.admin에 VIBE_TEACHER_SUPABASE_DATABASE_URL이 필요합니다');
  const config = cloudConfig({ ...process.env, VIBE_TEACHER_AUTH_MODE: 'supabase' })!;
  const db = new URL(url), project = new URL(config.url).hostname.split('.')[0];
  if (db.hostname !== `db.${project}.supabase.co` && !decodeURIComponent(db.username).endsWith(`.${project}`)) throw new InspectionError('앱의 SUPABASE_URL과 같은 프로젝트의 DB 주소를 사용하세요');
  const client = new MemoryDatabase({ url, source: 'supabase' }).client();
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    console.log(JSON.stringify({ authMode: process.env.VIBE_TEACHER_AUTH_MODE ?? 'legacy', deployment: process.env.VIBE_TEACHER_DEPLOYMENT ?? 'local' }));
    const stats = await client.query(`select s.schemaname, s.relname, c.relrowsecurity as rls, s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
      pg_total_relation_size(s.relid)::text as bytes from pg_stat_user_tables s join pg_class c on c.oid = s.relid
      where (s.schemaname = 'public' and s.relname like 'vt_%') or s.schemaname = 'vibe_teacher' order by s.schemaname, s.relname`);
    const reset = await client.query('select stats_reset from pg_stat_database where datname = current_database()');
    console.log(JSON.stringify({ statsReset: reset.rows[0]?.stats_reset, note: '통계는 DB 누적값이며 앱 요청 수와 다릅니다' }));
    const names = new Set<string>();
    for (const row of stats.rows) {
      const name = `${row.schemaname}.${row.relname}`;
      names.add(name);
      const count = await client.query(`select count(*)::text as rows from ${databaseIdentifier(row.schemaname)}.${databaseIdentifier(row.relname)}`);
      console.log(JSON.stringify({ ...row, rows: count.rows[0]?.rows }));
    }
    console.log(JSON.stringify({ missingTables: ['vt_members', 'vt_documents', 'vt_events', 'vt_locks', 'vt_ai_calls', 'vt_ai_runs'].filter((name) => !names.has(`public.${name}`)) }));
    if (names.has('public.vt_documents')) {
      const result = await client.query(`select case
        when key like 'enrich/%' then 'enrich'
        when key like '%/prefs.json' then 'prefs'
        when key like '%/profile.json' then 'profile'
        when key like '%/concepts.json' then 'concepts'
        when key like '%/onboarding.json' then 'onboarding'
        when key like '%/knowledge-views/%' then 'knowledge-view'
        when key like '%/knowledge-text.json' then 'knowledge-text'
        when key like '%/repo/%' then 'repo'
        when key like '%/sessions/%' then 'session-index'
        when key like '%/snapshots/%' then 'snapshot'
        when key like '%/ai/%' then 'wiki-ai'
        else 'other' end as kind, count(*)::text as rows,
        sum(pg_column_size(value))::text as value_bytes from public.vt_documents group by 1 order by 1`);
      console.log(JSON.stringify({ documents: result.rows }));
    }
    if (names.has('public.vt_events')) {
      const result = await client.query(`select value->>'kind' as kind, count(*)::text as rows from public.vt_events group by 1 order by 1`);
      console.log(JSON.stringify({ events: result.rows }));
    }
    for (const table of ['vt_ai_calls', 'vt_ai_runs']) {
      if (!names.has(`public.${table}`)) continue;
      const result = await client.query(`select feature, status, count(*)::text as rows, max(created_at) as last_at from public.${databaseIdentifier(table)} group by 1, 2 order by 1, 2`);
      console.log(JSON.stringify({ [table]: result.rows }));
    }
    await client.query('ROLLBACK');
  } finally { await client.end().catch(() => {}); }
}

inspect().catch((error: unknown) => {
  console.error(`[cloud:inspect] ${error instanceof InspectionError ? error.message : memoryDatabaseError(error)}`);
  process.exitCode = 1;
});
