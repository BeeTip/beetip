begin;

create table private.booth_members (
  member_id uuid primary key references public.members(id) on delete cascade
);
revoke all on private.booth_members from public,anon,authenticated;

alter table public.orders add column booth_demo boolean not null default false;

create function private.mark_booth_order() returns trigger
language plpgsql set search_path='' as $$
declare
  v_customer boolean;
  v_provider boolean;
begin
  select exists(select 1 from private.booth_members where member_id=new.customer_id),
         exists(select 1 from private.booth_members where member_id=new.provider_id)
    into v_customer,v_provider;
  if v_customer<>v_provider then
    raise exception 'CONFLICT: Booth accounts can only order with another booth account';
  end if;
  new.booth_demo := v_customer and v_provider;
  return new;
end;
$$;
revoke all on function private.mark_booth_order() from public,anon,authenticated;
create trigger orders_mark_booth before insert on public.orders
  for each row execute function private.mark_booth_order();

create function private.extend_booth_reservation() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.orders where id=new.order_id and booth_demo) then
    new.expires_at := clock_timestamp()+interval '24 hours';
  end if;
  return new;
end;
$$;
revoke all on function private.extend_booth_reservation() from public,anon,authenticated;
create trigger reservations_booth_window before insert on public.reservations
  for each row execute function private.extend_booth_reservation();

create function private.guard_booth_funding() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.orders where id=new.order_id and booth_demo) then
    raise exception 'CONFLICT: Payment is disabled for booth orders';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_booth_funding() from public,anon,authenticated;
create trigger funding_submissions_guard_booth before insert or update on private.funding_submissions
  for each row execute function private.guard_booth_funding();

create or replace function private.funding_purchase_ready(p_order uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.reservations r join public.orders o on o.id=r.order_id
    where r.order_id=p_order and o.state='awaiting_payment' and r.released_at is null
      and ((o.booth_demo and r.expires_at>statement_timestamp())
        or (r.funding_verified_at is not null and private.funding_outstanding(p_order)=0))
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
    when p_order.state='awaiting_payment' and p_order.booth_demo then 'booth_ready'
    else private.btp07_order_state(p_order.state,p_reservation.expires_at,p_reservation.released_at,p_reservation.funding_verified_at) end;
$$;

create or replace function private.read_order(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select jsonb_build_object('id',o.id,'state',private.btp13_order_state(o,r),'conversationId',o.conversation_id,
      'terms',t.terms,'reservationUntil',r.expires_at,'boothDemo',o.booth_demo)
    into v_result from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where o.id=p_id and auth.uid() in (o.customer_id,o.provider_id);
  if v_result is null then raise exception 'PERMISSION: Order unavailable'; end if;
  return v_result;
end;
$$;

commit;
