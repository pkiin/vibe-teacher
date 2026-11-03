-- Supabase SQL Editor에서 한 번 실행한다. 기존 로컬 파일과 메모리 DB는 변경하지 않는다.
begin;

create table public.vt_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  approved boolean not null default false,
  is_admin boolean not null default false,
  account_ids text[] not null default '{}'
);
alter table public.vt_members enable row level security;
create policy member_self on public.vt_members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.vt_members from anon, authenticated;
grant select on public.vt_members to authenticated;

create function public.vt_new_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vt_members(user_id, email) values (new.id, coalesce(new.email, '')) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.vt_new_member() from public, anon, authenticated;
create trigger vt_signup after insert on auth.users for each row execute function public.vt_new_member();
insert into public.vt_members(user_id, email) select id, coalesce(email, '') from auth.users on conflict (user_id) do nothing;

create table public.vt_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 2000),
  value jsonb not null,
  primary key (user_id, key)
);
create table public.vt_events (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 2000),
  value jsonb not null
);
create index vt_events_owner_key on public.vt_events(user_id, key, seq);
alter table public.vt_documents enable row level security;
alter table public.vt_events enable row level security;
create policy document_owner on public.vt_documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy event_owner_read on public.vt_events for select to authenticated using (user_id = (select auth.uid()));
create policy event_owner_append on public.vt_events for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.vt_documents, public.vt_events from anon, authenticated;
grant select, insert, update on public.vt_documents to authenticated;
grant select, insert on public.vt_events to authenticated;
grant usage on sequence public.vt_events_seq_seq to authenticated;

-- 공용 서버와 로컬이 동시에 같은 원장을 갱신하지 않도록 사용자별 쓰기 잠금을 둔다.
-- 잠금은 짧은 저장 작업에만 사용하며 AI 호출 중에는 잡지 않는다.
create table public.vt_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  token uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, key)
);
alter table public.vt_locks enable row level security;
revoke all on public.vt_locks from anon, authenticated;
create function public.vt_lock(lock_key text, lock_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare acquired boolean;
begin
  if auth.uid() is null or length(lock_key) not between 1 and 2000 then raise exception '권한 또는 잠금 키 오류'; end if;
  insert into public.vt_locks(user_id, key, token, expires_at)
    values (auth.uid(), lock_key, lock_token, now() + interval '5 minutes')
    on conflict (user_id, key) do update set token = excluded.token, expires_at = excluded.expires_at
      where public.vt_locks.expires_at < now()
    returning true into acquired;
  return coalesce(acquired, false);
end;
$$;
create function public.vt_unlock(lock_key text, lock_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.vt_locks where user_id = auth.uid() and key = lock_key and token = lock_token;
$$;

-- 승인 여부·관리자 여부·OS 계정 연결은 사용자 본인이 수정할 수 없다.
create function public.vt_list_members() returns setof public.vt_members
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vt_members where user_id = auth.uid() and is_admin) then raise insufficient_privilege; end if;
  return query select * from public.vt_members order by email;
end;
$$;
create function public.vt_update_member(target_user uuid, allow_ai boolean, accounts text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vt_members where user_id = auth.uid() and is_admin) then raise insufficient_privilege; end if;
  -- 다른 회원에게 이미 연결한 OS 계정을 중복 배정하지 않는다.
  perform pg_catalog.pg_advisory_xact_lock(261103001);
  if exists (select 1 from public.vt_members where user_id <> target_user and account_ids && accounts) then raise exception '이미 연결된 계정입니다'; end if;
  update public.vt_members set approved = allow_ai, account_ids = accounts where user_id = target_user;
  if not found then raise exception '가입한 사용자를 찾을 수 없습니다'; end if;
end;
$$;
revoke all on function public.vt_lock(text, uuid), public.vt_unlock(text, uuid), public.vt_list_members(), public.vt_update_member(uuid, boolean, text[]) from public, anon;
grant execute on function public.vt_lock(text, uuid), public.vt_unlock(text, uuid), public.vt_list_members(), public.vt_update_member(uuid, boolean, text[]) to authenticated;

commit;
