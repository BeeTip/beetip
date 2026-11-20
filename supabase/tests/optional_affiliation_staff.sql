begin;
set local storage.operation = 'object.get_authenticated';
create temporary table checks(label text);
grant all on checks to authenticated, anon;
create function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_label; end if;
  insert into checks values (p_label);
end;
$$;
create function pg_temp.denied(p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_message in sqlerrm) = 0 then raise exception 'Expected %, got %', p_message, sqlerrm; end if;
    insert into checks values (p_message);
    return;
  end;
  raise exception 'Expected denial: %', p_sql;
end;
$$;
create function pg_temp.actor(p_id int, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-' || lpad(p_id::text, 12, '0'),
    'session_id', '10000000-0000-4000-8000-' || lpad(p_id::text, 12, '0'), 'aal', p_aal, 'role', 'authenticated',
    'user_metadata', jsonb_build_object('role','platform_admin','admin',true))::text, true)::text::void;
$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data)
select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'btp03-sql-'||i||'@example.invalid',
  case when i = 7 then null else now() end, i = 8, '{"role":"platform_admin","verified":true}'::jsonb from generate_series(1,8) i;
insert into auth.sessions(id,user_id)
select ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,8) i;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
select ('20000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
  'BTP03 SQL fixture','totp','verified','fixture',now(),now() from generate_series(3,6) i;
insert into public.staff_roles(member_id,role) values
 ('00000000-0000-4000-8000-000000000003','membership_review'),
 ('00000000-0000-4000-8000-000000000004','support'),
 ('00000000-0000-4000-8000-000000000005','finance_operation'),
 ('00000000-0000-4000-8000-000000000006','platform_admin');

set local role authenticated;
select pg_temp.actor(1);
select pg_temp.check((select status = 'approved' from public.members), 'Confirmed account is active without affiliation');
select pg_temp.check(not private.has_staff_role('platform_admin'), 'Forged metadata is not authority');
select pg_temp.check(public.open_support('30000000-0000-4000-8000-000000000001','No affiliation needed') is not null, 'Private support requires no affiliation');
select pg_temp.denied($q$update public.members set status = 'approved'$q$, 'permission denied');
select pg_temp.denied($q$insert into public.staff_roles(member_id,role) values(auth.uid(),'platform_admin')$q$, 'permission denied');
select pg_temp.denied($q$insert into public.affiliation_requests(id,member_id,institution) values(gen_random_uuid(),auth.uid(),'Forged')$q$, 'permission denied');
select pg_temp.check(public.affiliation_command('30000000-0000-4000-8000-000000000002','begin','40000000-0000-4000-8000-000000000001','Campus') = '40000000-0000-4000-8000-000000000001', 'Begin optional request');
select pg_temp.check(public.affiliation_command('30000000-0000-4000-8000-000000000002','begin','40000000-0000-4000-8000-000000000001','Campus') = '40000000-0000-4000-8000-000000000001', 'Exact replay');
select pg_temp.denied($q$select public.affiliation_command('30000000-0000-4000-8000-000000000002','begin','40000000-0000-4000-8000-000000000001','Different')$q$, 'CONFLICT:');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'begin',gen_random_uuid(),'Another')$q$, 'CONFLICT:');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'submit','40000000-0000-4000-8000-000000000001','')$q$, 'VALIDATION:');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'approve','40000000-0000-4000-8000-000000000001','matched')$q$, 'PERMISSION:');
set local storage.operation = 'object.upload';
select pg_temp.denied($q$insert into storage.objects(bucket_id,name,metadata)
  values ('affiliation-evidence','00000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/evidence','{"size":100,"mimetype":"image/png"}')$q$, 'row-level security');
