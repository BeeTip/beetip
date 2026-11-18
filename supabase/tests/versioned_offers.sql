begin;
create temporary table checks(label text);
grant all on checks to authenticated,anon;
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
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'btp05-sql-'||i||'@example.invalid',now(),false from generate_series(1,3)i;
insert into auth.sessions(id,user_id)
select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,3)i;
insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
values('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','request','BTP05 SQL listing','Warung','Makanan','Alam Sutera','PRIVATE SQL DESTINATION',
  '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,10000,true,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.check(public.save_offer('30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,1,6000,'save') is not null,'Create offer');
select pg_temp.check(public.save_offer('30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,1,6000,'save') is not null,'Exact replay');
select pg_temp.denied($q$select public.save_offer('30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',0,1,7000,'save')$q$,'CONFLICT:');
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),gen_random_uuid(),'40000000-0000-4000-8000-000000000001',0,1,6000,'save')$q$,'CONFLICT:');
select pg_temp.check((select count(*)=1 from public.offer_revisions),'One revision after replay');
select pg_temp.denied($q$update public.offers set fee=0$q$,'permission denied');
select pg_temp.denied($q$delete from public.offer_revisions$q$,'permission denied');
select pg_temp.check(public.browse_offers()::text not like '%PRIVATE SQL DESTINATION%','Projection excludes address');
select pg_temp.denied($q$select public.browse_offers(null,now(),null)$q$,'VALIDATION:');
select pg_temp.actor(3);
select pg_temp.check((select count(*)=0 from public.offers),'Unrelated offer RLS');
select pg_temp.check((select count(*)=0 from public.offer_revisions),'Unrelated history RLS');
select pg_temp.check(jsonb_array_length(public.browse_offers('40000000-0000-4000-8000-000000000001'))=0,'Unrelated projection');
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,1,6000,'withdraw')$q$,'PERMISSION:');
select pg_temp.actor(1);
select pg_temp.check((select count(*)=1 from public.offers),'Owner review RLS');
select pg_temp.check((select count(*)=1 from public.offer_revisions),'Owner history RLS');
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),gen_random_uuid(),'40000000-0000-4000-8000-000000000001',0,1,6000,'save')$q$,'PERMISSION:');
reset role;
update public.listings set version=2,start_at=start_at+interval '1 day',end_at=end_at+interval '1 day';
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,1,6000,'save')$q$,'CONFLICT:');
select pg_temp.check(public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,2,7000,'save') is not null,'Renewed consent');
select pg_temp.check((select count(*)=2 from public.offer_revisions),'Append-only revisions');
select pg_temp.check((select fee=6000 and listing_version=1 from public.offer_revisions where version=1),'Original terms preserved');
reset role;
update public.listings set status='paused',version=3;
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',2,3,7000,'save')$q$,'CONFLICT:');
select pg_temp.check(public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',2,2,7000,'withdraw') is not null,'Withdrawal after pause without new consent');
select pg_temp.denied($q$select public.save_offer(gen_random_uuid(),'50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',3,3,7000,'save')$q$,'CONFLICT:');
reset role;
update public.listings set status='active';
set local role authenticated;
select pg_temp.actor(2);
do $$
declare v_id uuid;
begin
  for i in 1..22 loop
    v_id := gen_random_uuid();
    perform public.save_offer(gen_random_uuid(),v_id,'40000000-0000-4000-8000-000000000001',0,3,6000,'save');
    perform public.save_offer(gen_random_uuid(),v_id,'40000000-0000-4000-8000-000000000001',1,3,6000,'withdraw');
  end loop;
end;
$$;
reset role;
update public.offers set created_at=now();
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.check(jsonb_array_length(public.browse_offers())=21,'Bounded projection including continuation row');
select pg_temp.check(jsonb_array_length(public.browse_offers(null,now(),(public.browse_offers()->19->>'id')::uuid))=3,'Tied timestamp cursor preserves remaining rows');
select pg_temp.check((select count(distinct value->>'id')=23 from jsonb_array_elements(
  (public.browse_offers()-20)||public.browse_offers(null,now(),(public.browse_offers()->19->>'id')::uuid))),'No cursor duplicates or missing offers');
reset role;
delete from auth.sessions where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.denied($q$select public.browse_offers()$q$,'PERMISSION:');
select pg_temp.check((select count(*)=0 from public.offers),'Revoked session raw read denied');
set local role anon;
select pg_temp.denied($q$select public.browse_offers()$q$,'permission denied');
select pg_temp.denied($q$select * from public.offers$q$,'permission denied');
reset role;
select count(*) as passed_assertions from checks;
rollback;
