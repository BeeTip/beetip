begin;

create table private.booth_payments (
  order_id uuid primary key references public.orders(id) on delete cascade,
  confirmed_at timestamptz
);
alter table private.booth_payments enable row level security;
revoke all on private.booth_payments from public,anon,authenticated;

create function private.init_booth_payment() returns trigger
language plpgsql set search_path='' as $$
begin
  insert into private.booth_payments(order_id) values (new.id);
  return new;
end;
$$;
revoke all on function private.init_booth_payment() from public,anon,authenticated;
create trigger orders_init_booth_payment after insert on public.orders
  for each row when (new.booth_demo) execute function private.init_booth_payment();

create function private.confirm_booth_payment(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_confirmed timestamptz;
begin
  if private.is_active_member() is not true then
    raise exception 'PERMISSION: Demo payment unavailable';
  end if;
  select p.confirmed_at into v_confirmed from private.booth_payments p
    join public.orders o on o.id=p.order_id
    where o.id=p_order and o.booth_demo and o.customer_id=v_actor;
  if not found then raise exception 'PERMISSION: Demo payment unavailable'; end if;
  if v_confirmed is not null then return; end if;

  perform private.btp07_lock_payable_order(p_order);
  if private.is_active_member() is not true then
    raise exception 'PERMISSION: Demo payment unavailable';
  end if;
  update private.booth_payments set confirmed_at=clock_timestamp()
    where order_id=p_order and confirmed_at is null;
  if found then
    insert into private.audit_events(actor_id,event_type,target_id)
      values (v_actor,'booth_payment_confirmed',p_order);
  end if;
end;
$$;

create function public.confirm_booth_payment(p_order uuid) returns void
language sql security invoker set search_path='' as $$ select private.confirm_booth_payment(p_order); $$;
revoke all on function private.confirm_booth_payment(uuid),public.confirm_booth_payment(uuid) from public,anon,authenticated;
grant execute on function private.confirm_booth_payment(uuid),public.confirm_booth_payment(uuid) to authenticated;

create or replace function private.funding_purchase_ready(p_order uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.reservations r join public.orders o on o.id=r.order_id
    where r.order_id=p_order and o.state='awaiting_payment' and r.released_at is null
      and ((o.booth_demo and r.expires_at>statement_timestamp()
          and not exists (select 1 from private.booth_payments p where p.order_id=o.id and p.confirmed_at is null))
        or (not o.booth_demo and r.funding_verified_at is not null and private.funding_outstanding(p_order)=0))
      and not exists (select 1 from private.order_amendments a where a.order_id=p_order and a.state='pending')
      and not private.case_cancellation_pending(p_order));
$$;

create or replace function private.btp13_order_state(p_order public.orders,p_reservation public.reservations)
returns text language sql volatile set search_path='' as $$
  select case when p_order.state='awaiting_payment' and p_order.terms_version>1
    and p_reservation.funding_verified_at is not null and private.funding_outstanding(p_order.id)>0 then 'awaiting_top_up'
    when p_order.state='awaiting_payment' and p_order.booth_demo
      and (p_reservation.released_at is not null or p_reservation.expires_at<=clock_timestamp()) then 'expired'
    when p_order.state='awaiting_payment' and private.purchase_progress_state(p_order.id) is not null then private.purchase_progress_state(p_order.id)
    when p_order.state='awaiting_payment' and p_order.booth_demo then
      case when exists (select 1 from private.booth_payments p where p.order_id=p_order.id and p.confirmed_at is null)
        then 'booth_awaiting_payment' else 'booth_ready' end
    else private.btp07_order_state(p_order.state,p_reservation.expires_at,p_reservation.released_at,p_reservation.funding_verified_at) end;
$$;

create or replace function private.read_order(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select jsonb_build_object('id',o.id,'state',s.state,'conversationId',o.conversation_id,
      'terms',t.terms,'reservationUntil',r.expires_at,'boothDemo',o.booth_demo,
      'canSimulatePayment',s.state='booth_awaiting_payment' and o.customer_id=auth.uid())
    into v_result from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    cross join lateral (select private.btp13_order_state(o,r) state) s
    where o.id=p_id and auth.uid() in (o.customer_id,o.provider_id);
  if v_result is null then raise exception 'PERMISSION: Order unavailable'; end if;
  return v_result;
end;
$$;

commit;
