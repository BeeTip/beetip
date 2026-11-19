alter table public.orders add column terms_version integer not null default 1 check (terms_version >= 1);

create table private.order_amendments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  revision integer not null check (revision >= 1),
  base_terms_version integer not null check (base_terms_version >= 1),
  items jsonb not null,
  budget bigint not null check (budget between 1000 and 150000),
  reason text not null check (char_length(btrim(reason)) between 1 and 400),
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  unique (order_id,revision),
  check ((state='pending') = (decided_at is null))
);
create unique index order_amendments_pending on private.order_amendments(order_id) where state='pending';
create index order_amendments_approved on private.order_amendments(order_id,revision desc) where state='approved';
alter table private.order_amendments enable row level security;
revoke all on private.order_amendments from public,anon,authenticated;

create function private.guard_amendment_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or old.state<>'pending' or new.state='pending'
    or (to_jsonb(new) - array['state','decided_at']) is distinct from
       (to_jsonb(old) - array['state','decided_at']) then
    raise exception 'CONFLICT: Amendment history is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_amendment_history() from public,anon,authenticated;
create trigger order_amendments_immutable before update or delete on private.order_amendments
  for each row execute function private.guard_amendment_history();

update private.notification_rules set implemented=true where event_type='amendment_action';

create function private.amend_order(p_operation_id uuid,p_order uuid,p_action text,p_version integer,
  p_amendment uuid,p_items jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_res public.reservations%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_change private.order_amendments%rowtype;
  v_hash text;
  v_item jsonb;
  v_current_items jsonb;
  v_budget bigint := 0;
  v_used bigint;
  v_limit bigint;
  v_id uuid;
  v_event uuid;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if p_operation_id is null or p_order is null or p_version is null or p_version<1
    or p_action is null or p_action not in ('propose','approve','reject')
    or (p_action='propose' and (p_amendment is not null or p_items is null or p_reason is null))
    or (p_action<>'propose' and (p_amendment is null or p_items is not null or p_reason is not null)) then
    raise exception 'VALIDATION: Invalid amendment command';
  end if;
  select * into v_order from public.orders where id=p_order
    and v_actor=case when p_action='propose' then provider_id else customer_id end;
  if not found then raise exception 'PERMISSION: Amendment unavailable'; end if;

  if p_action='propose' then
    if jsonb_typeof(p_items)<>'array' or char_length(btrim(p_reason)) not between 1 and 400
      or char_length(p_reason)>400 then raise exception 'VALIDATION: Invalid amendment terms'; end if;
    if jsonb_array_length(p_items) not between 1 and 20 then raise exception 'VALIDATION: Invalid items'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_item)<>'object' or not (v_item ?& array['name','specification','quantity','unitBudget'])
        or (v_item - array['name','specification','quantity','unitBudget'])<>'{}'::jsonb
        or jsonb_typeof(v_item->'name')<>'string' or jsonb_typeof(v_item->'specification')<>'string'
        or char_length(btrim(v_item->>'name')) not between 1 and 100 or char_length(v_item->>'name')>100
        or char_length(v_item->>'specification')>200
        or jsonb_typeof(v_item->'quantity')<>'number' or (v_item->>'quantity') !~ '^[0-9]{1,2}$'
        or jsonb_typeof(v_item->'unitBudget')<>'number' or (v_item->>'unitBudget') !~ '^[0-9]{1,6}$' then
        raise exception 'VALIDATION: Invalid item';
      end if;
      if (v_item->>'quantity')::integer not between 1 and 50 or (v_item->>'unitBudget')::integer not between 1000 and 150000 then
        raise exception 'VALIDATION: Invalid quantity or item budget';
      end if;
      v_budget := v_budget + (v_item->>'quantity')::integer * (v_item->>'unitBudget')::integer;
    end loop;
    if v_budget>150000 then raise exception 'VALIDATION: Order budget exceeds Rp150000'; end if;
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_order,p_action,p_version,p_amendment,p_items,p_reason)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'amend_order',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts
    where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'amend_order' or v_receipt.payload_hash<>v_hash then
    raise exception 'CONFLICT: Operation ID already used';
  end if;
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;

  v_res := private.btp07_lock_payable_order(p_order);
  select * into strict v_order from public.orders where id=p_order;
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if v_order.terms_version<>p_version then raise exception 'CONFLICT: Order terms changed'; end if;
  select * into v_change from private.order_amendments where order_id=p_order and state='pending';
  if p_action='propose' then
    if v_change.id is not null then raise exception 'CONFLICT: An amendment is already pending'; end if;
    select items into v_current_items from private.order_amendments
      where order_id=p_order and state='approved' order by revision desc limit 1;
    if not found then select terms->'items' into v_current_items from public.order_terms where order_id=p_order; end if;
    if p_items=v_current_items and v_budget=v_res.amount then raise exception 'VALIDATION: No changes to consent to'; end if;
    insert into private.order_amendments(order_id,revision,base_terms_version,items,budget,reason)
      select p_order,coalesce(max(revision),0)+1,p_version,p_items,v_budget,p_reason
      from private.order_amendments where order_id=p_order returning id into v_id;
  else
    if v_change.id is distinct from p_amendment or v_change.base_terms_version is distinct from p_version then
      raise exception 'CONFLICT: Amendment changed or already decided';
    end if;
    if p_action='approve' then
      select spending_capacity into strict v_limit from public.listings where id=v_res.listing_id;
      select coalesce(sum(amount),0) into v_used from public.reservations
        where listing_id=v_res.listing_id and order_id<>p_order and released_at is null
          and (funding_verified_at is not null or expires_at>clock_timestamp());
      if v_used+v_change.budget>v_limit then raise exception 'CONFLICT: Trip spending capacity full'; end if;
      update public.reservations set amount=v_change.budget where order_id=p_order;
      update public.orders set terms_version=terms_version+1 where id=p_order;
    end if;
    update private.order_amendments
      set state=case when p_action='approve' then 'approved' else 'rejected' end,decided_at=clock_timestamp()
      where id=v_change.id returning id into v_id;
  end if;
  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail)
    values(v_actor,p_operation_id,'amendment_'||p_action,p_order,jsonb_build_object('amendmentId',v_id))
    returning id into v_event;
  perform private.enqueue_notification(v_event,'amendment_action',p_order,v_actor,
    array[case when p_action='propose' then v_order.customer_id else v_order.provider_id end]);
  update private.operation_receipts set result_id=v_id where actor_id=v_actor and operation_id=p_operation_id;
  return v_id;
