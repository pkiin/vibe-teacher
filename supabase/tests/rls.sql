-- 마이그레이션을 적용한 폐기 가능한 검증용 DB에서만 실행한다.
-- psql -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" -f supabase/tests/rls.sql
-- 합성 회원과 모든 쓰기는 마지막에 롤백한다. 실제 회원 데이터를 사용하지 않는다.
begin;
insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test');
update public.vt_members set is_admin = true where user_id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into public.vt_documents values ('11111111-1111-4111-8111-111111111111', 'onboarding', '{"stage":"idea"}');
insert into public.vt_events(user_id, key, value) values ('11111111-1111-4111-8111-111111111111', 'events', '{"id":"synthetic"}');
do $$ begin
  if (select count(*) from public.vt_members) <> 1 then raise exception 'FAIL: 회원 읽기 격리'; end if;
  begin
    update public.vt_members set approved = true;
    raise exception 'FAIL: 본인 승인';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vt_list_members();
    raise exception 'FAIL: 비관리자 목록 조회';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.vt_documents values ('22222222-2222-4222-8222-222222222222', 'forged', '{}');
    raise exception 'FAIL: 타인 데이터 삽입';
  exception when insufficient_privilege then null; end;
  if not public.vt_lock('learner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'FAIL: 잠금 획득'; end if;
  if public.vt_lock('learner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'FAIL: 동시 잠금'; end if;
  perform public.vt_unlock('learner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if public.vt_lock('learner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'FAIL: 타 토큰 잠금 해제'; end if;
  perform public.vt_unlock('learner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if (select count(*) from public.vt_documents) <> 0 then raise exception 'FAIL: 관리자 타인 문서 조회'; end if;
  if (select count(*) from public.vt_events) <> 0 then raise exception 'FAIL: 관리자 타인 원장 조회'; end if;
  if (select count(*) from public.vt_list_members()) <> 2 then raise exception 'FAIL: 관리자 회원 목록'; end if;
  perform public.vt_update_member('11111111-1111-4111-8111-111111111111', true, array['account-a']);
  begin
    perform public.vt_update_member('22222222-2222-4222-8222-222222222222', true, array['account-a']);
    raise exception 'FAIL: 계정 중복 배정 허용';
  exception when raise_exception then
    if sqlerrm <> '이미 연결된 계정입니다' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$ begin
  if not (select approved from public.vt_members) then raise exception 'FAIL: 승인 반영'; end if;
end $$;
rollback;
select 'PASS: 회원·승인·RLS·쓰기 잠금';
