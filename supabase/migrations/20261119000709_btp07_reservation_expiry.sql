alter table public.orders drop constraint orders_state_check;
alter table public.orders add constraint orders_state_check check (state in ('awaiting_payment','cancelled','expired'));
alter table public.reservations add column funding_verified_at timestamptz;
alter table public.reservations add constraint reservations_verified_not_released
  check (funding_verified_at is null or released_at is null);
create index btp07_reservations_due on public.reservations(expires_at,listing_id,order_id)
  where released_at is null and funding_verified_at is null;

create function private.btp07_order_state(p_state text,p_until timestamptz,p_released timestamptz,p_verified timestamptz)
returns text language sql volatile set search_path = '' as $$
  select case when p_state='awaiting_payment' and p_verified is not null then 'funding_verified'
    when p_state='awaiting_payment' and (p_released is not null or p_until<=clock_timestamp()) then 'expired'
    else p_state end;
$$;
revoke all on function private.btp07_order_state(text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;

-- Owner-only building block for future evidence-backed funding transactions.
-- Never grant this to a client or treat the marker as payment evidence.
create function private.btp07_lock_payable_order(p_order_id uuid)
returns public.reservations language plpgsql security definer set search_path = '' as $$
declare v_listing uuid; v_order public.orders%rowtype; v_reservation public.reservations%rowtype;
begin
  select listing_id into v_listing from public.orders where id=p_order_id;
  if not found then raise exception 'CONFLICT: Order unavailable'; end if;
  perform 1 from public.listings where id=v_listing for update;
  select * into strict v_order from public.orders where id=p_order_id for update;
  select * into strict v_reservation from public.reservations where order_id=p_order_id for update;
  if v_order.state<>'awaiting_payment' or v_reservation.released_at is not null
    or (v_reservation.funding_verified_at is null and v_reservation.expires_at<=clock_timestamp()) then
    raise exception 'CONFLICT: Reservation expired or unavailable';
  end if;
  return v_reservation;
end;
$$;
revoke all on function private.btp07_lock_payable_order(uuid) from public,anon,authenticated;

create function private.btp07_preserve_verified_funding(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.btp07_lock_payable_order(p_order_id);
  update public.reservations set funding_verified_at=clock_timestamp()
    where order_id=p_order_id and funding_verified_at is null;
end;
$$;
revoke all on function private.btp07_preserve_verified_funding(uuid) from public,anon,authenticated;

create table private.btp07_expiry_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('ok','failed','overlap')),
  released_count integer not null default 0,
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9]{5}$')
);
create index btp07_expiry_runs_finished on private.btp07_expiry_runs(finished_at desc);
create table private.btp07_expiry_heartbeat (
  singleton boolean primary key default true check (singleton),
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  last_status text not null check (last_status in ('ok','failed','overlap'))
);
alter table private.btp07_expiry_runs enable row level security;
alter table private.btp07_expiry_heartbeat enable row level security;
revoke all on private.btp07_expiry_runs,private.btp07_expiry_heartbeat from public,anon,authenticated;

create function private.btp07_expire_reservations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_order public.orders%rowtype; v_reservation public.reservations%rowtype;
  v_now timestamptz; v_count integer := 0;
begin
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'VALIDATION: Batch must be 1 to 500'; end if;
  -- Bound candidates as well as writes. Busy rows are retried by a later run.
  for v_candidate in select r.order_id,r.listing_id from public.reservations r join public.orders o on o.id=r.order_id
    where o.state='awaiting_payment' and r.released_at is null and r.funding_verified_at is null and r.expires_at<=clock_timestamp()
    order by r.expires_at,r.listing_id,r.order_id limit p_limit
  loop
    perform 1 from public.listings where id=v_candidate.listing_id for update skip locked;
    if not found then continue; end if;
    select * into v_order from public.orders where id=v_candidate.order_id for update skip locked;
    if not found then continue; end if;
    select * into v_reservation from public.reservations where order_id=v_candidate.order_id for update skip locked;
    if not found then continue; end if;
    v_now := clock_timestamp();
    if v_order.state='awaiting_payment' and v_reservation.released_at is null
      and v_reservation.funding_verified_at is null and v_reservation.expires_at<=v_now then
      update public.reservations set released_at=v_now where order_id=v_candidate.order_id;
      update public.orders set state='expired' where id=v_candidate.order_id;
      insert into private.audit_events(event_type,target_id,detail,created_at)
        values('reservation_expired',v_candidate.order_id,'{}',v_now);
      v_count := v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.btp07_expire_reservations(integer) from public,anon,authenticated;

