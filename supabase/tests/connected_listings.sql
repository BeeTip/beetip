begin;
create temporary table checks(label text);
grant all on checks to authenticated, anon;
create function pg_temp.check(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'FAILED: %',p_label; end if;
  insert into checks values(p_label);
end;
$$;
create function pg_temp.denied(p_sql text,p_message text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)=0 then raise exception 'Expected %, got %',p_message,sqlerrm; end if;
    insert into checks values(p_message); return;
  end;
  raise exception 'Expected denial: %',p_sql;
end;
$$;
create function pg_temp.actor(p_id int) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),
    'session_id','10000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),'aal','aal1','role','authenticated')::text,true)::text::void;
$$;
create function pg_temp.payload() returns jsonb language sql as $$
  select jsonb_build_object('type','request','title','BTP04 SQL request','shop','Warung sintetis','category','Makanan','area','Alam Sutera','destination','PRIVATE ADDRESS SQL',
    'items',jsonb_build_array(jsonb_build_object('name','Nasi','specification','Tanpa pedas','quantity',2,'unitBudget',20000)),
    'fee',5000,'bound',5000,'negotiable',false,'capacity',1,'spendingCapacity',150000,
    'start',now()+interval '1 day','end',now()+interval '25 hours','cutoff',now()+interval '23 hours','status','active');
$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'btp04-sql-'||i||'@example.invalid',case when i=3 then null else now() end,i=4 from generate_series(1,4)i;
insert into auth.sessions(id,user_id)
select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,4)i;
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.check(public.save_listing('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,pg_temp.payload()) is not null,'Create request without affiliation');
select pg_temp.check(public.save_listing('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,pg_temp.payload()) is not null,'Exact replay');
select pg_temp.check((select count(*)=1 from public.listings),'Owner reads one row');
select pg_temp.denied($q$select public.save_listing('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,pg_temp.payload()||'{"fee":6000,"bound":6000}')$q$,'CONFLICT:');
select pg_temp.denied($q$update public.listings set owner_id=auth.uid()$q$,'permission denied');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload()||'{"owner_id":"forged"}')$q$,'VALIDATION:');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload()||'{"fee":1.5}')$q$,'VALIDATION:');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload()||'{"capacity":3}')$q$,'VALIDATION:');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,jsonb_set(pg_temp.payload(),'{items,0,quantity}','50'))$q$,'VALIDATION:');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,jsonb_set(pg_temp.payload(),'{start}',to_jsonb(now()-interval '1 day')))$q$,'VALIDATION:');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload()||'{"items":null}')$q$,'VALIDATION:');
select pg_temp.check(public.save_listing(gen_random_uuid(),'40000000-0000-4000-8000-000000000001',1,pg_temp.payload()||'{"type":"trip","capacity":3,"negotiable":true,"bound":4000}') is not null,'Owner changes trip terms');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),'40000000-0000-4000-8000-000000000001',1,pg_temp.payload())$q$,'CONFLICT:');
select pg_temp.actor(2);
select pg_temp.check((select count(*)=0 from public.listings),'Unrelated session cannot read base rows');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),'40000000-0000-4000-8000-000000000001',2,pg_temp.payload())$q$,'PERMISSION:');
select pg_temp.actor(3);
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload())$q$,'PERMISSION:');
select pg_temp.actor(4);
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload())$q$,'PERMISSION:');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.check(jsonb_array_length(public.browse_listings(p_search=>'BTP04 SQL'))=1,'Anonymous public board');
select pg_temp.check(public.browse_listings(p_search=>'BTP04 SQL')::text not like '%PRIVATE ADDRESS SQL%','No private address');
select pg_temp.check(not ((public.browse_listings(p_search=>'BTP04 SQL')->0) ? 'owner_id'),'No owner identifier');
select pg_temp.check(jsonb_array_length(public.browse_listings(p_search=>'BTP04 SQL',p_type=>'request'))=0,'Type filter');
select pg_temp.check(jsonb_array_length(public.browse_listings(p_search=>'BTP04 SQL',p_day=>current_date-1))=0,'Schedule filter');
select pg_temp.denied($q$select * from public.listings$q$,'permission denied');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload())$q$,'permission denied');
reset role;
update public.members set status='suspended' where id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.check((select count(*)=0 from public.listings),'Suspension hides private rows');
select pg_temp.check(jsonb_array_length(public.browse_listings(p_search=>'BTP04 SQL'))=0,'Suspension hides public listings');
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload())$q$,'PERMISSION:');
reset role;
update public.members set status='approved' where id='00000000-0000-4000-8000-000000000001';
delete from auth.sessions where user_id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.denied($q$select public.save_listing(gen_random_uuid(),gen_random_uuid(),0,pg_temp.payload())$q$,'PERMISSION:');
reset role;
select pg_temp.check((select count(*)=2 from private.audit_events where target_id='40000000-0000-4000-8000-000000000001'),'Only successful create/edit are audited');
select count(*) as passed_checks from checks;
rollback;
