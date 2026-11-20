create table private.synthetic_transfer_accounts (
  account_id uuid primary key references private.funding_accounts(id)
);

create table private.manual_transfers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  account_id uuid not null references private.synthetic_transfer_accounts(account_id),
  prepared_by uuid not null references public.members(id),
  component text not null check (component in ('purchase','fee','refund')),
  item_index integer check (item_index >= 0),
  amount bigint not null check (amount between 1 and 9007199254740991),
  independent_review boolean not null,
  allocation_context jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id,account_id),
  check ((component='purchase')=(item_index is not null))
);
create index manual_transfers_order on private.manual_transfers(order_id,created_at desc,id);
create index manual_transfers_account on private.manual_transfers(account_id);
create index manual_transfers_initiator on private.manual_transfers(prepared_by);

create table private.manual_transfer_facts (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null,
  account_id uuid not null,
  version integer not null check (version between 1 and 5),
  actor_id uuid not null references public.members(id),
  state text not null check (state in ('prepared','approved','started','ambiguous','completed','not_sent')),
  note text not null check (char_length(note) between 1 and 1000),
  reference text check (reference collate "C" ~ '^TEST[A-Z0-9]{4,44}$'),
  account_record text check (char_length(account_record) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (transfer_id,account_id) references private.manual_transfers(id,account_id),
  unique (transfer_id,version),
  unique (account_id,reference),
  check ((state='completed')=(reference is not null))
);
create index manual_transfer_facts_actor on private.manual_transfer_facts(actor_id);
alter table private.synthetic_transfer_accounts enable row level security;
alter table private.manual_transfers enable row level security;
alter table private.manual_transfer_facts enable row level security;
revoke all on private.synthetic_transfer_accounts,private.manual_transfers,private.manual_transfer_facts from public,anon,authenticated;

create view private.current_manual_transfer_facts with (security_invoker=true) as
  select distinct on (transfer_id) * from private.manual_transfer_facts order by transfer_id,version desc;
revoke all on private.current_manual_transfer_facts from public,anon,authenticated;

create view private.committed_transfer_allocations with (security_invoker=true) as
  select order_id,component,item_index,amount from private.case_transfer_claims
  union all
  select t.order_id,t.component,t.item_index,t.amount
  from private.manual_transfers t join private.current_manual_transfer_facts f on f.transfer_id=t.id
  where f.state in ('started','ambiguous','completed');
revoke all on private.committed_transfer_allocations from public,anon,authenticated;

create or replace function private.case_claimed(p_order uuid) returns private.case_amounts
language sql stable set search_path='' as $$
  select coalesce(sum(amount) filter (where component='purchase'),0)::bigint,
    coalesce(sum(amount) filter (where component='fee'),0)::bigint,
    coalesce(sum(amount) filter (where component='refund'),0)::bigint
  from private.committed_transfer_allocations where order_id=p_order;
$$;

create or replace function private.case_item_unsettled(p_order uuid,p_item integer) returns bigint
language sql stable set search_path='' as $$
  select greatest(0,private.case_item_entitlement(p_order,p_item)-
    coalesce((select sum(amount) from private.committed_transfer_allocations where order_id=p_order and item_index=p_item),0))::bigint;
$$;

create function private.transfer_capacity(p_order uuid,p_component text,p_item integer) returns bigint
language sql stable set search_path='' as $$
  select case p_component
    when 'purchase' then greatest(0,least((a).purchase,private.case_item_unsettled(p_order,p_item) -
      coalesce((select (held).purchase from private.order_cases where order_id=p_order and item_index=p_item
        and not private.case_closed(id) limit 1),0)))
    when 'fee' then (a).fee
    when 'refund' then (a).refund
  end from (select private.case_unheld(p_order) a) amounts;
$$;

create function private.transfer_context(p_order public.orders,p_component text,p_item integer) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_array(p_order.state,private.transfer_capacity(p_order.id,p_component,p_item),
    (select jsonb_agg(jsonb_build_array(c.id,private.case_closed(c.id)) order by c.id)
      from private.order_cases c where c.order_id=p_order.id));
$$;

create function private.manual_transfer_command(p_operation_id uuid,p_order uuid,p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_account uuid;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
  v_note text := regexp_replace(p_payload->>'note','^[[:space:]]+|[[:space:]]+$','','g');
  v_component text := p_payload->>'component';
  v_amount bigint;
  v_item integer;
  v_transfer private.manual_transfers%rowtype;
  v_latest private.manual_transfer_facts%rowtype;
  v_next text;
  v_reference text;
  v_record text;
begin
  if private.has_staff_role('finance_operation') is not true or not private.case_operator_for(v_actor,p_order) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  if p_operation_id is null or p_action is null or p_action not in
      ('prepare','approve','start','abandon','completed','not_sent','ambiguous','resolve_completed','resolve_not_sent')
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8192
    or jsonb_typeof(p_payload->'note') is distinct from 'string' or coalesce(char_length(v_note),0) not between 1 and 1000 then
    raise exception 'VALIDATION: Invalid transfer command';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_order,p_action,p_payload)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'manual_transfer',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts
    where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'manual_transfer' or v_receipt.payload_hash<>v_hash then
    raise exception 'CONFLICT: Operation ID already used';
  end if;

  v_order := private.lock_case_order(p_order);
  select s.account_id into v_account from private.synthetic_transfer_accounts s
    join private.funding_submissions f on f.account_id=s.account_id and f.order_id=p_order and f.state='verified'
    for no key update of s;
  if not found then raise exception 'PERMISSION: Synthetic transfer account required'; end if;
  perform 1 from private.funding_accounts where id=v_account and enabled for share;
  if not found then raise exception 'PERMISSION: Synthetic transfer account required'; end if;
  perform 1 from public.staff_roles where member_id=v_actor and role='finance_operation' and revoked_at is null for share;
  if not found then raise exception 'PERMISSION: Finance role required'; end if;
  perform 1 from private.funding_account_operators where account_id=v_account and member_id=v_actor for share;
  if not found or private.has_staff_role('finance_operation') is not true or not private.case_operator_for(v_actor,p_order) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;

  if p_action='prepare' then
    if v_order.state not in ('delivery_confirmed','cancelled')
      or exists(select 1 from private.funding_submissions where order_id=p_order and state='pending') then
      raise exception 'CONFLICT: Order is not eligible for a transfer';
    end if;
    if v_component is null or v_component not in ('purchase','fee','refund')
      or jsonb_typeof(p_payload->'amount') is distinct from 'number' or p_payload->>'amount' !~ '^[1-9][0-9]{0,15}$'
      or (v_component='purchase')<>(p_payload ? 'itemIndex') then
      raise exception 'VALIDATION: Invalid transfer allocation';
    end if;
    v_amount := (p_payload->>'amount')::bigint;
    if v_amount>9007199254740991 then raise exception 'VALIDATION: Invalid transfer allocation'; end if;
    if v_component='purchase' then
      if jsonb_typeof(p_payload->'itemIndex') is distinct from 'number' or p_payload->>'itemIndex' !~ '^[0-9]{1,9}$' then
        raise exception 'VALIDATION: Invalid transfer item';
      end if;
      v_item := (p_payload->>'itemIndex')::integer;
    end if;
    if v_amount>private.transfer_capacity(p_order,v_component,v_item) then
      raise exception 'CONFLICT: Insufficient unheld entitlement';
    end if;
    if exists(select 1 from private.manual_transfers t join private.current_manual_transfer_facts f on f.transfer_id=t.id
      where t.order_id=p_order and f.state not in ('completed','not_sent')) then
      raise exception 'CONFLICT: Resolve the open transfer first';
    end if;
    insert into private.manual_transfers(order_id,account_id,prepared_by,component,item_index,amount,independent_review,allocation_context)
      values(p_order,v_account,v_actor,v_component,v_item,v_amount,v_component='refund' or v_order.state='cancelled'
        or exists(select 1 from private.order_cases where order_id=p_order),private.transfer_context(v_order,v_component,v_item))
      returning * into v_transfer;
    v_next := 'prepared';
  else
    if jsonb_typeof(p_payload->'transferId') is distinct from 'string'
      or p_payload->>'transferId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_payload->'version') is distinct from 'number' or p_payload->>'version' !~ '^[1-5]$' then
      raise exception 'VALIDATION: Invalid transfer version';
    end if;
    select * into v_transfer from private.manual_transfers
      where id=(p_payload->>'transferId')::uuid and order_id=p_order and account_id=v_account for update;
    if not found then raise exception 'PERMISSION: Transfer unavailable'; end if;
    select * into strict v_latest from private.current_manual_transfer_facts where transfer_id=v_transfer.id;
    if v_latest.version<>(p_payload->>'version')::integer then
      raise exception 'CONFLICT: Transfer version changed';
    end if;
    if p_action in ('approve','start') and (
      v_order.state not in ('delivery_confirmed','cancelled')
      or exists(select 1 from private.funding_submissions where order_id=p_order and state='pending')
      or v_transfer.allocation_context is distinct from private.transfer_context(v_order,v_transfer.component,v_transfer.item_index)
    ) then raise exception 'CONFLICT: Allocation changed'; end if;

    case
      when p_action='approve' and v_latest.state='prepared' and v_transfer.independent_review then
        if v_actor=v_transfer.prepared_by then raise exception 'PERMISSION: Independent reviewer required'; end if;
        perform 1 from public.staff_roles where member_id=v_transfer.prepared_by and role='finance_operation'
          and revoked_at is null for share;
        if not found then raise exception 'CONFLICT: Initiator no longer authorized'; end if;
        perform 1 from private.funding_account_operators where account_id=v_account and member_id=v_transfer.prepared_by for share;
        if not found or not private.funding_operator_for(v_transfer.prepared_by,v_account) then
          raise exception 'CONFLICT: Initiator no longer authorized';
        end if;
        v_next := 'approved';
      when p_action='start' and (v_latest.state='approved' or (v_latest.state='prepared' and not v_transfer.independent_review)) then
        if v_actor<>v_transfer.prepared_by then raise exception 'PERMISSION: Initiator required'; end if;
        if v_latest.state='approved' then
          perform 1 from public.staff_roles where member_id=v_latest.actor_id and role='finance_operation'
            and revoked_at is null for share;
          if not found then raise exception 'CONFLICT: Reviewer no longer authorized'; end if;
          perform 1 from private.funding_account_operators where account_id=v_account and member_id=v_latest.actor_id for share;
          if not found or not private.funding_operator_for(v_latest.actor_id,v_account) then
            raise exception 'CONFLICT: Reviewer no longer authorized';
          end if;
        end if;
        if exists(select 1 from private.manual_transfers t join private.current_manual_transfer_facts f on f.transfer_id=t.id
          where t.account_id=v_account and f.state in ('started','ambiguous')) then
          raise exception 'CONFLICT: Account has an unresolved transfer';
        end if;
        v_next := 'started';
      when p_action='abandon' and v_latest.state in ('prepared','approved') then
        v_next := 'not_sent';
      when p_action in ('completed','not_sent','ambiguous') and v_latest.state='started' then
        v_next := p_action;
      when p_action in ('resolve_completed','resolve_not_sent') and v_latest.state='ambiguous' then
        v_record := regexp_replace(p_payload->>'record','^[[:space:]]+|[[:space:]]+$','','g');
        if jsonb_typeof(p_payload->'record') is distinct from 'string' or coalesce(char_length(v_record),0) not between 1 and 160 then
          raise exception 'VALIDATION: Account record required';
        end if;
        v_next := substr(p_action,9);
      else
        raise exception 'CONFLICT: Transfer action unavailable';
    end case;
    if v_next='completed' then
      v_reference := upper(regexp_replace((p_payload->>'reference') collate "C",'[ -]','','g'));
      if jsonb_typeof(p_payload->'reference') is distinct from 'string' or char_length(p_payload->>'reference')>64
        or v_reference collate "C" !~ '^TEST[A-Z0-9]{4,44}$' then
        raise exception 'VALIDATION: Synthetic reference required';
      end if;
      if exists(select 1 from private.manual_transfer_facts where account_id=v_account and reference=v_reference) then
        raise exception 'CONFLICT: Reference already in use';
      end if;
    end if;
  end if;
  insert into private.manual_transfer_facts(transfer_id,account_id,version,actor_id,state,note,reference,account_record)
    values(v_transfer.id,v_account,coalesce(v_latest.version,0)+1,v_actor,v_next,v_note,v_reference,v_record);
  update private.operation_receipts set result_id=v_transfer.id where actor_id=v_actor and operation_id=p_operation_id;
  return v_transfer.id;
end;
$$;

create function public.manual_transfer_command(p_operation_id uuid,p_order uuid,p_action text,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$
  select private.manual_transfer_command(p_operation_id,p_order,p_action,p_payload);
$$;

revoke all on function private.transfer_capacity(uuid,text,integer),private.transfer_context(public.orders,text,integer),
  private.manual_transfer_command(uuid,uuid,text,jsonb),public.manual_transfer_command(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function private.manual_transfer_command(uuid,uuid,text,jsonb),public.manual_transfer_command(uuid,uuid,text,jsonb)
  to authenticated;

create function private.manual_transfer_operation(p_operation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_transfer private.manual_transfers%rowtype;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  select t.* into v_transfer from private.operation_receipts r
    join private.manual_transfers t on t.id=r.result_id
    where r.actor_id=auth.uid() and r.operation_id=p_operation_id and r.command='manual_transfer';
  if not found then return null; end if;
  if not private.case_operator_for(auth.uid(),v_transfer.order_id) then raise exception 'PERMISSION: Transfer unavailable'; end if;
  return jsonb_build_object('orderId',v_transfer.order_id,'transferId',v_transfer.id);
end;
$$;

create function public.manual_transfer_operation(p_operation_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.manual_transfer_operation(p_operation_id);
$$;
revoke all on function private.manual_transfer_operation(uuid),public.manual_transfer_operation(uuid) from public,anon,authenticated;
grant execute on function private.manual_transfer_operation(uuid),public.manual_transfer_operation(uuid) to authenticated;

create function private.manual_transfer_actions(
  p_order public.orders,p_transfer private.manual_transfers,p_fact private.current_manual_transfer_facts,p_blocked boolean
) returns text[]
language sql stable set search_path='' as $$
  select case
    when p_fact.state in ('prepared','approved') then
      array_remove(array[
        case when p_fact.state='prepared' and p_transfer.independent_review and auth.uid()<>p_transfer.prepared_by
          and private.funding_operator_for(p_transfer.prepared_by,p_transfer.account_id)
          and p_transfer.allocation_context=private.transfer_context(p_order,p_transfer.component,p_transfer.item_index)
          then 'approve' end,
        case when not p_blocked and auth.uid()=p_transfer.prepared_by and
          ((p_fact.state='prepared' and not p_transfer.independent_review)
            or (p_fact.state='approved' and private.funding_operator_for(p_fact.actor_id,p_transfer.account_id)))
          and p_transfer.allocation_context=private.transfer_context(p_order,p_transfer.component,p_transfer.item_index)
          then 'start' end,
        'abandon'
      ],null)
    when p_fact.state='started' then array['completed','not_sent','ambiguous']
    when p_fact.state='ambiguous' then array['resolve_completed','resolve_not_sent']
    else array[]::text[]
  end;
$$;

create function private.read_manual_transfers(p_order uuid,p_before uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_account uuid;
  v_label text;
  v_terms jsonb;
  v_blocking_order uuid;
  v_cursor timestamptz;
  v_open boolean;
  v_history jsonb;
  v_options jsonb := '[]'::jsonb;
begin
  if private.has_staff_role('finance_operation') is not true or not private.case_operator_for(auth.uid(),p_order) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  select a.id,a.label into v_account,v_label from private.synthetic_transfer_accounts s
    join private.funding_accounts a on a.id=s.account_id and a.enabled
    join private.funding_submissions f on f.account_id=s.account_id and f.order_id=p_order and f.state='verified';
  if not found then raise exception 'PERMISSION: Synthetic transfer account required'; end if;
  select * into strict v_order from public.orders where id=p_order;
  select terms into strict v_terms from public.order_terms where order_id=p_order;
  if p_before is not null then
    select created_at into v_cursor from private.manual_transfers where id=p_before and order_id=p_order;
    if not found then raise exception 'VALIDATION: Invalid transfer cursor'; end if;
  end if;
  select t.order_id into v_blocking_order from private.manual_transfers t
    join private.current_manual_transfer_facts f on f.transfer_id=t.id
    where t.account_id=v_account and f.state in ('started','ambiguous');
  select exists(select 1 from private.manual_transfers t join private.current_manual_transfer_facts f on f.transfer_id=t.id
    where t.order_id=p_order and f.state not in ('completed','not_sent')) into v_open;
  if not v_open and v_order.state in ('delivery_confirmed','cancelled') then
    select coalesce(jsonb_agg(jsonb_build_object('component',c.component,'itemIndex',c.item_index,'label',c.label,'amount',c.amount)
      order by c.component,c.item_index),'[]'::jsonb) into v_options from (
      select x.*,private.transfer_capacity(p_order,x.component,x.item_index) amount from (
        select 'purchase' component,(i.ordinality-1)::integer item_index,i.item->>'name' label
        from jsonb_array_elements(v_terms->'items') with ordinality as i(item,ordinality)
        union all select 'fee',null,null
        union all select 'refund',null,null
      ) x
    ) c where c.amount>0;
  end if;
  select coalesce(jsonb_agg(q.body order by q.created_at desc,q.id desc),'[]'::jsonb) into v_history from (
    select t.id,t.created_at,jsonb_build_object('id',t.id,'component',t.component,'itemIndex',t.item_index,
      'itemLabel',v_terms->'items'->t.item_index->>'name','amount',t.amount,'independentReview',t.independent_review,
      'preparedBy',t.prepared_by,'state',f.state,'version',f.version,
      'allocationChanged',f.state in ('prepared','approved') and t.allocation_context is distinct from
        private.transfer_context(v_order,t.component,t.item_index),
      'actions',private.manual_transfer_actions(v_order,t,f,v_blocking_order is not null),
      'facts',(select jsonb_agg(jsonb_build_object('state',h.state,'note',h.note,'reference',h.reference,
        'accountRecord',h.account_record,'actorId',h.actor_id,'at',h.created_at) order by h.version)
        from private.manual_transfer_facts h where h.transfer_id=t.id)) body
    from private.manual_transfers t join private.current_manual_transfer_facts f on f.transfer_id=t.id
    where t.order_id=p_order and (v_cursor is null or (t.created_at,t.id)<(v_cursor,p_before))
    order by t.created_at desc,t.id desc limit 30
  ) q;
  return jsonb_build_object('title',v_terms->>'title','accountLabel',v_label,'accountBlocked',v_blocking_order is not null,
    'blockingOrderId',case when v_blocking_order<>p_order and private.case_operator_for(auth.uid(),v_blocking_order) then v_blocking_order end,
    'options',v_options,'history',v_history);
end;
$$;

create function private.manual_transfer_queue(p_after uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_queue jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."orderId"),'[]'::jsonb) into v_queue from (
    select o.id as "orderId",t.terms->>'title' title,a.label as "accountLabel",
      (select f.state from private.manual_transfers m join private.current_manual_transfer_facts f on f.transfer_id=m.id
        where m.order_id=o.id order by m.created_at desc,m.id desc limit 1) as "latestState"
    from private.synthetic_transfer_accounts s join private.funding_accounts a on a.id=s.account_id and a.enabled
    join private.funding_account_operators op on op.account_id=s.account_id and op.member_id=auth.uid()
    join private.funding_submissions b on b.account_id=s.account_id and b.state='verified'
    join public.orders o on o.id=b.order_id join public.order_terms t on t.order_id=o.id
    where (p_after is null or o.id>p_after) and auth.uid() not in (o.customer_id,o.provider_id)
      and o.state in ('delivery_confirmed','cancelled')
    order by o.id limit 30
  ) q;
  return v_queue;
end;
$$;

create function public.read_manual_transfers(p_order uuid,p_before uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.read_manual_transfers(p_order,p_before);
$$;

create function public.manual_transfer_queue(p_after uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.manual_transfer_queue(p_after);
$$;

revoke all on function private.manual_transfer_actions(public.orders,private.manual_transfers,private.current_manual_transfer_facts,boolean),
  private.read_manual_transfers(uuid,uuid),public.read_manual_transfers(uuid,uuid),
  private.manual_transfer_queue(uuid),public.manual_transfer_queue(uuid) from public,anon,authenticated;
grant execute on function private.read_manual_transfers(uuid,uuid),public.read_manual_transfers(uuid,uuid),
  private.manual_transfer_queue(uuid),public.manual_transfer_queue(uuid) to authenticated;
