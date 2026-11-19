create type private.case_amounts as (purchase bigint, fee bigint, refund bigint);

create table private.order_cases (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  opened_by uuid not null references public.members(id),
  kind text not null check (kind in ('cancellation','dispute')),
  reason text not null check (char_length(reason) between 1 and 1000),
  item_index integer check (item_index >= 0),
  baseline private.case_amounts not null,
  held private.case_amounts not null,
  opened_at timestamptz not null default clock_timestamp()
);
create index order_cases_order on private.order_cases(order_id,opened_at desc,id);
create index order_cases_opener on private.order_cases(opened_by);
alter table private.order_cases enable row level security;
revoke all on private.order_cases from public,anon,authenticated;

create table private.order_case_proposals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.order_cases(id),
  proposed_by uuid not null references public.members(id),
  outcome text not null check (outcome in ('resolve','dismiss')),
  allocation private.case_amounts not null,
  evidence_count integer not null check (evidence_count between 0 and 8),
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index order_case_proposals_case on private.order_case_proposals(case_id,created_at desc,id);
create index order_case_proposals_actor on private.order_case_proposals(proposed_by);

create table private.order_case_reviews (
  proposal_id uuid primary key references private.order_case_proposals(id),
  reviewed_by uuid not null references public.members(id),
  decision text not null check (decision in ('approve','return')),
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index order_case_reviews_actor on private.order_case_reviews(reviewed_by);
alter table private.order_case_proposals enable row level security;
alter table private.order_case_reviews enable row level security;
revoke all on private.order_case_proposals,private.order_case_reviews from public,anon,authenticated;

create table private.order_case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.order_cases(id),
  submitted_by uuid not null references public.members(id),
  object_name text not null unique,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index order_case_evidence_case on private.order_case_evidence(case_id,created_at,id);
create index order_case_evidence_actor on private.order_case_evidence(submitted_by);
alter table private.order_case_evidence enable row level security;
revoke all on private.order_case_evidence from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('order-case-evidence','order-case-evidence',false,2097152,array['image/jpeg','image/png']);

create table private.case_transfer_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  component text not null check (component in ('purchase','fee','refund')),
  item_index integer check (item_index >= 0),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp(),
  check ((component='purchase') = (item_index is not null))
);
create index case_transfer_claims_order on private.case_transfer_claims(order_id,component,item_index);
alter table private.case_transfer_claims enable row level security;
revoke all on private.case_transfer_claims from public,anon,authenticated;

create function private.case_funding(p_order uuid) returns bigint
language sql stable set search_path='' as $$
  select coalesce(sum(amount),0)::bigint from private.funding_submissions where order_id=p_order and state='verified';
$$;

create function private.case_entitlement(p_order uuid) returns private.case_amounts
language sql stable set search_path='' as $$
  select coalesce((select p.allocation from private.order_cases c join private.order_case_proposals p on p.case_id=c.id
    join private.order_case_reviews r on r.proposal_id=p.id
    where c.order_id=p_order and r.decision='approve' and p.outcome='resolve'
    order by r.created_at desc,p.id limit 1), (select row(purchase,fee,received-purchase-fee)::private.case_amounts from (
    select least(received,spent) purchase, least(greatest(received-spent,0),agreed_fee) fee,received
    from (select private.case_funding(p_order) received,
      coalesce((select spent from private.purchase_order_totals where order_id=p_order),0) spent,
      coalesce((select (terms->>'fee')::bigint from public.order_terms where order_id=p_order),0) agreed_fee) b
  ) amounts));
$$;

create function private.case_closed(p_case uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.order_case_proposals p join private.order_case_reviews r on r.proposal_id=p.id
    where p.case_id=p_case and r.decision='approve');
$$;

create function private.case_cancellation_pending(p_order uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.order_cases where order_id=p_order and kind='cancellation' and not private.case_closed(id));
$$;

create or replace function private.funding_purchase_ready(p_order uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.reservations r join public.orders o on o.id=r.order_id
    where r.order_id=p_order and o.state='awaiting_payment' and r.funding_verified_at is not null
      and r.released_at is null and private.funding_outstanding(p_order)=0
      and not exists (select 1 from private.order_amendments a where a.order_id=p_order and a.state='pending')
      and not private.case_cancellation_pending(p_order));
$$;

