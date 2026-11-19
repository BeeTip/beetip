create table private.funding_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  environment text not null default 'synthetic' check (environment = 'synthetic'),
  enabled boolean not null default true
);
create table private.funding_account_customers (
  account_id uuid not null references private.funding_accounts(id),
  member_id uuid not null references public.members(id),
  primary key (member_id, account_id)
);
create index funding_account_customers_account on private.funding_account_customers(account_id);
create table private.funding_account_operators (
  account_id uuid not null references private.funding_accounts(id),
  member_id uuid not null references public.members(id),
  primary key (account_id, member_id)
);
create index funding_account_operators_member on private.funding_account_operators(member_id);

create table private.funding_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  account_id uuid not null references private.funding_accounts(id),
  reference text not null check (reference ~ '^TEST[A-Z0-9]{4,44}$'),
  amount bigint not null check (amount between 1 and 9007199254740991),
  state text not null default 'draft' check (state in ('draft','pending','verified','rejected','discarded')),
  created_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  discarded_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.members(id),
  review_reason text check (review_reason in ('not_found','amount_mismatch','evidence_mismatch')),
  check ((submitted_at is not null) = (state in ('pending','verified','rejected'))),
  check ((discarded_at is not null) = (state = 'discarded')),
  check ((reviewed_at is not null and reviewed_by is not null) = (state in ('verified','rejected'))),
  check ((review_reason is not null) = (state = 'rejected'))
);
create unique index funding_one_open on private.funding_submissions(order_id)
  where state in ('draft','pending','verified');
create unique index funding_account_reference on private.funding_submissions(account_id,reference)
  where state in ('pending','verified');
create index funding_submissions_order on private.funding_submissions(order_id,created_at desc,id desc);
create index funding_submissions_queue on private.funding_submissions(account_id,submitted_at,id) where state='pending';
create index funding_submissions_reviewer on private.funding_submissions(reviewed_by);
create index funding_submissions_account on private.funding_submissions(account_id);

alter table private.funding_accounts enable row level security;
alter table private.funding_account_customers enable row level security;
alter table private.funding_account_operators enable row level security;
alter table private.funding_submissions enable row level security;
revoke all on private.funding_accounts,private.funding_account_customers,
  private.funding_account_operators,private.funding_submissions from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('funding-evidence','funding-evidence',false,2097152,array['image/jpeg','image/png']);

