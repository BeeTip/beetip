alter table public.orders drop constraint orders_state_check;
alter table public.orders add constraint orders_state_check
  check (state in ('awaiting_payment','cancelled','expired','delivering','delivery_confirmed'));

create function private.start_delivery(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid();
begin
  if private.is_active_member() is not true or not exists (
    select 1 from public.orders where id=p_order and provider_id=v_actor
  ) then raise exception 'PERMISSION: Delivery unavailable'; end if;

  perform private.btp07_lock_payable_order(p_order);
  if private.is_active_member() is not true or not exists (
    select 1 from public.orders where id=p_order and provider_id=v_actor
  ) then raise exception 'PERMISSION: Delivery unavailable'; end if;
  if not private.funding_purchase_ready(p_order)
    or coalesce(private.purchase_progress_state(p_order) in ('purchased','purchase_partial'),false) is not true
  then raise exception 'CONFLICT: Delivery requires completed shopping with goods to hand over'; end if;

  update public.orders set state='delivering' where id=p_order;
  insert into private.audit_events(actor_id,event_type,target_id) values (v_actor,'delivery_started',p_order);
end;
$$;

create function public.start_delivery(p_order uuid) returns void
language sql security invoker set search_path='' as $$ select private.start_delivery(p_order); $$;

revoke all on function private.start_delivery(uuid),public.start_delivery(uuid) from public,anon,authenticated;
grant execute on function private.start_delivery(uuid),public.start_delivery(uuid) to authenticated;

create table private.handover_challenges (
  order_id uuid primary key references public.orders(id),
  customer_id uuid not null,
  provider_id uuid not null,
  salt uuid not null,
  code_hash bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  consumed_at timestamptz,
  check (octet_length(code_hash)=32)
);
alter table private.handover_challenges enable row level security;
revoke all on private.handover_challenges from public,anon,authenticated;

create function private.handover_hash(p_digest text,p_order uuid,p_customer uuid,p_provider uuid,p_salt uuid)
returns bytea language sql immutable strict set search_path='' as $$
  select sha256(convert_to(p_digest||':'||p_order||':'||p_customer||':'||p_provider||':'||p_salt,'UTF8'));
$$;
revoke all on function private.handover_hash(text,uuid,uuid,uuid,uuid) from public,anon,authenticated;

create function private.issue_handover_code(p_order uuid,p_checked boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_previous private.handover_challenges%rowtype;
  v_code text;
  v_digest text;
  v_salt uuid := gen_random_uuid();
  v_now timestamptz;
  v_expires timestamptz;
begin
  select * into v_order from public.orders where id=p_order and customer_id=auth.uid() for update;
  if not found or private.is_active_member() is not true then
    raise exception 'PERMISSION: Handover unavailable';
  end if;
  if p_checked is not true then raise exception 'VALIDATION: Check the goods first'; end if;
  if v_order.state<>'delivering' then raise exception 'CONFLICT: Delivery is not in progress'; end if;

  select * into v_previous from private.handover_challenges where order_id=p_order;
  loop
    v_code := upper(left(replace(gen_random_uuid()::text,'-',''),12));
    v_digest := encode(sha256(convert_to(p_order::text||':'||v_code,'UTF8')),'hex');
    exit when v_previous.order_id is null or v_previous.code_hash is distinct from private.handover_hash(
      v_digest,p_order,v_order.customer_id,v_order.provider_id,v_previous.salt);
  end loop;
  v_now := clock_timestamp();
  v_expires := v_now + interval '60 seconds';
  insert into private.handover_challenges(order_id,customer_id,provider_id,salt,code_hash,issued_at,expires_at)
    values (p_order,v_order.customer_id,v_order.provider_id,v_salt,
      private.handover_hash(v_digest,p_order,v_order.customer_id,v_order.provider_id,v_salt),v_now,v_expires)
    on conflict (order_id) do update set customer_id=excluded.customer_id,provider_id=excluded.provider_id,
      salt=excluded.salt,code_hash=excluded.code_hash,issued_at=excluded.issued_at,expires_at=excluded.expires_at,
      failed_attempts=0,consumed_at=null;
  insert into private.audit_events(actor_id,event_type,target_id) values (auth.uid(),'handover_code_issued',p_order);
  return jsonb_build_object('code',v_code,'expiresAt',v_expires);
end;
$$;

create function public.issue_handover_code(p_order uuid,p_checked boolean) returns jsonb
language sql security invoker set search_path='' as $$ select private.issue_handover_code(p_order,p_checked); $$;

revoke all on function private.issue_handover_code(uuid,boolean),public.issue_handover_code(uuid,boolean) from public,anon,authenticated;
grant execute on function private.issue_handover_code(uuid,boolean),public.issue_handover_code(uuid,boolean) to authenticated;

create function private.confirm_handover(p_order uuid,p_digest text) returns text
language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_challenge private.handover_challenges%rowtype;
  v_reason text;
  v_now timestamptz;
begin
  select * into v_order from public.orders where id=p_order and provider_id=auth.uid() for update;
  if not found or private.is_active_member() is not true then
    raise exception 'PERMISSION: Handover unavailable';
  end if;
  if p_digest is null or octet_length(p_digest)<>64 or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'VALIDATION: Invalid handover request';
  end if;

  select * into v_challenge from private.handover_challenges where order_id=p_order;
  v_now := clock_timestamp();
  if v_order.state='delivery_confirmed' or v_challenge.consumed_at is not null then
    v_reason := 'replayed';
  elsif v_order.state<>'delivering' or v_challenge.order_id is null
    or v_challenge.customer_id<>v_order.customer_id or v_challenge.provider_id<>v_order.provider_id then
    v_reason := 'unavailable';
  elsif v_challenge.expires_at<=v_now then
    v_reason := 'expired';
  elsif v_challenge.failed_attempts>=5 then
    v_reason := 'locked';
  elsif v_challenge.code_hash<>private.handover_hash(p_digest,p_order,v_order.customer_id,v_order.provider_id,v_challenge.salt) then
    update private.handover_challenges set failed_attempts=failed_attempts+1 where order_id=p_order
      returning failed_attempts into v_challenge.failed_attempts;
    v_reason := case when v_challenge.failed_attempts=5 then 'locked' else 'invalid' end;
  else
    update private.handover_challenges set consumed_at=v_now where order_id=p_order;
    update public.orders set state='delivery_confirmed' where id=p_order;
    insert into private.audit_events(actor_id,event_type,target_id) values (auth.uid(),'handover_confirmed',p_order);
    return 'confirmed';
  end if;

  -- Return rejections so the attempt and audit commit with the RPC.
  insert into private.audit_events(actor_id,event_type,target_id,detail)
    values (auth.uid(),'handover_rejected',p_order,jsonb_build_object('reason',v_reason));
  return v_reason;
end;
$$;

create function public.confirm_handover(p_order uuid,p_digest text) returns text
language sql security invoker set search_path='' as $$ select private.confirm_handover(p_order,p_digest); $$;

revoke all on function private.confirm_handover(uuid,text),public.confirm_handover(uuid,text) from public,anon,authenticated;
grant execute on function private.confirm_handover(uuid,text),public.confirm_handover(uuid,text) to authenticated;