create function private.btp07_run_expiry()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_started timestamptz := clock_timestamp(); v_count integer := 0; v_status text := 'ok'; v_code text;
begin
  if not pg_try_advisory_xact_lock(707,9) then
    insert into private.btp07_expiry_runs(started_at,finished_at,status) values(v_started,clock_timestamp(),'overlap');
    return 0;
  end if;
  begin
    v_count := private.btp07_expire_reservations(100);
  exception when others then
    v_status := 'failed'; v_code := sqlstate;
  end;
  insert into private.btp07_expiry_runs(started_at,finished_at,status,released_count,error_code)
    values(v_started,clock_timestamp(),v_status,v_count,v_code);
  insert into private.btp07_expiry_heartbeat(singleton,last_attempt_at,last_success_at,last_status)
    values(true,v_started,case when v_status='ok' then clock_timestamp() end,v_status)
    on conflict(singleton) do update set last_attempt_at=excluded.last_attempt_at,
      last_success_at=coalesce(excluded.last_success_at,btp07_expiry_heartbeat.last_success_at),last_status=excluded.last_status;
  return v_count;
end;
$$;
revoke all on function private.btp07_run_expiry() from public,anon,authenticated;

-- Plain PostgreSQL test servers may lack pg_cron. Absence is an operating gate.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('btp07-reservation-expiry','* * * * *','select private.btp07_run_expiry()');
  else
    raise warning 'BTP07: pg_cron unavailable; expiry schedule NOT installed';
  end if;
end;
$$;

create or replace function private.guard_reserved_listing() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.type<>old.type and exists(select 1 from public.orders where listing_id=old.id))
    or new.capacity<(select count(*) from public.reservations where listing_id=old.id and released_at is null and (funding_verified_at is not null or expires_at>clock_timestamp()))
    or new.spending_capacity<(select coalesce(sum(amount),0) from public.reservations where listing_id=old.id and released_at is null and (funding_verified_at is not null or expires_at>clock_timestamp())) then
    raise exception 'CONFLICT: Existing reservations must be preserved';
  end if;
  return new;
end;
$$;