create function private.guard_case_fulfillment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if private.case_cancellation_pending(case when tg_table_name='orders' then to_jsonb(new)->>'id' else to_jsonb(new)->>'order_id' end::uuid) then
    raise exception 'CONFLICT: Cancellation review is pending';
  end if;
  return new;
end;
$$;
create trigger case_pause_handover before update of state on public.orders for each row
  when (new.state in ('delivering','delivery_confirmed') and old.state is distinct from new.state)
  execute function private.guard_case_fulfillment();
create trigger case_pause_new_amendment before insert on private.order_amendments
  for each row execute function private.guard_case_fulfillment();
create trigger case_pause_approved_amendment before update of state on private.order_amendments for each row
  when (new.state='approved' and old.state is distinct from new.state) execute function private.guard_case_fulfillment();
create trigger case_pause_funding_submission before update of state on private.funding_submissions for each row
  when (new.state='pending' and old.state is distinct from new.state) execute function private.guard_case_fulfillment();

create function private.case_claimed(p_order uuid) returns private.case_amounts
language sql stable set search_path='' as $$
  select coalesce(sum(amount) filter (where component='purchase'),0)::bigint,
    coalesce(sum(amount) filter (where component='fee'),0)::bigint,
    coalesce(sum(amount) filter (where component='refund'),0)::bigint
  from private.case_transfer_claims where order_id=p_order;
$$;

create function private.case_unheld(p_order uuid) returns private.case_amounts
language sql stable set search_path='' as $$
  select greatest((a).purchase-(s).purchase-coalesce((h).purchase,0),0),
    greatest((a).fee-(s).fee-coalesce((h).fee,0),0),greatest((a).refund-(s).refund-coalesce((h).refund,0),0)
  from (select private.case_entitlement(p_order) a,private.case_claimed(p_order) s,
    (select held from private.order_cases where order_id=p_order and not private.case_closed(id) limit 1) h) amounts;
$$;

create function private.case_operator_for(p_member uuid,p_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.orders o where o.id=p_order and p_member not in (o.customer_id,o.provider_id))
    and exists(select 1 from private.funding_submissions f where f.order_id=p_order and f.state='verified')
    and not exists(select 1 from private.funding_submissions f join private.funding_accounts a on a.id=f.account_id
      where f.order_id=p_order and f.state='verified' and (not a.enabled or not private.funding_operator_for(p_member,f.account_id)));
$$;

create function private.case_item_entitlement(p_order uuid,p_item integer) returns bigint
language sql stable set search_path='' as $$
  select greatest(0,coalesce((select sum(net) from private.purchase_allocations
    where order_id=p_order and item_index=p_item),0) -
    coalesce((select sum((c.baseline).purchase-(p.allocation).purchase)
      from private.order_cases c join private.order_case_proposals p on p.case_id=c.id
      join private.order_case_reviews r on r.proposal_id=p.id
      where c.order_id=p_order and c.item_index=p_item and p.outcome='resolve' and r.decision='approve'),0))::bigint;
$$;

create function private.case_item_unsettled(p_order uuid,p_item integer) returns bigint
language sql stable set search_path='' as $$
  select greatest(0,private.case_item_entitlement(p_order,p_item)-
    coalesce((select sum(amount) from private.case_transfer_claims where order_id=p_order and item_index=p_item),0))::bigint;
$$;