end;
$$;

create function private.read_amendments(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_view jsonb;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  select jsonb_build_object(
    'version',o.terms_version,'provider',auth.uid()=o.provider_id,
    'editable',o.state='awaiting_payment' and r.released_at is null and
      (r.funding_verified_at is not null or r.expires_at>statement_timestamp()),
    'items',coalesce(current_terms.items,t.terms->'items'),
    'budget',coalesce(current_terms.budget,(t.terms->>'budget')::bigint),'fee',(t.terms->>'fee')::bigint,
    'history',coalesce(history.entries,'[]'::jsonb))
  into v_view
  from public.orders o join public.reservations r on r.order_id=o.id join public.order_terms t on t.order_id=o.id
  left join lateral (select a.items,a.budget from private.order_amendments a where a.order_id=o.id and a.state='approved'
    order by a.revision desc limit 1) current_terms on true
  cross join lateral (select jsonb_agg(a.entry order by a.revision desc) as entries from (
    select revision,jsonb_build_object('id',id,'revision',revision,'baseVersion',base_terms_version,
      'items',items,'budget',budget,'reason',reason,'state',state) as entry
    from private.order_amendments where order_id=o.id order by revision desc limit 20
  ) a) history
  where o.id=p_order and auth.uid() in (o.customer_id,o.provider_id);
  if not found then raise exception 'PERMISSION: Amendment unavailable'; end if;
  return v_view;
end;
$$;

create function public.amend_order(p_operation_id uuid,p_order uuid,p_action text,p_version integer,
  p_amendment uuid default null,p_items jsonb default null,p_reason text default null)
returns uuid language sql security invoker set search_path='' as $$
  select private.amend_order(p_operation_id,p_order,p_action,p_version,p_amendment,p_items,p_reason);
$$;
create function public.read_amendments(p_order uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.read_amendments(p_order); $$;

revoke all on function private.amend_order(uuid,uuid,text,integer,uuid,jsonb,text),
  public.amend_order(uuid,uuid,text,integer,uuid,jsonb,text),private.read_amendments(uuid),public.read_amendments(uuid)
  from public,anon,authenticated;
grant execute on function private.amend_order(uuid,uuid,text,integer,uuid,jsonb,text),
  public.amend_order(uuid,uuid,text,integer,uuid,jsonb,text),private.read_amendments(uuid),public.read_amendments(uuid)
  to authenticated;

drop index private.funding_one_open;
create unique index funding_one_open on private.funding_submissions(order_id) where state in ('draft','pending');
create index funding_verified_order on private.funding_submissions(order_id) where state='verified';

create or replace function private.funding_required(p_order uuid)
returns bigint language sql stable set search_path='' as $$
  select coalesce(
    (select a.budget from private.order_amendments a where a.order_id=p_order and a.state='approved' order by a.revision desc limit 1),
    (t.terms->>'budget')::bigint) + (t.terms->>'fee')::bigint
  from public.order_terms t where t.order_id=p_order;
$$;

create function private.funding_outstanding(p_order uuid)
returns bigint language sql stable set search_path='' as $$
  select greatest(0,required-coalesce(
    (select sum(f.amount) from private.funding_submissions f where f.order_id=p_order and f.state='verified'),0))::bigint
  from (select private.funding_required(p_order) as required) terms where required is not null;
$$;
revoke all on function private.funding_outstanding(uuid) from public,anon,authenticated;

create function private.btp13_order_state(p_order public.orders,p_reservation public.reservations)
returns text language sql volatile set search_path='' as $$
  select case when p_order.state='awaiting_payment' and p_order.terms_version>1
    and p_reservation.funding_verified_at is not null and private.funding_outstanding(p_order.id)>0
    then 'awaiting_top_up'
    else private.btp07_order_state(p_order.state,p_reservation.expires_at,p_reservation.released_at,p_reservation.funding_verified_at) end;
$$;
revoke all on function private.btp13_order_state(public.orders,public.reservations) from public,anon,authenticated;

create or replace function private.read_order(p_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select jsonb_build_object('id',o.id,'state',private.btp13_order_state(o,r),'conversationId',o.conversation_id,
      'terms',t.terms,'reservationUntil',r.expires_at)
    into v_result from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where o.id=p_id and auth.uid() in (o.customer_id,o.provider_id);
  if v_result is null then raise exception 'PERMISSION: Order unavailable'; end if;
  return v_result;
end;
$$;

create or replace function private.browse_orders(p_before timestamptz,p_before_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION: Incomplete cursor'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb) from (
    select o.id,o.created_at,jsonb_build_object('id',o.id,'created_at',o.created_at,'title',t.terms->>'title',
      'state',private.btp13_order_state(o,r)) row_data
    from public.orders o join public.order_terms t on t.order_id=o.id join public.reservations r on r.order_id=o.id
    where auth.uid() in (o.customer_id,o.provider_id) and (p_before is null or (o.created_at,o.id)<(p_before,p_before_id))
    order by o.created_at desc,o.id desc limit 21
  ) rows);
end;
$$;

create or replace function private.funding_purchase_ready(p_order uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.reservations r join public.orders o on o.id=r.order_id
    where r.order_id=p_order and o.state='awaiting_payment' and r.funding_verified_at is not null
      and r.released_at is null and private.funding_outstanding(p_order)=0
      and not exists (select 1 from private.order_amendments a where a.order_id=p_order and a.state='pending'));
$$;

create or replace function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.btp12_previous_target_allowed(p_member,p_type,p_target)
    or (p_type='funding_review' and exists (
      select 1 from private.funding_submissions f join public.orders o on o.id=f.order_id
      join public.reservations r on r.order_id=o.id
      join private.funding_accounts a on a.id=f.account_id
      where o.id=p_target and p_member not in (o.customer_id,o.provider_id)
        and f.state='pending' and a.enabled and o.state='awaiting_payment'
        and r.released_at is null and (r.funding_verified_at is not null or r.expires_at>now())
        and (auth.uid() is distinct from p_member or private.has_staff_role('finance_operation'))
        and private.funding_operator_for(p_member,f.account_id)));
$$;

create or replace function private.funding_queue(p_order uuid,p_after timestamptz,p_after_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_queue jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  if (p_after is null)<>(p_after_id is null) then raise exception 'VALIDATION: Invalid queue cursor'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."submittedAt",q.id),'[]'::jsonb) into v_queue from (
    select f.id,o.id as "orderId",f.account_id as "accountId",a.label as "accountLabel",f.reference,
      f.amount,f.submitted_at as "submittedAt",case when r.funding_verified_at is null then r.expires_at end as "expiresAt"
    from private.funding_account_operators s join private.funding_accounts a on a.id=s.account_id and a.enabled
    join private.funding_submissions f on f.account_id=s.account_id
    join public.orders o on o.id=f.order_id join public.reservations r on r.order_id=o.id
    where s.member_id=auth.uid() and auth.uid() not in (o.customer_id,o.provider_id) and f.state='pending'
      and o.state='awaiting_payment' and r.released_at is null and (r.funding_verified_at is not null or r.expires_at>clock_timestamp())
      and (p_order is null or o.id=p_order) and (p_after is null or (f.submitted_at,f.id)>(p_after,p_after_id))
    order by f.submitted_at,f.id limit 30
  ) q;
  return v_queue;
end;
$$;

create or replace function private.funding_evidence(p_id uuid,p_upload boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid;
begin
  if not private.is_active_member() or p_upload is null then raise exception 'PERMISSION: Evidence unavailable'; end if;
  select f.id into v_id from private.funding_submissions f
    join public.orders o on o.id=f.order_id join public.reservations r on r.order_id=o.id
    join private.funding_accounts a on a.id=f.account_id
    where f.id=p_id and (
      (p_upload and o.customer_id=auth.uid() and f.state='draft' and a.enabled
        and o.state='awaiting_payment' and r.released_at is null and (r.funding_verified_at is not null or r.expires_at>clock_timestamp())
        and exists (select 1 from private.funding_account_customers where account_id=f.account_id and member_id=auth.uid()))
      or (not p_upload and (
        (o.customer_id=auth.uid() and f.state<>'discarded')
        or (auth.uid() not in (o.customer_id,o.provider_id) and f.submitted_at is not null and a.enabled
          and private.has_staff_role('finance_operation') and private.funding_operator_for(auth.uid(),f.account_id)))));
  if v_id is null then raise exception 'PERMISSION: Evidence unavailable'; end if;
  return v_id;
end;
$$;

create or replace function private.funding_view(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_res public.reservations%rowtype; v_funding private.funding_submissions%rowtype;
  v_accounts jsonb; v_customer boolean; v_payable boolean; v_due bigint;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Active member required'; end if;
  select * into v_order from public.orders where id=p_order and auth.uid() in (customer_id,provider_id);
  if not found then raise exception 'PERMISSION: Order unavailable'; end if;
  v_customer := auth.uid()=v_order.customer_id;
  select * into strict v_res from public.reservations where order_id=p_order;
  v_payable := v_order.state='awaiting_payment' and v_res.released_at is null and
    (v_res.funding_verified_at is not null or v_res.expires_at>statement_timestamp());
  v_due := private.funding_outstanding(p_order);
  select * into v_funding from private.funding_submissions where order_id=p_order and state<>'discarded'
    and (v_customer or state<>'draft')
    order by (state in ('draft','pending')) desc, (state='verified' and v_due=0) desc,created_at desc,id desc limit 1;
  if v_customer and v_payable and v_due>0 then
    select jsonb_agg(jsonb_build_object('id',a.id,'label',a.label) order by a.label,a.id) into v_accounts
      from private.funding_accounts a join private.funding_account_customers c on c.account_id=a.id
      where c.member_id=auth.uid() and a.enabled;
  end if;
  return jsonb_build_object('state',coalesce(v_funding.state,'unpaid'),'requiredAmount',private.funding_required(p_order),
    'outstandingAmount',v_due,'amendmentPending',exists (
      select 1 from private.order_amendments where order_id=p_order and state='pending'),
    'payable',v_payable,'purchaseReady',private.funding_purchase_ready(p_order),'accounts',coalesce(v_accounts,'[]'::jsonb),
    'customer',v_customer,'submission',case when v_customer and v_funding.id is not null then jsonb_build_object(
      'id',v_funding.id,'amount',v_funding.amount,'accountId',v_funding.account_id,'reference',v_funding.reference,'reason',v_funding.review_reason,
      'uploaded',private.funding_has_evidence(v_funding.id)) end);
end;
$$;

create or replace function private.funding_command(p_operation_id uuid,p_action text,p_id uuid,p_account uuid,
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
  v_due bigint;
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
    v_due := private.funding_outstanding(v_order.id);
    if v_due is null or v_due=0 then raise exception 'CONFLICT: Order funding unavailable or already covered'; end if;
    if p_amount<>v_due then raise exception 'VALIDATION: Exact outstanding amount required'; end if;
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
      if v_funding.amount is distinct from private.funding_outstanding(v_order.id) then
        raise exception 'CONFLICT: Funding amount changed. Discard the draft and use the current amount';
      end if;
      if not private.funding_has_evidence(v_id) then
        raise exception 'VALIDATION: Validated evidence required';
      end if;
      update private.funding_submissions set state='pending',submitted_at=clock_timestamp() where id=v_id;
      select array_agg(member_id) into v_recipients from private.funding_account_operators
        where account_id=v_funding.account_id and member_id not in (v_order.customer_id,v_order.provider_id);
    else
      if p_action='verify' then
        if not private.funding_has_evidence(v_id) then raise exception 'CONFLICT: Evidence unavailable'; end if;
        if p_account<>v_funding.account_id or v_reference<>v_funding.reference or p_amount<>v_funding.amount then
          raise exception 'VALIDATION: Bank record must match the collection account, reference and submitted amount';
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