create or replace function private.accept_order(p_operation_id uuid,p_listing_id uuid,p_listing_version integer,p_offer_id uuid,p_offer_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_offer public.offers%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
  v_now timestamptz;
  v_customer uuid;
  v_provider uuid;
  v_fee integer;
  v_order uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_count integer;
  v_spending bigint;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if p_operation_id is null or p_listing_id is null or p_listing_version is null or p_listing_version<1
    or (p_offer_id is null) <> (p_offer_version is null) or p_offer_version<1 then raise exception 'VALIDATION: Invalid acceptance'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('listing',p_listing_id,'listingVersion',p_listing_version,
    'offer',p_offer_id,'offerVersion',p_offer_version)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'accept_order',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'accept_order' or v_receipt.payload_hash<>v_hash then raise exception 'CONFLICT: Changed operation payload'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;

  -- A trip is itself a listing. The capacity row is always locked before its offer.
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'PERMISSION: Listing unavailable'; end if;
  v_now := clock_timestamp();
  if v_listing.status<>'active' then raise exception 'CONFLICT: Listing closed'; end if;
  if v_listing.cutoff_at<=v_now then raise exception 'CONFLICT: Listing expired'; end if;
  if v_listing.version<>p_listing_version then raise exception 'CONFLICT: Confirm current listing terms'; end if;
  if p_offer_id is null then
    if v_listing.type<>'request' or v_listing.negotiable then raise exception 'VALIDATION: Offer approval required'; end if;
    if v_listing.owner_id=v_actor then raise exception 'PERMISSION: Cannot take own request'; end if;
    v_customer := v_listing.owner_id; v_provider := v_actor; v_fee := v_listing.fee;
  else
    if v_listing.owner_id<>v_actor then raise exception 'PERMISSION: Only listing owner accepts'; end if;
    select * into v_offer from public.offers where id=p_offer_id and listing_id=p_listing_id for update;
    if not found then raise exception 'PERMISSION: Offer unavailable'; end if;
    if v_offer.status<>'active' or v_offer.version<>p_offer_version or v_offer.listing_version<>v_listing.version then
      raise exception 'CONFLICT: Offer changed or schedule consent stale'; end if;
    if exists(select 1 from public.orders where offer_id=p_offer_id) then raise exception 'CONFLICT: Offer already accepted'; end if;
    v_customer := case when v_listing.type='request' then v_listing.owner_id else v_offer.author_id end;
    v_provider := case when v_listing.type='request' then v_offer.author_id else v_listing.owner_id end;
    v_fee := v_offer.fee;
    if (not v_listing.negotiable and v_fee<>v_listing.fee) or (v_listing.type='request' and v_fee>v_listing.bound)
      or (v_listing.type='trip' and v_fee<v_listing.bound) then raise exception 'CONFLICT: Offer fee no longer valid'; end if;
  end if;
  perform 1 from public.members where id in (v_customer,v_provider) order by id for share;
  v_now := clock_timestamp();
  if v_listing.cutoff_at<=v_now then raise exception 'CONFLICT: Listing expired'; end if;
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if (select count(*) from public.members m join auth.users u on u.id=m.id where m.id in (v_customer,v_provider)
    and m.status<>'suspended' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false))<>2 then
    raise exception 'PERMISSION: Active confirmed counterparties required'; end if;
  select count(*),coalesce(sum(amount),0) into v_count,v_spending from public.reservations
    where listing_id=p_listing_id and released_at is null and (funding_verified_at is not null or expires_at>v_now);
  if v_count>=v_listing.capacity or v_spending+v_listing.budget>v_listing.spending_capacity then
    raise exception 'CONFLICT: Customer or spending capacity full'; end if;
  if v_listing.type='request' and exists(select 1 from public.orders where request_id=p_listing_id) then
    raise exception 'CONFLICT: Request already accepted'; end if;

  insert into public.conversations(id,kind,requester_id,next_sequence) values(v_conversation,'order',v_customer,1);
  insert into public.orders(id,listing_id,offer_id,request_id,trip_id,customer_id,provider_id,conversation_id,created_at)
    values(v_order,p_listing_id,p_offer_id,case when v_listing.type='request' then p_listing_id end,
      case when v_listing.type='trip' then p_listing_id end,v_customer,v_provider,v_conversation,v_now);
  insert into public.order_terms(order_id,listing_version,offer_version,terms,created_at)
    values(v_order,v_listing.version,p_offer_version,jsonb_build_object('type',v_listing.type,'title',v_listing.title,'shop',v_listing.shop,'area',v_listing.area,'category',v_listing.category,'items',v_listing.items,
      'budget',v_listing.budget,'fee',v_fee,'destination',v_listing.destination,'start',v_listing.start_at,'end',v_listing.end_at,'cutoff',v_listing.cutoff_at),v_now);
  insert into public.reservations(order_id,listing_id,customer_id,amount,expires_at)
    values(v_order,p_listing_id,v_customer,v_listing.budget,least(v_now+interval '15 minutes',v_listing.cutoff_at));
  if p_offer_id is not null then update public.offers set status='accepted' where id=p_offer_id; end if;
  if v_listing.type='request' then update public.listings set status='closed' where id=p_listing_id; end if;
  insert into public.conversation_members(conversation_id,member_id,role)
    values(v_conversation,v_customer,'customer'),(v_conversation,v_provider,'provider');
  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail,created_at)
    values(v_actor,p_operation_id,'order_accepted',v_order,jsonb_build_object('listingVersion',v_listing.version,'offerVersion',p_offer_version),v_now);
  insert into private.acceptance_notification_intents(order_id,recipient_id,event_type,created_at)
    select v_order,recipient,'order_accepted',v_now from unnest(array[v_customer,v_provider]) recipient where recipient<>v_actor;
  update private.operation_receipts set result_id=v_order where actor_id=v_actor and operation_id=p_operation_id;
  return v_order;
exception when unique_violation then raise exception 'CONFLICT: Already accepted';
end;
$$;

create or replace function private.read_order(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select jsonb_build_object('id',o.id,'state',private.btp07_order_state(o.state,r.expires_at,r.released_at,r.funding_verified_at),'conversationId',o.conversation_id,'terms',t.terms,'reservationUntil',r.expires_at)
    into v_result from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where o.id=p_id and auth.uid() in (o.customer_id,o.provider_id);
  if v_result is null then raise exception 'PERMISSION: Order unavailable'; end if;
  return v_result;
end;
$$;

create or replace function private.browse_orders(p_before timestamptz,p_before_id uuid) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION: Incomplete cursor'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb) from (
    select o.id,o.created_at,jsonb_build_object('id',o.id,'created_at',o.created_at,'title',t.terms->>'title','state',private.btp07_order_state(o.state,r.expires_at,r.released_at,r.funding_verified_at)) row_data
    from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where auth.uid() in (o.customer_id,o.provider_id) and (p_before is null or (o.created_at,o.id)<(p_before,p_before_id))
    order by o.created_at desc,o.id desc limit 21
  ) rows);
end;
$$;
alter function public.read_order(uuid) volatile;
alter function public.browse_orders(timestamptz,uuid) volatile;