create function private.case_evidence_path(p_order uuid,p_key uuid,p_upload boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_path text;
begin
  if private.is_active_member() is not true or p_key is null or p_upload is null then
    raise exception 'PERMISSION: Case evidence unavailable';
  end if;
  if p_upload then
    if exists(select 1 from public.orders o where o.id=p_order and auth.uid() in (o.customer_id,o.provider_id)
        and o.state not in ('expired','cancelled')) and private.case_funding(p_order)>0 then
      return auth.uid()::text||'/'||p_order::text||'/'||p_key::text;
    end if;
  else
    select e.object_name into v_path from private.order_case_evidence e
      join private.order_cases c on c.id=e.case_id join public.orders o on o.id=c.order_id
      where e.id=p_key and o.id=p_order and (auth.uid() in (o.customer_id,o.provider_id)
        or (private.has_staff_role('finance_operation') and private.case_operator_for(auth.uid(),p_order)));
    if found then return v_path; end if;
  end if;
  raise exception 'PERMISSION: Case evidence unavailable';
end;
$$;

create function private.validate_case_allocation(p_case private.order_cases,p_outcome text,p_amounts private.case_amounts)
returns void language plpgsql stable set search_path='' as $$
declare
  v_current private.case_amounts := private.case_entitlement(p_case.order_id);
  v_claimed private.case_amounts := private.case_claimed(p_case.order_id);
begin
  if p_outcome is null or p_outcome not in ('resolve','dismiss')
    or p_amounts.purchase is null or p_amounts.fee is null or p_amounts.refund is null
    or least(p_amounts.purchase,p_amounts.fee,p_amounts.refund)<0
    or p_amounts.purchase::numeric+p_amounts.fee+p_amounts.refund<>private.case_funding(p_case.order_id)
    or p_amounts.purchase>v_current.purchase or p_amounts.fee>v_current.fee
    or p_amounts.purchase<v_claimed.purchase or p_amounts.fee<v_claimed.fee or p_amounts.refund<v_claimed.refund
    or (p_outcome='dismiss' and p_amounts is distinct from v_current) then
    raise exception 'VALIDATION: Allocation must conserve verified funds and remain within entitlement';
  end if;
  if p_outcome='resolve' and p_case.kind='cancellation' and p_amounts.fee>0
    and not exists(select 1 from private.purchase_allocations where order_id=p_case.order_id) then
    raise exception 'VALIDATION: Before purchase refund includes the agreed fee';
  end if;
  if p_case.kind='dispute' and (p_amounts.purchase<v_current.purchase-(p_case.held).purchase
    or p_amounts.fee<v_current.fee-(p_case.held).fee) then
    raise exception 'VALIDATION: Preserve unchallenged amounts';
  end if;
end;
$$;

create function private.lock_case_order(p_order uuid) returns public.orders
language plpgsql set search_path='' as $$
declare v_order public.orders%rowtype;
begin
  select * into strict v_order from public.orders where id=p_order for update;
  return v_order;
end;
$$;

-- Owner-only synthetic rehearsal of the BTP-17 lock boundary. Records capacity against the order without a bank operation.
create function private.claim_case_transfer(p_order uuid,p_component text,p_amount bigint,p_item integer) returns uuid
language plpgsql volatile set search_path='' as $$
declare v_order public.orders%rowtype; v_unheld private.case_amounts; v_cap bigint; v_id uuid;
begin
  v_order := private.lock_case_order(p_order);
  if v_order.state not in ('delivery_confirmed','cancelled')
    or exists(select 1 from private.funding_submissions where order_id=p_order and state='pending') then
    raise exception 'CONFLICT: Order is not eligible for a transfer';
  end if;
  if p_component is null or p_component not in ('purchase','fee','refund') or p_amount is null or p_amount<=0
    or (p_component='purchase')<>(p_item is not null) then raise exception 'VALIDATION: Invalid claim'; end if;
  v_unheld := private.case_unheld(p_order);
  if p_component='purchase' then
    v_cap := least(v_unheld.purchase,private.case_item_unsettled(p_order,p_item) -
      coalesce((select (held).purchase from private.order_cases where order_id=p_order and item_index=p_item
        and not private.case_closed(id) limit 1),0));
  elsif p_component='fee' then
    v_cap := v_unheld.fee;
  else
    v_cap := v_unheld.refund;
  end if;
  if p_amount>v_cap then raise exception 'CONFLICT: Insufficient unheld entitlement'; end if;
  insert into private.case_transfer_claims(order_id,component,amount,item_index) values(p_order,p_component,p_amount,p_item)
    returning id into v_id;
  return v_id;
end;
$$;

create function private.order_case_command(p_operation_id uuid,p_order uuid,p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
  v_kind text := p_payload->>'kind';
  v_reason text := btrim(p_payload->>'reason');
  v_held private.case_amounts;
  v_unheld private.case_amounts;
  v_entitlement private.case_amounts;
  v_case private.order_cases%rowtype;
  v_proposal private.order_case_proposals%rowtype;
  v_amounts private.case_amounts;
  v_result uuid;
  v_item integer;
  v_amount bigint;
  v_image_hash text := p_payload->>'imageHash';
  v_path text;
  v_evidence_count integer;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if p_operation_id is null or p_action is null or p_action not in ('open','evidence','propose','review')
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8192 then
    raise exception 'VALIDATION: Invalid case command';
  end if;
  if p_action in ('open','evidence') then
    if not exists(select 1 from public.orders where id=p_order and v_actor in (customer_id,provider_id)) then
      raise exception 'PERMISSION: Order case unavailable';
    end if;
  elsif private.has_staff_role('finance_operation') is not true or not private.case_operator_for(v_actor,p_order) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_order,p_action,p_payload)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'order_case',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts
    where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'order_case' or v_receipt.payload_hash<>v_hash then
    raise exception 'CONFLICT: Operation ID already used';
  end if;

  v_order := private.lock_case_order(p_order);
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if p_action in ('propose','review') and (private.has_staff_role('finance_operation') is not true or not private.case_operator_for(v_actor,p_order)) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if jsonb_typeof(p_payload->'reason') is distinct from 'string' or coalesce(char_length(v_reason),0) not between 1 and 1000 then
    raise exception 'VALIDATION: Case reason required';
  end if;
  if (p_action='open' and v_image_hash is not null) or p_action='evidence' or (p_action='open' and v_kind='dispute') then
    if v_image_hash is null or v_image_hash !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION: Case photo required'; end if;
    v_path := v_actor::text||'/'||p_order::text||'/'||p_operation_id::text||'/'||v_image_hash;
    if not exists(select 1 from storage.objects where bucket_id='order-case-evidence' and name=v_path
      and metadata->>'mimetype' in ('image/jpeg','image/png')
      and case when metadata->>'size' ~ '^[0-9]{1,7}$' then (metadata->>'size')::integer between 1 and 2097152 else false end) then
      raise exception 'VALIDATION: Evidence missing or belongs to another case';
    end if;
  end if;
  if p_action='open' then
    if v_kind is null or v_kind not in ('cancellation','dispute') then raise exception 'VALIDATION: Invalid case kind'; end if;
    if v_order.state in ('expired','cancelled') or (v_kind='cancellation' and v_order.state='delivery_confirmed') or private.case_funding(p_order)=0
      or exists(select 1 from private.order_cases where order_id=p_order and not private.case_closed(id))
      or exists(select 1 from private.funding_submissions where order_id=p_order and state='pending') then
      raise exception 'CONFLICT: New case unavailable';
    end if;
    v_entitlement := private.case_entitlement(p_order);
    v_unheld := private.case_unheld(p_order);
    v_held := v_unheld;
    if v_held=row(0,0,0)::private.case_amounts then raise exception 'CONFLICT: No unsettled amount remains'; end if;
    if v_kind='dispute' then
      if not exists(select 1 from private.purchase_completions where order_id=p_order) then
        raise exception 'CONFLICT: Complete purchase progress before opening an amount dispute';
      end if;
      if jsonb_typeof(p_payload->'amount') is distinct from 'number' or p_payload->>'amount' !~ '^[0-9]+$' then
        raise exception 'VALIDATION: Disputed amount must be whole IDR';
      end if;
      v_amount := (p_payload->>'amount')::bigint;
      if p_payload->>'component'='purchase' then
        if jsonb_typeof(p_payload->'itemIndex') is distinct from 'number' or p_payload->>'itemIndex' !~ '^[0-9]+$' then
          raise exception 'VALIDATION: Select a purchased item';
        end if;
        v_item := (p_payload->>'itemIndex')::integer;
        if v_amount<=0 or v_amount>least(v_unheld.purchase,private.case_item_unsettled(p_order,v_item)) then
          raise exception 'VALIDATION: Disputed amount exceeds purchased item entitlement';
        end if;
        v_held := row(v_amount,0,0);
      elsif p_payload->>'component'='fee' and v_amount between 1 and v_unheld.fee then
        v_held := row(0,v_amount,0);
      else
        raise exception 'VALIDATION: Disputed amount exceeds fee entitlement';
      end if;
    end if;
    insert into private.order_cases(id,order_id,opened_by,kind,reason,item_index,baseline,held)
      values(gen_random_uuid(),p_order,v_actor,v_kind,v_reason,v_item,v_entitlement,v_held) returning * into v_case;
    v_result := v_case.id;
  else
    select * into v_case from private.order_cases where id=(p_payload->>'caseId')::uuid and order_id=p_order;
    if not found or private.case_closed(v_case.id) then raise exception 'CONFLICT: Active case unavailable'; end if;
    select count(*) into v_evidence_count from private.order_case_evidence where case_id=v_case.id;
    if p_action='evidence' then
      if v_evidence_count>=8 then raise exception 'CONFLICT: Case evidence limit reached'; end if;
      v_result := v_case.id;
    elsif p_action='propose' then
      if exists(select 1 from unnest(array['purchase','fee','refund']) as field
        where jsonb_typeof(p_payload->field) is distinct from 'number' or p_payload->>field !~ '^[0-9]+$') then
        raise exception 'VALIDATION: Use whole IDR amounts';
      end if;
      v_amounts := row((p_payload->>'purchase')::bigint,(p_payload->>'fee')::bigint,(p_payload->>'refund')::bigint);
      perform private.validate_case_allocation(v_case,p_payload->>'outcome',v_amounts);
      insert into private.order_case_proposals(case_id,proposed_by,outcome,allocation,evidence_count,reason)
        values(v_case.id,v_actor,p_payload->>'outcome',v_amounts,v_evidence_count,v_reason) returning * into v_proposal;
      v_result := v_proposal.id;
    else
      select * into v_proposal from private.order_case_proposals
        where case_id=v_case.id order by created_at desc,id limit 1;
      if v_proposal.id is null or v_proposal.id is distinct from (p_payload->>'proposalId')::uuid
        or v_proposal.evidence_count<>v_evidence_count
        or exists(select 1 from private.order_case_reviews where proposal_id=v_proposal.id) then
        raise exception 'CONFLICT: Proposal changed';
      end if;
      if v_proposal.proposed_by=v_actor then raise exception 'PERMISSION: An independent reviewer is required'; end if;
      if private.case_operator_for(v_proposal.proposed_by,p_order) is not true then
        raise exception 'CONFLICT: Proposal author no longer authorized';
      end if;
      if p_payload->>'decision' is null or p_payload->>'decision' not in ('approve','return') then
        raise exception 'VALIDATION: Review decision required';
      end if;
      if p_payload->>'decision'='approve' then
        perform private.validate_case_allocation(v_case,v_proposal.outcome,v_proposal.allocation);
      end if;
      insert into private.order_case_reviews(proposal_id,reviewed_by,decision,reason)
        values(v_proposal.id,v_actor,p_payload->>'decision',v_reason);
      if p_payload->>'decision'='approve' and v_proposal.outcome='resolve' and v_case.kind='cancellation' then
        update public.orders set state='cancelled' where id=p_order;
      end if;
      v_result := v_proposal.id;
    end if;
  end if;
  if v_path is not null then
    insert into private.order_case_evidence(case_id,submitted_by,object_name,note) values(v_case.id,v_actor,v_path,v_reason);
  end if;
  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail) values(v_actor,p_operation_id,
    'case_'||p_action,p_order,jsonb_strip_nulls(jsonb_build_object('caseId',v_case.id,'kind',v_case.kind,
    'held',case when p_action='open' then to_jsonb(v_case.held) end,'proposalId',v_proposal.id,'decision',p_payload->>'decision')));
  update private.operation_receipts set result_id=v_result where actor_id=v_actor and operation_id=p_operation_id;
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'VALIDATION: Invalid case values';
end;
$$;

