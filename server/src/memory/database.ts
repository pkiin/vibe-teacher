import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TLSSocket } from 'node:tls';
import { Client } from 'pg';

export interface MemoryDatabaseSettings {
  url: string;
  source: 'supabase' | 'postgres';
}

/** Supabase 전용 설정이 있으면 기존 로컬 DB 설정보다 우선한다. */
export function memoryDatabaseSettings(env: NodeJS.ProcessEnv = process.env): MemoryDatabaseSettings | null {
  const supabase = env.VIBE_TEACHER_SUPABASE_DATABASE_URL?.trim();
  if (supabase) return { url: supabase, source: 'supabase' };
  const postgres = env.VIBE_TEACHER_MEMORY_DATABASE_URL?.trim();
  return postgres ? { url: postgres, source: 'postgres' } : null;
}

export class MemoryDatabaseError extends Error {}

function managedSupabase(host: string): boolean {
  return ['supabase.co', 'supabase.com', 'supabase.net'].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function databaseIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new MemoryDatabaseError('데이터베이스 식별자 형식을 확인해 주세요.');
  return `"${value}"`;
}

/** 서버 전용 스키마를 검증하고, pooler가 설정을 무시하면 public에 쓰기 전에 실패한다. */
export class MemoryDatabase {
  readonly connectionString: string;
  readonly source: MemoryDatabaseSettings['source'];
  readonly schema: string;
  readonly identity: string[];
  private preparation?: Promise<void>;