create function private.funding_operator_for(p_member uuid,p_account uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.notification_recipient_active(p_member)
    and exists (select 1 from public.staff_roles where member_id=p_member and role='finance_operation' and revoked_at is null)
    and exists (select 1 from auth.mfa_factors where user_id=p_member and status='verified')
    and exists (select 1 from private.funding_account_operators where member_id=p_member and account_id=p_account);
$$;

create function private.funding_required(p_order uuid)
returns bigint language sql stable set search_path='' as $$
  select (terms->>'budget')::bigint + (terms->>'fee')::bigint
  from public.order_terms where order_id=p_order;
$$;

create function private.funding_has_evidence(p_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (select 1 from storage.objects where bucket_id='funding-evidence' and name=p_id::text
    and metadata->>'mimetype' in ('image/jpeg','image/png') and (metadata->>'size')::bigint between 1 and 2097152);
$$;

create function private.funding_purchase_ready(p_order uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (select 1 from private.funding_submissions f
    join public.reservations r on r.order_id=f.order_id
    join public.orders o on o.id=f.order_id
    where f.order_id=p_order and f.state='verified' and f.amount>=private.funding_required(p_order)
      and o.state='awaiting_payment' and r.funding_verified_at is not null and r.released_at is null);
$$;

update private.notification_rules set implemented=true where event_type='funding_review';

alter function private.notification_target_allowed(uuid,text,uuid) rename to btp12_previous_target_allowed;
create function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.btp12_previous_target_allowed(p_member,p_type,p_target)
    or (p_type='funding_review' and exists (
      select 1 from private.funding_submissions f join public.orders o on o.id=f.order_id
      join public.reservations r on r.order_id=o.id
      join private.funding_accounts a on a.id=f.account_id
      where o.id=p_target and p_member not in (o.customer_id,o.provider_id)
        and f.state='pending' and a.enabled and o.state='awaiting_payment'
        and r.released_at is null and r.expires_at>now()
        and (auth.uid() is distinct from p_member or private.has_staff_role('finance_operation'))
        and private.funding_operator_for(p_member,f.account_id)));
$$;

alter function private.notification_target(uuid) rename to btp12_previous_notification_target;
revoke all on function private.btp12_previous_notification_target(uuid) from public,anon,authenticated;
create function private.notification_target(p_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_order uuid;
begin
  select n.target_id into v_order from public.notifications n join public.orders o on o.id=n.target_id
    where n.id=p_id and n.event_type='funding_review' and auth.uid() not in (o.customer_id,o.provider_id)
      and private.notification_visible(n.recipient_id,n.event_type,n.target_id);
  if found then
    if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
    return '/account/funding?order='||v_order::text;
  end if;
  return private.btp12_previous_notification_target(p_id);
end;
$$;
create or replace function public.notification_target(p_id uuid)
returns text language sql stable security invoker set search_path='' as $$ select private.notification_target(p_id); $$;

create function private.funding_command(p_operation_id uuid,p_action text,p_id uuid,p_account uuid,
  p_reference text,p_amount bigint,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_funding private.funding_submissions%rowtype;
  v_hash text;
  v_reference text;
  v_id uuid;
  v_event uuid;
  v_recipients uuid[];
  v_review boolean := p_action in ('verify','reject');
begin
  if private.is_active_member() is not true or (v_review and private.has_staff_role('finance_operation') is not true) then
    raise exception 'PERMISSION: Active member or finance MFA required';
  end if;
  if p_operation_id is null or p_id is null or p_action is null or p_action not in ('begin','submit','discard','verify','reject')
    or (p_action in ('begin','verify') and (p_account is null or p_amount is null
      or p_amount not between 1 and 9007199254740991 or p_reference is null or char_length(p_reference)>80))
    or (p_action not in ('begin','verify') and (p_account is not null or p_reference is not null or p_amount is not null))
    or (p_action='reject' and (p_reason is null or p_reason not in ('not_found','amount_mismatch','evidence_mismatch')))
    or (p_action<>'reject' and p_reason is not null) then
    raise exception 'VALIDATION: Invalid funding command';
  end if;
  if p_reference is not null then
    v_reference := upper(regexp_replace(p_reference collate "C",'[ -]','','g'));
    if v_reference collate "C" !~ '^TEST[A-Z0-9]{4,44}$' then raise exception 'VALIDATION: Synthetic reference required'; end if;
  end if;
  if p_action='begin' then
    select * into v_order from public.orders where id=p_id;
  else
    select * into v_funding from private.funding_submissions where id=p_id;
    select * into v_order from public.orders where id=v_funding.order_id;
  end if;
  if v_order.id is null or (not v_review and v_order.customer_id<>v_actor)
    or (v_review and (v_actor in (v_order.customer_id,v_order.provider_id) or v_funding.submitted_at is null)) then
    raise exception 'PERMISSION: Funding unavailable';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_action,p_id,p_account,v_reference,p_amount,p_reason)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'funding',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;

  if v_review then
    -- Hold the live grants through the decision, including a receipt replay.
    perform 1 from public.staff_roles where member_id=v_actor and role='finance_operation' and revoked_at is null for share;
    if not found then raise exception 'PERMISSION: Finance role required'; end if;
    perform 1 from private.funding_account_operators where account_id=v_funding.account_id and member_id=v_actor for share;
    if not found then raise exception 'PERMISSION: Collection account assignment required'; end if;
  elsif p_action in ('begin','submit') then
    perform 1 from private.funding_account_customers
      where account_id=coalesce(v_funding.account_id,p_account) and member_id=v_actor for share;
    if not found then raise exception 'PERMISSION: Synthetic account assignment required'; end if;
  end if;

  if v_receipt.command<>'funding' or v_receipt.payload_hash<>v_hash then raise exception 'CONFLICT: Operation ID already used'; end if;
  if p_action<>'discard' then
    perform 1 from private.funding_accounts where id=coalesce(v_funding.account_id,p_account) and enabled for share;
    if not found then raise exception 'PERMISSION: Collection account unavailable'; end if;
  end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if p_action<>'discard' then
    perform private.btp07_lock_payable_order(v_order.id);
  end if;
  if private.is_active_member() is not true or (v_review and private.has_staff_role('finance_operation') is not true) then
    raise exception 'PERMISSION: Active member or finance MFA required';
  end if;

  if p_action='begin' then
    if p_amount<>private.funding_required(v_order.id) then raise exception 'VALIDATION: Exact order total required'; end if;
    if exists (select 1 from private.funding_submissions where account_id=p_account and reference=v_reference
      and state in ('pending','verified')) then raise exception 'CONFLICT: Reference already in use'; end if;
    insert into private.funding_submissions(order_id,account_id,reference,amount)
      values(p_id,p_account,v_reference,p_amount) returning id into v_id;
  else
    select * into strict v_funding from private.funding_submissions where id=p_id for update;
    v_id := v_funding.id;
    if (v_review and v_funding.state<>'pending') or (not v_review and v_funding.state<>'draft') then
      raise exception 'CONFLICT: Funding state changed';
    end if;
    if p_action='discard' then
      update private.funding_submissions set state='discarded',discarded_at=clock_timestamp() where id=v_id;
    elsif p_action='submit' then
      if not private.funding_has_evidence(v_id) then
        raise exception 'VALIDATION: Validated evidence required';
      end if;
      update private.funding_submissions set state='pending',submitted_at=clock_timestamp() where id=v_id;
      select array_agg(member_id) into v_recipients from private.funding_account_operators
        where account_id=v_funding.account_id and member_id not in (v_order.customer_id,v_order.provider_id);
    else
      if p_action='verify' then
        if not private.funding_has_evidence(v_id) then raise exception 'CONFLICT: Evidence unavailable'; end if;
        if p_account<>v_funding.account_id or v_reference<>v_funding.reference or p_amount<>v_funding.amount
          or p_amount<>private.funding_required(v_order.id) then
          raise exception 'VALIDATION: Bank record must match the collection account, reference and order total';
        end if;
        perform private.btp07_preserve_verified_funding(v_order.id);
      end if;
      update private.funding_submissions set state=case when p_action='verify' then 'verified' else 'rejected' end,
        reviewed_at=clock_timestamp(),reviewed_by=v_actor,review_reason=p_reason where id=v_id;
      v_recipients := array[v_order.customer_id,v_order.provider_id];
    end if;
  end if;

  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail)
    values(v_actor,p_operation_id,'funding_'||p_action,v_id,jsonb_build_object('orderId',v_order.id))
    returning id into v_event;
  if v_recipients is not null then
    perform private.enqueue_notification(v_event,'funding_review',v_order.id,v_actor,v_recipients);
  end if;
  update private.operation_receipts set result_id=v_id where actor_id=v_actor and operation_id=p_operation_id;
  return v_id;
exception when unique_violation then
  raise exception 'CONFLICT: Funding request or bank reference already in use';
end;
$$;

create function private.funding_view(p_order uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_res public.reservations%rowtype; v_funding private.funding_submissions%rowtype;
  v_accounts jsonb; v_customer boolean; v_payable boolean;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Active member required'; end if;
  select * into v_order from public.orders where id=p_order and auth.uid() in (customer_id,provider_id);
  if not found then raise exception 'PERMISSION: Order unavailable'; end if;
  v_customer := auth.uid()=v_order.customer_id;
  select * into strict v_res from public.reservations where order_id=p_order;
  v_payable := v_order.state='awaiting_payment' and v_res.released_at is null and v_res.expires_at>clock_timestamp();
  select * into v_funding from private.funding_submissions where order_id=p_order and state<>'discarded'
    and (v_customer or state<>'draft')
    order by (state in ('draft','pending','verified')) desc,created_at desc,id desc limit 1;
  if v_customer and v_payable then
    select jsonb_agg(jsonb_build_object('id',a.id,'label',a.label) order by a.label,a.id) into v_accounts
      from private.funding_accounts a join private.funding_account_customers c on c.account_id=a.id
      where c.member_id=auth.uid() and a.enabled;
  end if;
  return jsonb_build_object('state',coalesce(v_funding.state,'unpaid'),'requiredAmount',private.funding_required(p_order),
    'payable',v_payable,'purchaseReady',private.funding_purchase_ready(p_order),'accounts',coalesce(v_accounts,'[]'::jsonb),
    'customer',v_customer,'submission',case when v_customer and v_funding.id is not null then jsonb_build_object(
      'id',v_funding.id,'accountId',v_funding.account_id,'reference',v_funding.reference,'reason',v_funding.review_reason,
      'uploaded',private.funding_has_evidence(v_funding.id)) end);
end;
$$;

create function private.funding_queue(p_order uuid,p_after timestamptz,p_after_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_queue jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  if (p_after is null)<>(p_after_id is null) then raise exception 'VALIDATION: Invalid queue cursor'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."submittedAt",q.id),'[]'::jsonb) into v_queue from (
    select f.id,o.id as "orderId",f.account_id as "accountId",a.label as "accountLabel",f.reference,
      f.amount,f.submitted_at as "submittedAt",r.expires_at as "expiresAt"
    from private.funding_account_operators s join private.funding_accounts a on a.id=s.account_id and a.enabled
    join private.funding_submissions f on f.account_id=s.account_id
    join public.orders o on o.id=f.order_id join public.reservations r on r.order_id=o.id
    where s.member_id=auth.uid() and auth.uid() not in (o.customer_id,o.provider_id) and f.state='pending'
      and o.state='awaiting_payment' and r.released_at is null and r.expires_at>clock_timestamp()
      and (p_order is null or o.id=p_order) and (p_after is null or (f.submitted_at,f.id)>(p_after,p_after_id))
    order by f.submitted_at,f.id limit 30
  ) q;
  return v_queue;
end;
$$;

create function private.funding_evidence(p_id uuid,p_upload boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid;
begin
  if not private.is_active_member() or p_upload is null then raise exception 'PERMISSION: Evidence unavailable'; end if;
  select f.id into v_id from private.funding_submissions f
    join public.orders o on o.id=f.order_id join public.reservations r on r.order_id=o.id
    join private.funding_accounts a on a.id=f.account_id
    where f.id=p_id and (
      (p_upload and o.customer_id=auth.uid() and f.state='draft' and a.enabled
        and o.state='awaiting_payment' and r.released_at is null and r.expires_at>clock_timestamp()
        and exists (select 1 from private.funding_account_customers where account_id=f.account_id and member_id=auth.uid()))
      or (not p_upload and (
        (o.customer_id=auth.uid() and f.state<>'discarded')
        or (auth.uid() not in (o.customer_id,o.provider_id) and f.submitted_at is not null and a.enabled
          and private.has_staff_role('finance_operation') and private.funding_operator_for(auth.uid(),f.account_id)))));
  if v_id is null then raise exception 'PERMISSION: Evidence unavailable'; end if;
  return v_id;
end;
$$;

create function public.funding_command(p_operation_id uuid,p_action text,p_id uuid,p_account uuid default null,
  p_reference text default null,p_amount bigint default null,p_reason text default null)
returns uuid language sql security invoker set search_path='' as $$
  select private.funding_command(p_operation_id,p_action,p_id,p_account,p_reference,p_amount,p_reason);
$$;
create function public.funding_view(p_order uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.funding_view(p_order); $$;
create function public.funding_queue(p_order uuid default null,p_after timestamptz default null,p_after_id uuid default null)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.funding_queue(p_order,p_after,p_after_id); $$;
create function public.funding_evidence(p_id uuid,p_upload boolean)
returns uuid language sql volatile security invoker set search_path='' as $$ select private.funding_evidence(p_id,p_upload); $$;

revoke all on function private.funding_operator_for(uuid,uuid),private.funding_required(uuid),private.funding_has_evidence(uuid),
  private.funding_purchase_ready(uuid),private.notification_target_allowed(uuid,text,uuid),
  private.notification_target(uuid),private.funding_command(uuid,text,uuid,uuid,text,bigint,text),
  private.funding_view(uuid),private.funding_queue(uuid,timestamptz,uuid),private.funding_evidence(uuid,boolean),
  public.funding_command(uuid,text,uuid,uuid,text,bigint,text),public.funding_view(uuid),
  public.funding_queue(uuid,timestamptz,uuid),public.funding_evidence(uuid,boolean) from public,anon,authenticated;
grant execute on function private.notification_target(uuid),private.funding_command(uuid,text,uuid,uuid,text,bigint,text),
  private.funding_view(uuid),private.funding_queue(uuid,timestamptz,uuid),private.funding_evidence(uuid,boolean),
  public.funding_command(uuid,text,uuid,uuid,text,bigint,text),public.funding_view(uuid),
  public.funding_queue(uuid,timestamptz,uuid),public.funding_evidence(uuid,boolean) to authenticated;