create function private.read_order_cases(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_case private.order_cases%rowtype;
  v_order public.orders%rowtype;
  v_amounts private.case_amounts;
  v_held private.case_amounts;
  v_unheld private.case_amounts;
  v_party boolean;
  v_open boolean;
  v_enabled boolean;
  v_proposal jsonb;
  v_case_data jsonb;
  v_items jsonb;
  v_count integer;
begin
  select * into v_order from public.orders where id=p_order;
  v_party := coalesce(auth.uid() in (v_order.customer_id,v_order.provider_id),false);
  if private.is_active_member() is not true or not (v_party
    or (private.has_staff_role('finance_operation') and private.case_operator_for(auth.uid(),p_order))) is true then
    raise exception 'PERMISSION: Order case unavailable';
  end if;
  v_amounts := private.case_entitlement(p_order);
  v_unheld := private.case_unheld(p_order);
  select * into v_case from private.order_cases where order_id=p_order order by opened_at desc,id desc limit 1;
  v_open := v_case.id is not null and not private.case_closed(v_case.id);
  v_held := case when v_open then v_case.held else row(0,0,0)::private.case_amounts end;
  if v_case.id is not null then
    select count(*) into v_count from private.order_case_evidence where case_id=v_case.id;
    select jsonb_build_object('id',p.id,'reason',p.reason,'outcome',p.outcome,'allocation',to_jsonb(p.allocation),
      'status',case when r.decision='approve' then 'approved' when r.decision='return' then 'returned'
        when p.evidence_count<>v_count or not private.case_operator_for(p.proposed_by,p_order) then 'stale' else 'pending' end,
      'canReview',not v_party and p.proposed_by<>auth.uid() and r.decision is null
        and p.evidence_count=v_count and private.case_operator_for(p.proposed_by,p_order),
      'reviewReason',r.reason) into v_proposal
    from private.order_case_proposals p left join private.order_case_reviews r on r.proposal_id=p.id
    where p.case_id=v_case.id order by p.created_at desc,p.id desc limit 1;
    v_case_data := jsonb_build_object('id',v_case.id,'kind',v_case.kind,'reason',v_case.reason,'itemIndex',v_case.item_index,
      'state',case when v_open then 'open' when v_proposal->>'outcome'='dismiss' then 'dismissed' else 'resolved' end,
      'proposal',v_proposal,'evidence',
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'note',note) order by created_at,id),'[]'::jsonb)
       from private.order_case_evidence where case_id=v_case.id));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('index',n-1,'name',item->>'name','available',
    least(v_unheld.purchase,private.case_item_unsettled(p_order,(n-1)::integer))) order by n),'[]'::jsonb) into v_items
  from jsonb_array_elements(private.purchase_items(p_order)) with ordinality as items(item,n);
  v_enabled := v_party and not v_open and v_order.state not in ('expired','cancelled')
    and not exists(select 1 from private.funding_submissions where order_id=p_order and state='pending');
  return jsonb_build_object('held',to_jsonb(v_held),'allocation',to_jsonb(v_amounts),
    'unheld',to_jsonb(v_unheld),'verified',private.case_funding(p_order),'case',v_case_data,'items',v_items,
    'access',case when v_party then 'member' else 'reviewer' end,
    'canCancel',v_enabled and v_order.state<>'delivery_confirmed' and v_unheld<>row(0,0,0)::private.case_amounts,
    'canDispute',v_enabled and (v_unheld.purchase>0 or v_unheld.fee>0)
      and exists(select 1 from private.purchase_completions where order_id=p_order));
