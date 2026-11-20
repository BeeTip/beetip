begin;
create temporary table notification_checks(label text);
grant all on notification_checks to authenticated,anon;
create function pg_temp.check(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'FAILED: %',p_label; end if;
  insert into notification_checks values(p_label);
end;
$$;
create function pg_temp.denied(p_sql text,p_message text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)=0 then raise exception 'Expected %, got %',p_message,sqlerrm; end if;
    insert into notification_checks values(p_message); return;
  end;
  raise exception 'Expected denial: %',p_sql;
end;
$$;
create function pg_temp.actor(p_id int,p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub','b1000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),
    'session_id','b2000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),'aal',p_aal,'role','authenticated')::text,true)::text::void;
$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'btp10-sql-'||i||'@example.invalid',now(),false from generate_series(1,4)i;
insert into auth.sessions(id,user_id)
select ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,4)i;
insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
values('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','request','BTP10 SQL listing','Warung','Makanan','Alam Sutera','PRIVATE ADDRESS',
  '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,10000,true,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');
set local role authenticated;
select pg_temp.actor(2);
select public.save_offer('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',0,1,6000,'save');
select public.save_offer('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',0,1,6000,'save');
select pg_temp.check((select count(*)=0 from public.notifications),'No self-notification');
select pg_temp.denied($q$select private.enqueue_notification(gen_random_uuid(),'offer_received',gen_random_uuid(),null,'{}'::uuid[])$q$,'permission denied');
select pg_temp.actor(1);
select pg_temp.check((select count(*)=1 from public.notifications),'One durable owner notification after exact replay');
select pg_temp.check(public.notification_inbox()->>'unread'='1','Unread indicator');
select pg_temp.check(public.notification_inbox()::text not like '%PRIVATE ADDRESS%','Inbox redacts business payload');
select pg_temp.check(public.notification_target((select id from public.notifications))='/account/offers?listing=b4000000-0000-4000-8000-000000000001','Authorized target');
select public.read_notification((select id from public.notifications));
create temporary table first_read as select id,read_at from public.notifications;
select public.read_notification((select id from public.notifications));
select pg_temp.check((select n.read_at=r.read_at from public.notifications n join first_read r using(id)),'Read timestamp is monotonic and immutable');
select pg_temp.check(public.notification_inbox()->>'unread'='0','Unread decreases after read');
select pg_temp.denied($q$update public.notifications set read_at=null$q$,'permission denied');
select pg_temp.denied($q$insert into public.notification_preferences values(auth.uid(),'offer_received',false)$q$,'permission denied');
select public.set_notification_preference('offer_received',false);
select pg_temp.check((select not email_enabled from public.notification_preferences),'Own preference persists');
select pg_temp.denied($q$select public.set_notification_preference('unknown',true)$q$,'VALIDATION:');
select pg_temp.denied($q$select public.notification_inbox(now(),null)$q$,'VALIDATION:');
reset role;
select pg_temp.check((select count(*)=2 from private.notification_delivery_intents where recipient_id='b1000000-0000-4000-8000-000000000001'),'One intent per event recipient channel');
create temporary table owner_notification as select id from public.notifications where recipient_id='b1000000-0000-4000-8000-000000000001';
select pg_temp.check(not private.notification_email_allowed((select id from owner_notification)),'Read or opted-out email suppressed');
grant select on owner_notification to authenticated;
set local role authenticated;
select pg_temp.actor(3);
select pg_temp.check((select count(*)=0 from public.notifications),'Unrelated member RLS');
select pg_temp.denied($q$select public.notification_target((select id from owner_notification))$q$,'PERMISSION:');
select pg_temp.denied($q$select public.read_notification((select id from owner_notification))$q$,'PERMISSION:');
select pg_temp.check((select count(*)=0 from public.notification_preferences),'Private preferences');
reset role;
update public.members set status='suspended' where id='b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.check((select count(*)=0 from public.notifications),'Suspension hides old records');
select pg_temp.denied($q$select public.notification_inbox()$q$,'PERMISSION:');
reset role;
update public.members set status='approved' where id='b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(2);
select public.save_offer(gen_random_uuid(),'b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',1,1,7000,'save');
select public.save_offer(gen_random_uuid(),'b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',2,1,7000,'withdraw');
reset role;
select pg_temp.check((select count(*)=1 from public.notifications where event_type='offer_changed'),'Changed offer mapping');
select pg_temp.check((select count(*)=1 from public.notifications where event_type='offer_withdrawn'),'Withdrawal mapping');
do $$
declare v_event uuid:=gen_random_uuid(); v_before bigint;
begin
  select count(*) into v_before from public.notifications;
  begin
    perform private.enqueue_notification(v_event,'offer_received','b5000000-0000-4000-8000-000000000001',null,array['b1000000-0000-4000-8000-000000000001'::uuid]);
    raise exception 'rollback fixture';
  exception when raise_exception then null;
  end;
  perform pg_temp.check((select count(*)=v_before from public.notifications),'Transaction rollback removes notification');
  perform pg_temp.check(not exists(select 1 from private.notification_delivery_intents where event_id=v_event),'Rollback removes delivery intents');
