-- AI 호출 기록. 202611030001 다음에 SQL Editor에서 한 번 실행한다 (또는 npm run accounts:setup).
-- 앱은 회원 본인 토큰으로 행을 추가만 한다. 회원은 조회·수정·삭제할 수 없고(연습 문항 정답 보호),
-- 관리자는 Supabase 대시보드(SQL Editor·Table Editor)에서 조회한다.
begin;

-- 실제 API 요청 하나(재시도·보조 확인 포함). API 키·인증 헤더는 저장하지 않는다.
create table public.vt_ai_calls (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid,
  feature text check (length(feature) <= 40),
  project_id text check (length(project_id) <= 200),
  session_key text check (length(session_key) <= 2000),
  reader_level text check (length(reader_level) <= 40),
  provider text not null check (length(provider) <= 40),
  task text not null check (length(task) <= 40),
  schema_name text not null check (length(schema_name) <= 120),
  attempt smallint not null default 1,
  output_mode text check (length(output_mode) <= 40),
  requested_model text check (length(requested_model) <= 200),
  model text check (length(model) <= 200),
  generation_id text check (length(generation_id) <= 200),
  status text not null check (status in ('ok', 'error', 'cancelled')),
  error jsonb,
  http_status integer,
  request jsonb not null,
  response jsonb,
  output jsonb,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cached_tokens integer,
  reasoning_tokens integer,
  usage jsonb,
  cost_usd numeric(16, 8),
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index vt_ai_calls_owner_time on public.vt_ai_calls(user_id, created_at desc);
create index vt_ai_calls_run on public.vt_ai_calls(run_id);

-- 사용자 작업 하나(세션 분석, 레포 위키 생성 등)의 최종 결과물. 호출 기록과 run_id로 연결한다.
create table public.vt_ai_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (length(feature) <= 40),
  project_id text check (length(project_id) <= 200),
  session_key text check (length(session_key) <= 2000),
  reader_level text check (length(reader_level) <= 40),
  status text not null check (status in ('done', 'error', 'cancelled')),
  artifact_key text check (length(artifact_key) <= 2000),
  result jsonb,
  error jsonb,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index vt_ai_runs_owner_time on public.vt_ai_runs(user_id, created_at desc);

alter table public.vt_ai_calls enable row level security;
alter table public.vt_ai_runs enable row level security;
create policy ai_call_owner_append on public.vt_ai_calls for insert to authenticated with check (user_id = (select auth.uid()));
create policy ai_run_owner_append on public.vt_ai_runs for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.vt_ai_calls, public.vt_ai_runs from anon, authenticated;
grant insert on public.vt_ai_calls, public.vt_ai_runs to authenticated;

-- 작업별 토큰·요금 합계 (관리자 조회용). 호출 기록이 단일 출처다.
create view public.vt_ai_run_usage with (security_invoker = true) as
select r.id as run_id, r.user_id, r.feature, r.project_id, r.session_key, r.reader_level, r.status, r.artifact_key, r.started_at, r.finished_at,
  count(c.id) as calls,
  coalesce(sum(c.input_tokens), 0) as input_tokens,
  coalesce(sum(c.output_tokens), 0) as output_tokens,
  coalesce(sum(c.total_tokens), 0) as total_tokens,
  sum(c.cost_usd) as cost_usd,
  array_remove(array_agg(distinct c.model), null) as models
from public.vt_ai_runs r
left join public.vt_ai_calls c on c.run_id = r.id and c.user_id = r.user_id
group by r.id;
revoke all on public.vt_ai_run_usage from anon, authenticated;

commit;
