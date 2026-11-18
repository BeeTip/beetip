begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.assert_raises(p_sql text, p_state text, p_message text)
returns void language plpgsql as $$
declare
  v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state or position(p_message in sqlerrm) = 0 then
      raise exception 'Expected % containing %, received %: %', p_state, p_message, sqlstate, sqlerrm;
    end if;
    v_raised := true;
  end;
  perform pg_temp.assert_true(v_raised, 'Expected rejection: ' || p_message);
end;
$$;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, is_anonymous)
values
  ('11111111-1111-4111-8111-111111111111', 'btp02-owner@example.invalid', now(), '{"display_name":"Owner","admin":true,"status":"suspended"}', '{}', false),
  ('22222222-2222-4222-8222-222222222222', 'btp02-other@example.invalid', now(), '{"display_name":"Other"}', '{}', false),
  ('33333333-3333-4333-8333-333333333333', 'btp02-support@example.invalid', now(), '{"display_name":"Support"}', '{}', false),
  ('44444444-4444-4444-8444-444444444444', 'btp02-unconfirmed@example.invalid', null, '{}', '{}', false),
  ('55555555-5555-4555-8555-555555555555', 'btp02-anonymous@example.invalid', now(), '{}', '{}', true);

insert into auth.sessions (id, user_id)
values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('a3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333'),
  ('a4444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444'),
  ('a5555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555');

create temporary table test_support_id (id uuid primary key) on commit drop;
grant all on table test_support_id to authenticated;

set local role anon;
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Anonymous')$q$, '42501', 'permission denied');
select pg_temp.assert_raises('select * from public.messages', '42501', 'permission denied');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1111111-1111-4111-8111-111111111111","aal":"aal1"}';
select pg_temp.assert_true((select status = 'approved' from public.members), 'Account access follows the server default, not editable user metadata');
select pg_temp.assert_true((select count(*) = 1 from public.members), 'Member can read only their profile');
select pg_temp.assert_raises($q$update public.members set status = 'approved'$q$, '42501', 'permission denied');
select pg_temp.assert_raises($q$insert into public.staff_roles (member_id, role) values ('11111111-1111-4111-8111-111111111111', 'support')$q$, '42501', 'permission denied');
select pg_temp.assert_raises($q$select public.open_support(null, 'Message')$q$, 'P0001', 'VALIDATION:');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', '   ')$q$, 'P0001', 'VALIDATION:');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', repeat('a', 1001))$q$, 'P0001', 'VALIDATION:');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', repeat(' ', 1001) || 'x')$q$, 'P0001', 'VALIDATION:');
insert into test_support_id select public.open_support('99999999-9999-4999-8999-999999999999', 'Need help');
select pg_temp.assert_true(public.open_support('99999999-9999-4999-8999-999999999999', 'Need help') = (select id from test_support_id), 'Exact replay returns same thread');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Changed request')$q$, 'P0001', 'CONFLICT:');
select pg_temp.assert_true((select count(*) = 1 from public.conversations), 'Replay does not duplicate conversation');
select pg_temp.assert_true((select count(*) = 1 from public.messages), 'Replay does not duplicate initial message');
select pg_temp.assert_true((select sequence = 1 and body = 'Need help' from public.messages), 'Initial message is ordered and durable');
select pg_temp.assert_raises($q$insert into public.messages(conversation_id, sequence, sender_id, body) select id, 2, '11111111-1111-4111-8111-111111111111', 'Bypass' from test_support_id$q$, '42501', 'permission denied');

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"a2222222-2222-4222-8222-222222222222","aal":"aal1"}';
select pg_temp.assert_true((select count(*) = 0 from public.conversations), 'Unrelated user cannot read conversation');
select pg_temp.assert_true((select count(*) = 0 from public.messages), 'Unrelated user cannot read messages');
select pg_temp.assert_true(public.open_support('99999999-9999-4999-8999-999999999999', 'Other member') <> (select id from test_support_id), 'Operation IDs are actor scoped');

set local role postgres;
insert into public.staff_roles(member_id, role) values ('33333333-3333-4333-8333-333333333333', 'support');
insert into public.conversation_members(conversation_id, member_id, role)
select id, '33333333-3333-4333-8333-333333333333', 'support' from test_support_id;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","session_id":"a3333333-3333-4333-8333-333333333333","aal":"aal1"}';
select pg_temp.assert_true((select count(*) = 0 from public.messages), 'Support staff need MFA');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","session_id":"a3333333-3333-4333-8333-333333333333","aal":"aal2"}';
select pg_temp.assert_true((select count(*) = 1 from public.messages), 'Assigned MFA support staff can read case');
set local role postgres;
update public.staff_roles set revoked_at = now() where member_id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.messages), 'Role revocation removes case access immediately');
set local role postgres;
update public.staff_roles set revoked_at = null where member_id = '33333333-3333-4333-8333-333333333333';
update public.conversation_members set revoked_at = now() where member_id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.messages), 'Assignment revocation removes case access');

set local role postgres;
update public.members set status = 'suspended' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1111111-1111-4111-8111-111111111111","aal":"aal1"}';
select pg_temp.assert_true((select status = 'suspended' from public.members), 'Suspended member can see their account status');
select pg_temp.assert_true((select count(*) = 0 from public.messages), 'Suspended member cannot read messages');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Need help')$q$, 'P0001', 'PERMISSION:');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","session_id":"a4444444-4444-4444-8444-444444444444","aal":"aal1"}';
select pg_temp.assert_true((select count(*) = 0 from public.members), 'Unconfirmed identity cannot read account');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Unconfirmed')$q$, 'P0001', 'PERMISSION:');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","session_id":"a5555555-5555-4555-8555-555555555555","aal":"aal1"}';
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Anonymous identity')$q$, 'P0001', 'PERMISSION:');

set local role postgres;
delete from auth.sessions where id = 'a2222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"a2222222-2222-4222-8222-222222222222","aal":"aal1"}';
select pg_temp.assert_true((select count(*) = 0 from public.conversations), 'Revoked session loses history');
select pg_temp.assert_raises($q$select public.open_support('99999999-9999-4999-8999-999999999999', 'Other member')$q$, 'P0001', 'PERMISSION:');

set local role postgres;
select pg_temp.assert_true((select count(*) = 2 from private.operation_receipts where operation_id = '99999999-9999-4999-8999-999999999999'), 'Only committed actors have receipts');
select pg_temp.assert_true((select count(*) = 2 from private.audit_events where event_type = 'support_opened' and operation_id = '99999999-9999-4999-8999-999999999999'), 'One audit per successful actor operation');
select 'identity_private_support assertions passed' as result;
rollback;