end;
$$;
insert into public.staff_roles(member_id,role) values('b1000000-0000-4000-8000-000000000003','support');
insert into auth.mfa_factors(id,user_id,status,factor_type,friendly_name,secret,created_at,updated_at)
values(gen_random_uuid(),'b1000000-0000-4000-8000-000000000003','verified','totp','btp10','fixture',now(),now());
set local role authenticated;
select pg_temp.actor(2);
select public.open_support(gen_random_uuid(),'PRIVATE SUPPORT BODY');
select pg_temp.actor(3);
select pg_temp.check((select count(*)=0 from public.notifications),'Staff MFA session required');
select pg_temp.actor(3,'aal2');
select pg_temp.check((select count(*)=1 from public.notifications),'Live operator receives queue alert');
select pg_temp.check(public.notification_inbox()::text not like '%PRIVATE SUPPORT BODY%','Queue alert omits message');
reset role;
create temporary table queue_notification as select id,target_id from public.notifications where event_type='support_opened' and recipient_id='b1000000-0000-4000-8000-000000000003';
grant select on queue_notification to authenticated;
select pg_temp.actor(1);
insert into public.conversation_members(conversation_id,member_id,role)
select target_id,'b1000000-0000-4000-8000-000000000003','support' from queue_notification;
select pg_temp.check(not private.notification_email_allowed((select id from queue_notification)),'Assigned queue email suppressed');
set local role authenticated;
select pg_temp.actor(3,'aal2');
select pg_temp.denied($q$select public.notification_target((select id from queue_notification))$q$,'PERMISSION:');
select pg_temp.check((select count(*)=1 from public.notifications where event_type='support_assigned'),'Assignment recipient mapping');
reset role;
create temporary table assigned_notification as select id from public.notifications where event_type='support_assigned' and recipient_id='b1000000-0000-4000-8000-000000000003';
grant select on assigned_notification to authenticated;
update public.conversation_members set revoked_at=now() where member_id='b1000000-0000-4000-8000-000000000003';
select pg_temp.check(not private.notification_email_allowed((select id from assigned_notification)),'Assignment revocation suppresses delivery');
set local role authenticated;
select pg_temp.actor(3,'aal2');
select pg_temp.denied($q$select public.notification_target((select id from assigned_notification))$q$,'PERMISSION:');
reset role;
update public.staff_roles set revoked_at=now() where member_id='b1000000-0000-4000-8000-000000000003';
select pg_temp.check(not private.notification_email_allowed((select id from queue_notification)),'Role revocation suppresses delivery');
set local role anon;
select pg_temp.denied($q$select public.notification_inbox()$q$,'permission denied');
select pg_temp.denied($q$select * from public.notifications$q$,'permission denied');
reset role;
do $$
declare i integer; v_time timestamptz:=clock_timestamp(); v_page jsonb; v_last jsonb;
begin
  for i in 1..25 loop
    perform private.enqueue_notification(gen_random_uuid(),'staff_role_changed','b1000000-0000-4000-8000-000000000001',null,array['b1000000-0000-4000-8000-000000000001'::uuid]);
  end loop;
  update public.notifications set created_at=v_time where recipient_id='b1000000-0000-4000-8000-000000000001';
  perform pg_temp.actor(1);
  v_page:=private.notification_inbox();
  perform pg_temp.check(jsonb_array_length(v_page->'items')=21,'Bounded page includes lookahead');
  v_last:=v_page->'items'->19;
  v_page:=private.notification_inbox((v_last->>'created_at')::timestamptz,(v_last->>'id')::uuid);
  perform pg_temp.check(jsonb_array_length(v_page->'items')=8,'Equal timestamp keyset returns remaining rows');