set local role service_role;
insert into storage.objects(bucket_id,name,metadata) values ('affiliation-evidence','00000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/evidence','{"size":100,"mimetype":"image/png"}');
set local role authenticated;
set local storage.operation = 'object.get_authenticated';
select pg_temp.check((select count(*) = 1 from storage.objects where bucket_id = 'affiliation-evidence'), 'Owner reads private evidence');
set local storage.operation = 'object.sign';
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Owner cannot mint a persistent signed download');
set local storage.operation = 'object.sign_many';
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Bulk signed download denied');
set local storage.operation = 'object.get_authenticated';
select pg_temp.actor(2);
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Unrelated account cannot read request');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Unrelated account cannot read evidence');
select pg_temp.denied($q$insert into storage.objects(bucket_id,name) values('affiliation-evidence','00000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/forged')$q$, 'row-level security');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'withdraw','40000000-0000-4000-8000-000000000001','')$q$, 'PERMISSION:');
select pg_temp.actor(3,'aal2');
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Reviewer cannot read draft');
select pg_temp.actor(1);
select public.affiliation_command('30000000-0000-4000-8000-000000000003','submit','40000000-0000-4000-8000-000000000001','');
with updated as (
  update storage.objects set metadata = '{}' where bucket_id = 'affiliation-evidence' returning id
)
select pg_temp.check((select count(*) = 0 from updated), 'Submitted evidence is immutable');
select pg_temp.actor(3);
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'AAL1 reviewer cannot read queue');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'approve','40000000-0000-4000-8000-000000000001','matched')$q$, 'PERMISSION:');
select pg_temp.actor(4,'aal2');
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Support is not affiliation review');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Support cannot read affiliation evidence');
select pg_temp.actor(5,'aal2');
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Finance is not affiliation review');
select pg_temp.actor(6,'aal2');
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Platform administration is not affiliation review');
select pg_temp.denied($q$select public.set_staff_role(gen_random_uuid(),auth.uid(),'membership_review',true,'owner_approved')$q$, 'PERMISSION:');
select pg_temp.denied($q$select public.set_staff_role(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','membership_review',true,'owner_approved')$q$, 'PERMISSION:');
select pg_temp.denied($q$select public.set_staff_role(gen_random_uuid(),'00000000-0000-4000-8000-000000000005','finance_review',true,'owner_approved')$q$, 'CONFLICT:');
select pg_temp.check(public.set_staff_role('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','finance_review',true,'owner_approved') is not null, 'Scoped grant');
select pg_temp.check(public.set_staff_role('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','finance_review',true,'owner_approved') is not null, 'Grant replay');
select pg_temp.denied($q$select public.set_staff_role('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','support',true,'owner_approved')$q$, 'CONFLICT:');
select pg_temp.actor(3,'aal2');
select pg_temp.check((select count(*) = 1 from public.affiliation_requests), 'MFA reviewer reads pending request');
select pg_temp.check((select count(*) = 1 from storage.objects where bucket_id = 'affiliation-evidence'), 'MFA reviewer reads evidence');
select pg_temp.denied($q$select public.set_staff_role(gen_random_uuid(),'00000000-0000-4000-8000-000000000004','support',false,'access_removed')$q$, 'PERMISSION:');
select pg_temp.check(public.affiliation_command('30000000-0000-4000-8000-000000000005','reject','40000000-0000-4000-8000-000000000001','unreadable') is not null, 'Reviewer rejects evidence');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'approve','40000000-0000-4000-8000-000000000001','matched')$q$, 'CONFLICT:');
select pg_temp.actor(1);
select pg_temp.check((select status = 'approved' from public.members), 'Rejection leaves ordinary account active');
select public.affiliation_command('30000000-0000-4000-8000-000000000006','begin','40000000-0000-4000-8000-000000000002','Campus');
set local role service_role;
insert into storage.objects(bucket_id,name,metadata) values ('affiliation-evidence','00000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000002/evidence','{"size":100,"mimetype":"image/png"}');
set local role authenticated;
select public.affiliation_command('30000000-0000-4000-8000-000000000007','submit','40000000-0000-4000-8000-000000000002','');
select pg_temp.actor(3,'aal2');
select pg_temp.check(public.affiliation_command('30000000-0000-4000-8000-000000000008','approve','40000000-0000-4000-8000-000000000002','matched') is not null, 'Reviewer approves separate badge');
set local role postgres;
update public.staff_roles set revoked_at = now() where member_id = '00000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Revoked grant removes reads under same token');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Revoked grant removes evidence under same token');
select pg_temp.denied($q$select public.affiliation_command('30000000-0000-4000-8000-000000000008','approve','40000000-0000-4000-8000-000000000002','matched')$q$, 'PERMISSION:');
select pg_temp.actor(1);
select pg_temp.check((select count(*) = 2 from public.affiliation_requests), 'Owner sees separate decision history');
select public.affiliation_command('30000000-0000-4000-8000-000000000009','withdraw','40000000-0000-4000-8000-000000000002','');
select pg_temp.check((select status = 'approved' from public.members), 'Withdrawal leaves ordinary account active');
set local role postgres;
update public.members set status = 'suspended' where id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.affiliation_requests), 'Suspension removes protected requests');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'affiliation-evidence'), 'Suspension removes private evidence');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'begin',gen_random_uuid(),'Campus')$q$, 'PERMISSION:');
select pg_temp.actor(7);
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'begin',gen_random_uuid(),'Campus')$q$, 'PERMISSION:');
select pg_temp.actor(8);
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'begin',gen_random_uuid(),'Campus')$q$, 'PERMISSION:');
set local role postgres;
delete from auth.sessions where user_id = '00000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.actor(6,'aal2');
select pg_temp.check(not private.has_staff_role('platform_admin'), 'Revoked session removes staff authority');
select pg_temp.denied($q$select public.set_staff_role(gen_random_uuid(),'00000000-0000-4000-8000-000000000004','support',false,'access_removed')$q$, 'PERMISSION:');
set local role anon;
select pg_temp.denied('select * from public.affiliation_requests', 'permission denied');
select pg_temp.denied($q$select public.affiliation_command(gen_random_uuid(),'begin',gen_random_uuid(),'Campus')$q$, 'permission denied');
set local role postgres;
select pg_temp.check((select not public from storage.buckets where id = 'affiliation-evidence'), 'Evidence bucket is private');
select pg_temp.check((select count(*) = 1 from private.audit_events where operation_id = '30000000-0000-4000-8000-000000000002'), 'Exact retry has one audit');
select pg_temp.check(not exists(select 1 from private.audit_events where actor_id::text like '00000000-0000-4000-8000-%' and detail::text like '%Campus%'), 'Audit excludes evidence and institution text');
select count(*) as passed_assertions from checks;
rollback;