  constructor(settings: MemoryDatabaseSettings) {
    let url: URL;
    try { url = new URL(settings.url); } catch { throw new MemoryDatabaseError('PostgreSQL 연결 주소 형식을 확인해 주세요.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new MemoryDatabaseError('PostgreSQL 연결 주소와 데이터베이스 이름을 확인해 주세요.');
    const managed = managedSupabase(url.hostname);
    this.source = settings.source === 'supabase' || managed ? 'supabase' : 'postgres';
    this.schema = this.source === 'supabase' ? 'vibe_teacher' : 'public';
    if (managed && url.hostname.includes('pooler') && url.port === '6543') throw new MemoryDatabaseError('Supabase Connect에서 Session pooler(5432) 주소를 사용해 주세요.');
    if (managed) {
      if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'verify-full');
      if (!url.searchParams.has('sslrootcert')) url.searchParams.set('sslrootcert', fileURLToPath(new URL('../../data/supabase-ca.crt', import.meta.url)));
      if (!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) throw new MemoryDatabaseError('Supabase 연결에는 인증서를 검증하는 TLS 설정을 사용해 주세요.');
      url.searchParams.set('sslmode', 'verify-full');
    }
    if (!url.searchParams.has('connectionTimeoutMillis')) url.searchParams.set('connectionTimeoutMillis', '5000');
    if (!url.searchParams.has('statement_timeout')) url.searchParams.set('statement_timeout', '15000');
    if (this.source === 'supabase') {
      const existing = url.searchParams.get('options') ?? '';
      url.searchParams.set('options', `${existing} --search_path=vibe_teacher,extensions,public`.trim());
    }
    this.connectionString = url.toString();
    // pooler는 여러 프로젝트가 같은 호스트·DB 이름을 공유하므로 프로젝트 부분도 구분한다.
    const tenant = managed && url.hostname.includes('pooler') ? url.username.split('.').slice(1).join('.') : '';
    this.identity = [url.hostname, url.port || '5432', url.pathname, ...(tenant ? [tenant] : []), ...(this.source === 'supabase' ? [this.schema] : [])];
  }

  client(): Client {
    return new Client({ connectionString: this.connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'vibe-teacher' });
  }

  async prepare(): Promise<void> {
    if (!this.preparation) this.preparation = this.initialize().catch((error: unknown) => { this.preparation = undefined; throw error; });
    return this.preparation;
  }

  private async initialize(): Promise<void> {
    const client = this.client();
    try {
      await client.connect();
      const extension = await client.query<{ schema: string }>("SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'");
      const vectorSchema = extension.rows[0]?.schema;
      if (!vectorSchema) throw new MemoryDatabaseError('pgvector 확장이 없습니다. Supabase Database → Extensions에서 vector를 활성화해 주세요.');
      if (this.source === 'supabase') {
        const path = await client.query<{ path: string }>("SELECT current_setting('search_path') AS path");
        if (path.rows[0]?.path.replace(/[\s"]/g, '').split(',')[0] !== this.schema) throw new MemoryDatabaseError('Supabase 연결이 비공개 스키마 설정을 적용하지 않았습니다. Session pooler 또는 Direct connection을 확인해 주세요.');
        if (!['public', 'extensions'].includes(vectorSchema)) throw new MemoryDatabaseError('pgvector는 public 또는 extensions 스키마에 설치해 주세요.');
        await client.query('BEGIN');
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('vibe-teacher-private-schema'))");
          await client.query(`CREATE SCHEMA IF NOT EXISTS ${databaseIdentifier(this.schema)}`);
          // 기존 객체·권한은 바꾸지 않는다. 공개된 스키마라면 저장을 중단한다.
          const exposure = await client.query<{ exposed: boolean }>(`SELECT EXISTS (
            SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n',n.nspowner))) a
            WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE')
          ) OR EXISTS (
            SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(oid,$1,'USAGE')
          ) AS exposed`, [this.schema]);
          if (exposure.rows[0]?.exposed) throw new MemoryDatabaseError('vibe_teacher 스키마가 공개 역할에 노출되어 있어 저장을 중단했습니다. 전용 비공개 스키마의 접근 권한을 확인해 주세요.');
          const schema = await client.query<{ name: string }>('SELECT current_schema() AS name');
          if (schema.rows[0]?.name !== this.schema) throw new MemoryDatabaseError('비공개 스키마에 쓰기 위한 접속 계정 권한을 확인해 주세요.');
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
      const type = await client.query<{ vector: string | null }>("SELECT to_regtype('vector')::text AS vector");
      if (!type.rows[0]?.vector) throw new MemoryDatabaseError('연결 계정에서 pgvector 타입을 찾을 수 없습니다. extensions 스키마 접근 권한을 확인해 주세요.');
    } finally { await client.end().catch(() => {}); }
  }
}

/** 합성 데이터로 쓰기·벡터 검색을 검사하고 임시 테이블은 롤백한다. AI는 호출하지 않는다. */
export async function checkMemoryDatabase(database: MemoryDatabase): Promise<{ source: string; schema: string; tls: boolean; vector: true; writeAndSearch: true; apiRolesBlocked: boolean }> {
  await database.prepare();
  const client = database.client();
  const table = `${databaseIdentifier(database.schema)}.${databaseIdentifier(`vt_connection_check_${randomBytes(8).toString('hex')}`)}`;
  try {
    await client.connect();
    await client.query('BEGIN');
    try {
      // pg_stat_ssl은 pooler 뒤 DB 연결을 나타내므로 클라이언트의 실제 TLS 소켓을 검사한다.
      const socket = client.connection.stream;
      const tls = socket instanceof TLSSocket && socket.encrypted && socket.authorized;
      await client.query(`CREATE TABLE ${table} (value vector(3), payload jsonb)`);
      await client.query(`INSERT INTO ${table} VALUES ($1::vector, $2::jsonb)`, ['[1,0,0]', { kind: 'synthetic-connection-check' }]);
      const result = await client.query<{ distance: number }>(`SELECT value <=> $1::vector AS distance FROM ${table}`, ['[1,0,0]']);
      if (Number(result.rows[0]?.distance) !== 0) throw new MemoryDatabaseError('pgvector 검색 결과를 확인하지 못했습니다.');
      const access = await client.query<{ allowed: boolean }>("SELECT has_schema_privilege(rolname, $1, 'USAGE') AS allowed FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')", [database.schema]);
      return { source: database.source, schema: database.schema, tls, vector: true, writeAndSearch: true, apiRolesBlocked: access.rows.every((role) => !role.allowed) };
    } finally { await client.query('ROLLBACK'); }
  } finally { await client.end().catch(() => {}); }
}

/** 제공자 오류·URL·암호를 그대로 노출하지 않는다. */
export function memoryDatabaseError(error: unknown): string {
  if (error instanceof MemoryDatabaseError) return error.message;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ENETUNREACH') return 'Supabase Direct 주소의 IPv6 경로에 연결할 수 없습니다. Connect → Session pooler(5432) 주소를 사용해 주세요.';
  if (code === '28P01') return 'DB 사용자명 또는 비밀번호가 맞지 않습니다. Supabase의 DB 비밀번호를 확인해 주세요.';
  if (code === '42501') return 'DB 접속 계정에 비공개 스키마·테이블 생성 권한이 없습니다.';
  if (code === '3D000') return '연결 주소의 데이터베이스 이름을 확인해 주세요.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DB 호스트 이름을 확인하거나 DNS 연결을 다시 시도해 주세요.';
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED'].includes(code ?? '')) return 'DB의 TLS 인증서를 검증할 수 없습니다. Supabase의 CA 인증서·sslrootcert 설정을 확인해 주세요.';
  return 'DB 연결 검사에 실패했습니다. 접속 주소·네트워크·인증서·계정 권한을 확인해 주세요.';
}