end;
$$;
insert into public.affiliation_requests(id,member_id,institution,status)
values('b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','BTP10 fixture','pending');
insert into public.staff_roles(member_id,role) values('b1000000-0000-4000-8000-000000000003','membership_review');
set local role authenticated;
select pg_temp.actor(3,'aal2');
select public.affiliation_command(gen_random_uuid(),'approve','b6000000-0000-4000-8000-000000000001','matched');
select pg_temp.actor(2);
select pg_temp.check((select count(*)=1 from public.notifications where event_type='affiliation_decided'),'Decision transaction mapping');
reset role;
do $$
declare v_notification uuid;
begin
  select id into strict v_notification from public.notifications where event_type='offer_changed';
  perform pg_temp.check(private.notification_email_allowed(v_notification),'Unread default email eligible');
  perform pg_temp.actor(1);
  perform public.set_notification_preference('offer_changed',false);
  perform pg_temp.check(not private.notification_email_allowed(v_notification),'Preference suppresses unread email independently');
  perform public.set_notification_preference('offer_changed',true);
  perform pg_temp.check(private.notification_email_allowed(v_notification),'Preference can re-enable pending summary');
end;
$$;
do $$
declare v_order uuid; v_replay uuid; v_operation uuid:=gen_random_uuid(); v_offer uuid:=gen_random_uuid();
begin
  if to_regclass('private.acceptance_notification_intents') is null then return; end if;
  perform pg_temp.actor(2);
  perform public.save_offer(gen_random_uuid(),v_offer,'b4000000-0000-4000-8000-000000000001',0,1,6000,'save');
  perform pg_temp.actor(1);
  execute 'select public.accept_order($1,$2,1,$3,1)' into v_order using v_operation,'b4000000-0000-4000-8000-000000000001'::uuid,v_offer;
  execute 'select public.accept_order($1,$2,1,$3,1)' into v_replay using v_operation,'b4000000-0000-4000-8000-000000000001'::uuid,v_offer;
  perform pg_temp.check(v_order=v_replay,'Acceptance exact replay');
  perform pg_temp.check((select count(*)=1 from public.notifications where event_id=v_order and event_type='order_accepted'),'Acceptance bridge no self or duplicate');
  perform pg_temp.check((select count(*)=2 from private.notification_delivery_intents where event_id=v_order),'Acceptance channel uniqueness');
  perform pg_temp.actor(2);
  perform pg_temp.check(private.notification_target((select id from public.notifications where event_id=v_order))='/orders/'||v_order::text,'Acceptance current-party target');
  perform private.enqueue_notification(v_order,'order_accepted',v_order,null,array['b1000000-0000-4000-8000-000000000002'::uuid]);
  perform pg_temp.check((select count(*)=1 from public.notifications where event_id=v_order),'Acceptance backfill is idempotent');
  perform pg_temp.actor(4);
  perform pg_temp.check(not private.notification_target_allowed(auth.uid(),'order_accepted',v_order),'Unrelated order target denied');
end;
$$;
select count(*) as passed_notification_checks from notification_checks;
rollback;
