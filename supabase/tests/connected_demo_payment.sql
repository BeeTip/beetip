begin;

insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('31000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'demo-sql-'||i||'@example.invalid',now(),false
from generate_series(1,3)i;
insert into auth.sessions(id,user_id)
select ('32000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('31000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
from generate_series(1,3)i;
insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
values('33000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','request','Demo test','Warung','Makanan','Alam Sutera','Kampus',
  '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,
  now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');

create function pg_temp.demo_actor(p_id int) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub','31000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),
    'session_id','32000000-0000-4000-8000-'||lpad(p_id::text,12,'0'),'aal','aal1','role','authenticated')::text,true)::text::void;
$$;
create temporary table demo_order (id uuid);
grant select,insert on demo_order to authenticated;

set local role authenticated;
select pg_temp.demo_actor(2);
insert into demo_order select public.accept_order(gen_random_uuid(),'33000000-0000-4000-8000-000000000001',1);
do $$
declare v_order uuid := (select id from demo_order); v_data jsonb;
begin
  v_data := public.read_order(v_order);
  if v_data->>'state' is distinct from 'booth_awaiting_payment' then
    raise exception 'Ordinary connected accounts need simulated checkout, got %',v_data->>'state';
  end if;
  if (v_data->>'canSimulatePayment')::boolean is distinct from false then raise exception 'Provider must wait'; end if;
  begin
    perform public.confirm_booth_payment(v_order);
    raise exception 'Provider confirmed customer checkout';
  exception when raise_exception then
    if sqlerrm not like 'PERMISSION:%' then raise; end if;
  end;
  perform pg_temp.demo_actor(3);
  begin
    perform public.confirm_booth_payment(v_order);
    raise exception 'Unrelated member confirmed customer checkout';
  exception when raise_exception then
    if sqlerrm not like 'PERMISSION:%' then raise; end if;
  end;
  perform pg_temp.demo_actor(1);
  if (public.read_order(v_order)->>'canSimulatePayment')::boolean is distinct from true then raise exception 'Customer needs checkout'; end if;
  perform public.confirm_booth_payment(v_order);
  perform public.confirm_booth_payment(v_order);
  if public.read_order(v_order)->>'state' is distinct from 'booth_ready' then raise exception 'Checkout must unlock shopping'; end if;
end;
$$;
reset role;

do $$
declare v_signature text; v_order uuid := (select id from demo_order);
begin
  if exists(select 1 from private.funding_submissions where order_id=v_order)
      or exists(select 1 from private.manual_transfers where order_id=v_order) then raise exception 'Demo checkout created money records'; end if;
  if (select count(*) from private.audit_events where target_id=v_order and event_type='booth_payment_confirmed')<>1 then raise exception 'Checkout replay created extra audit facts'; end if;
  foreach v_signature in array array[
    'funding_command(uuid,text,uuid,uuid,text,bigint,text)','funding_view(uuid)',
    'funding_queue(uuid,timestamptz,uuid)','funding_evidence(uuid,boolean)',
    'manual_transfer_command(uuid,uuid,text,jsonb)','manual_transfer_operation(uuid)',
    'read_manual_transfers(uuid,uuid)','manual_transfer_queue(uuid)',
    'read_reconciliation(text,uuid)','export_reconciliation(text,uuid)'
  ] loop
    if to_regprocedure('public.'||v_signature) is not null then raise exception 'Retired public payment RPC exists: %',v_signature; end if;
    if to_regprocedure('private.'||v_signature) is not null then raise exception 'Retired private payment command exists: %',v_signature; end if;
  end loop;
end;
$$;

rollback;
