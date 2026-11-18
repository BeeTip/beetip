create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  offer_id uuid unique references public.offers(id),
  request_id uuid unique references public.listings(id),
  trip_id uuid references public.listings(id),
  customer_id uuid not null references public.members(id),
  provider_id uuid not null references public.members(id),
  conversation_id uuid not null unique references public.conversations(id),
  state text not null default 'awaiting_payment' check (state in ('awaiting_payment','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  check (customer_id <> provider_id),
  check ((request_id is not null and request_id = listing_id and trip_id is null) or (trip_id is not null and trip_id = listing_id and request_id is null))
);
create index orders_customer on public.orders(customer_id,created_at desc,id);
create index orders_provider on public.orders(provider_id,created_at desc,id);
create index orders_listing on public.orders(listing_id);
create index orders_trip on public.orders(trip_id);

create table public.order_terms (
  order_id uuid primary key references public.orders(id),
  listing_version integer not null,
  offer_version integer,
  terms jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.reservations (
  order_id uuid primary key references public.orders(id),
  listing_id uuid not null references public.listings(id),
  customer_id uuid not null references public.members(id),
  amount bigint not null check (amount between 1000 and 150000),
  expires_at timestamptz not null,
  released_at timestamptz
);
create index reservations_capacity on public.reservations(listing_id,expires_at) where released_at is null;
create index reservations_customer on public.reservations(customer_id);

alter table public.offers drop constraint offers_status_check;
alter table public.offers add constraint offers_status_check check (status in ('active','withdrawn','accepted'));

create function private.guard_reserved_listing() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.type<>old.type and exists(select 1 from public.orders where listing_id=old.id))
    or new.capacity<(select count(*) from public.reservations where listing_id=old.id and released_at is null and expires_at>clock_timestamp())
    or new.spending_capacity<(select coalesce(sum(amount),0) from public.reservations where listing_id=old.id and released_at is null and expires_at>clock_timestamp()) then
    raise exception 'CONFLICT: Existing reservations must be preserved';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reserved_listing() from public,anon,authenticated;
create trigger listing_reservations_guard before update on public.listings for each row execute function private.guard_reserved_listing();

create table private.acceptance_notification_intents (
  order_id uuid not null references public.orders(id),
  recipient_id uuid not null references public.members(id),
  event_type text not null check (event_type = 'order_accepted'),
  created_at timestamptz not null,
  primary key (order_id,recipient_id)
);
alter table private.acceptance_notification_intents enable row level security;
revoke all on private.acceptance_notification_intents from public,anon,authenticated;

alter table public.conversations drop constraint conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('support','order'));
alter table public.conversations drop constraint conversations_next_sequence_check;
alter table public.conversations add constraint conversations_next_sequence_check check (next_sequence >= 1);
alter table public.conversation_members drop constraint conversation_members_role_check;
alter table public.conversation_members add constraint conversation_members_role_check check (role in ('requester','support','customer','provider'));

create function private.reject_terms_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'PERMISSION: Accepted terms are immutable'; end;
$$;
revoke all on function private.reject_terms_change() from public,anon,authenticated;
create trigger order_terms_immutable before update or delete on public.order_terms for each row execute function private.reject_terms_change();

alter table public.orders enable row level security;
alter table public.order_terms enable row level security;
alter table public.reservations enable row level security;
revoke all on public.orders,public.order_terms,public.reservations from public,anon,authenticated;
grant select on public.orders,public.order_terms,public.reservations to authenticated;
create policy orders_participant_read on public.orders for select to authenticated
using ((customer_id=(select auth.uid()) or provider_id=(select auth.uid())) and (select private.is_active_member()));
create policy order_terms_participant_read on public.order_terms for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id));
create policy reservations_participant_read on public.reservations for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id));

create or replace function private.can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id
    where cm.conversation_id=p_conversation_id and cm.member_id=auth.uid() and cm.revoked_at is null
      and ((c.kind='support' and (cm.role='requester' or (cm.role='support' and private.has_staff_role('support'))))
        or (c.kind='order' and cm.role in ('customer','provider') and exists(
          select 1 from public.orders o where o.conversation_id=c.id and auth.uid() in (o.customer_id,o.provider_id))))
  );
$$;

create function private.accept_order(p_operation_id uuid,p_listing_id uuid,p_listing_version integer,p_offer_id uuid,p_offer_version integer)
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
    where listing_id=p_listing_id and released_at is null and expires_at>v_now;
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
revoke all on function private.accept_order(uuid,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function private.accept_order(uuid,uuid,integer,uuid,integer) to authenticated;
create function public.accept_order(p_operation_id uuid,p_listing_id uuid,p_listing_version integer,p_offer_id uuid default null,p_offer_version integer default null)
returns uuid language sql security invoker set search_path = '' as $$ select private.accept_order(p_operation_id,p_listing_id,p_listing_version,p_offer_id,p_offer_version); $$;
revoke all on function public.accept_order(uuid,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.accept_order(uuid,uuid,integer,uuid,integer) to authenticated;

create function private.read_order(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select jsonb_build_object('id',o.id,'state',o.state,'conversationId',o.conversation_id,'terms',t.terms,'reservationUntil',r.expires_at)
    into v_result from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where o.id=p_id and auth.uid() in (o.customer_id,o.provider_id);
  if v_result is null then raise exception 'PERMISSION: Order unavailable'; end if;
  return v_result;
end;
$$;
revoke all on function private.read_order(uuid) from public,anon,authenticated;
grant execute on function private.read_order(uuid) to authenticated;
create function public.read_order(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.read_order(p_id); $$;
revoke all on function public.read_order(uuid) from public,anon,authenticated;
grant execute on function public.read_order(uuid) to authenticated;

create function private.browse_orders(p_before timestamptz,p_before_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION: Incomplete cursor'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb) from (
    select o.id,o.created_at,jsonb_build_object('id',o.id,'created_at',o.created_at,'title',t.terms->>'title','state',o.state) row_data
    from public.orders o join public.order_terms t on t.order_id=o.id
    where auth.uid() in (o.customer_id,o.provider_id) and (p_before is null or (o.created_at,o.id)<(p_before,p_before_id))
    order by o.created_at desc,o.id desc limit 21
  ) rows);
end;
$$;
revoke all on function private.browse_orders(timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.browse_orders(timestamptz,uuid) to authenticated;
create function public.browse_orders(p_before timestamptz default null,p_before_id uuid default null) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.browse_orders(p_before,p_before_id); $$;
revoke all on function public.browse_orders(timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.browse_orders(timestamptz,uuid) to authenticated;