end;
$$;

create function private.order_case_queue(p_order uuid,p_after uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_cursor timestamptz; v_queue jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  if p_after is not null then
    select opened_at into v_cursor from private.order_cases where id=p_after and private.case_operator_for(auth.uid(),order_id);
    if not found then raise exception 'VALIDATION: Invalid queue cursor'; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."openedAt",q.id),'[]'::jsonb) into v_queue from (
    select c.id,c.order_id as "orderId",t.terms->>'title' title,c.kind,c.opened_at as "openedAt"
    from private.order_cases c join public.order_terms t on t.order_id=c.order_id
    where (p_order is null or c.order_id=p_order) and (p_order is not null or not private.case_closed(c.id))
      and (v_cursor is null or (c.opened_at,c.id)>(v_cursor,p_after)) and private.case_operator_for(auth.uid(),c.order_id)
    order by c.opened_at,c.id limit 30
  ) q;
  return v_queue;
end;
$$;

create function public.order_case_command(p_operation_id uuid,p_order uuid,p_action text,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$
  select private.order_case_command(p_operation_id,p_order,p_action,p_payload);
$$;
create function public.read_order_cases(p_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.read_order_cases(p_order);
$$;
create function public.order_case_evidence(p_order uuid,p_key uuid,p_upload boolean) returns text
language sql stable security invoker set search_path='' as $$
  select private.case_evidence_path(p_order,p_key,p_upload);
$$;
create function public.order_case_queue(p_order uuid default null,p_after uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.order_case_queue(p_order,p_after);
$$;
revoke all on function private.case_funding(uuid),private.case_entitlement(uuid),private.lock_case_order(uuid),
  private.case_cancellation_pending(uuid),private.guard_case_fulfillment(),private.order_case_queue(uuid,uuid),public.order_case_queue(uuid,uuid),
  private.case_unheld(uuid),private.case_claimed(uuid),private.case_item_unsettled(uuid,integer),private.claim_case_transfer(uuid,text,bigint,integer),
  private.case_closed(uuid),private.case_operator_for(uuid,uuid),
  private.case_item_entitlement(uuid,integer),private.case_evidence_path(uuid,uuid,boolean),public.order_case_evidence(uuid,uuid,boolean),
  private.validate_case_allocation(private.order_cases,text,private.case_amounts),
  private.order_case_command(uuid,uuid,text,jsonb),private.read_order_cases(uuid),
  public.order_case_command(uuid,uuid,text,jsonb),public.read_order_cases(uuid) from public,anon,authenticated;
grant execute on function private.order_case_command(uuid,uuid,text,jsonb),private.read_order_cases(uuid),
  private.order_case_queue(uuid,uuid),public.order_case_queue(uuid,uuid),
  private.case_evidence_path(uuid,uuid,boolean),public.order_case_evidence(uuid,uuid,boolean),
  public.order_case_command(uuid,uuid,text,jsonb),public.read_order_cases(uuid) to authenticated;

insert into private.notification_rules(event_type,recipient_rule,target_kind,template,title,email_mode,implemented)
  values('order_case_activity','parties_and_assignees','order','order_case_activity.v1','Kasus pesanan diperbarui','in_app_only',true);
update private.notification_rules set implemented=true where event_type in ('order_cancelled','dispute_opened','dispute_resolved');

alter function private.notification_target_allowed(uuid,text,uuid) rename to btp16_previous_target_allowed;
create function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.btp16_previous_target_allowed(p_member,p_type,p_target)
    or (p_type in ('order_case_activity','dispute_opened','dispute_resolved')
      and (auth.uid() is distinct from p_member or private.has_staff_role('finance_operation'))
      and private.case_operator_for(p_member,p_target));
$$;

alter function private.notification_target(uuid) rename to btp16_previous_notification_target;
create function private.notification_target(p_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_order uuid;
begin
  select n.target_id into v_order from public.notifications n join public.orders o on o.id=n.target_id
    where n.id=p_id and n.event_type in ('order_case_activity','dispute_opened','dispute_resolved')
      and auth.uid() not in (o.customer_id,o.provider_id)
      and private.notification_visible(n.recipient_id,n.event_type,n.target_id);
  if found then return '/account/order-cases?order='||v_order::text; end if;
  return private.btp16_previous_notification_target(p_id);
end;
$$;
create or replace function public.notification_target(p_id uuid)
returns text language sql stable security invoker set search_path='' as $$ select private.notification_target(p_id); $$;

create function private.notify_order_case() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_staff uuid[]; v_event text; v_outcome text;
begin
  select * into strict v_order from public.orders where id=new.target_id;
  if new.event_type='case_review' and new.detail->>'decision'='approve' then
    select outcome into v_outcome from private.order_case_proposals where id=(new.detail->>'proposalId')::uuid;
  end if;
  v_event := case when new.event_type='case_open' and new.detail->>'kind'='dispute' then 'dispute_opened'
    when v_outcome is not null and new.detail->>'kind'='dispute' then 'dispute_resolved'
    when v_outcome='resolve' then 'order_cancelled' else 'order_case_activity' end;
  select coalesce(array_agg(distinct s.member_id),'{}'::uuid[]) into v_staff
  from private.funding_submissions f join private.funding_account_operators s on s.account_id=f.account_id
  where f.order_id=v_order.id and f.state='verified' and private.case_operator_for(s.member_id,v_order.id);
  perform private.enqueue_notification(new.id,v_event,v_order.id,new.actor_id,array[v_order.customer_id,v_order.provider_id]||v_staff);
  return new;
end;
$$;
create trigger order_case_notifications after insert on private.audit_events for each row
  when (new.event_type in ('case_open','case_evidence','case_propose','case_review')) execute function private.notify_order_case();
revoke all on function private.notification_target_allowed(uuid,text,uuid),private.notification_target(uuid),
  private.btp16_previous_notification_target(uuid),private.btp16_previous_target_allowed(uuid,text,uuid),
  private.notify_order_case() from public,anon,authenticated;
grant execute on function private.notification_target(uuid) to authenticated;
