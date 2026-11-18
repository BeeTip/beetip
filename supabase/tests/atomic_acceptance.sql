begin;
create temporary table acceptance_checks(label text);
grant all on acceptance_checks to authenticated,anon;
create function pg_temp.accept_check(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'FAILED: %',p_label; end if;
  insert into acceptance_checks values(p_label);
end;
$$;
create function pg_temp.accept_denied(p_sql text,p_message text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)=0 then raise exception 'Expected %, got %',p_message,sqlerrm; end if;
    insert into acceptance_checks values(p_message); return;
  end;
  raise exception 'Expected denial: %',p_sql;
end;
$$;
create function pg_temp.accept_actor(p_id int) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub','06000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),
    'session_id','16000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),'aal','aal1','role','authenticated')::text,true)::text::void;
$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('06000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'btp06-sql-'||i||'@example.invalid',now(),false from generate_series(1,3)i;
insert into auth.sessions(id,user_id)
select ('16000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('06000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,3)i;
insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
values('46000000-0000-4000-8000-000000000001','06000000-0000-4000-8000-000000000001','request','BTP06 SQL listing','Warung','Makanan','Alam Sutera','PRIVATE ACCEPTED DESTINATION',
  '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');
create temporary table accepted(id uuid);
grant all on accepted to authenticated;
set local role authenticated;
select pg_temp.accept_actor(1);
select pg_temp.accept_denied($q$select public.accept_order(gen_random_uuid(),'46000000-0000-4000-8000-000000000001',1)$q$,'PERMISSION:');
select pg_temp.accept_actor(2);
insert into accepted select public.accept_order('36000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001',1);
select pg_temp.accept_check(public.accept_order('36000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001',1)=(select id from accepted),'exact replay');
select pg_temp.accept_denied($q$select public.accept_order('36000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001',2)$q$,'CONFLICT:');
select pg_temp.accept_check((select count(*)=1 from public.orders where id=(select id from accepted)),'participant order read');
select pg_temp.accept_check((select count(*)=1 from public.order_terms where order_id=(select id from accepted)),'participant snapshot read');
select pg_temp.accept_check((select count(*)=1 from public.reservations where order_id=(select id from accepted)),'participant reservation read');
select pg_temp.accept_check((select count(*)=2 from public.conversation_members where conversation_id=(select conversation_id from public.orders where id=(select id from accepted))),'two conversation members');
select pg_temp.accept_denied($q$update public.orders set state='cancelled'$q$,'permission denied');
select pg_temp.accept_denied($q$delete from public.order_terms$q$,'permission denied');
select pg_temp.accept_denied($q$select * from private.operation_receipts$q$,'permission denied');
select pg_temp.accept_actor(3);
select pg_temp.accept_check((select count(*)=0 from public.orders where id=(select id from accepted)),'unrelated order isolation');
select pg_temp.accept_denied($q$select public.read_order((select id from accepted))$q$,'PERMISSION:');
select pg_temp.accept_denied($q$select public.accept_order(gen_random_uuid(),'46000000-0000-4000-8000-000000000001',1)$q$,'CONFLICT:');
reset role;
select pg_temp.accept_check((select count(*)=1 from private.audit_events where target_id=(select id from accepted)),'one audit fact');
select pg_temp.accept_check((select count(*)=1 from private.acceptance_notification_intents where order_id=(select id from accepted) and recipient_id='06000000-0000-4000-8000-000000000001'),'counterparty intent without self notification');
select pg_temp.accept_check((select result_id=(select id from accepted) from private.operation_receipts where actor_id='06000000-0000-4000-8000-000000000002' and operation_id='36000000-0000-4000-8000-000000000001'),'receipt committed result');
select pg_temp.accept_denied($q$update public.order_terms set terms='{}' where order_id=(select id from accepted)$q$,'immutable');
delete from auth.sessions where id='16000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.accept_actor(2);
select pg_temp.accept_denied($q$select public.read_order((select id from accepted))$q$,'PERMISSION:');
reset role;
select count(*) as passed_acceptance_assertions from acceptance_checks;
rollback;
