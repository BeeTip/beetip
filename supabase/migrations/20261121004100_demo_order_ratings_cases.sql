create or replace function private.submit_order_rating(p_operation_id uuid,p_order_id uuid,p_score integer,p_feedback text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_feedback text := btrim(p_feedback, E' \t\n\r');
  v_order public.orders%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active confirmed account required'; end if;
  if p_operation_id is null or p_order_id is null or p_score is null or p_score not between 1 and 5
    or v_feedback is null or char_length(v_feedback)>500 or octet_length(p_feedback)>2000 then
    raise exception 'VALIDATION: Invalid order rating';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_order_id,p_score,v_feedback)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'submit_order_rating',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'submit_order_rating' or v_receipt.payload_hash<>v_hash then
    raise exception 'CONFLICT: Changed operation payload';
  end if;

  select * into v_order from public.orders where id=p_order_id and v_actor in (customer_id,provider_id) for update;
  if not found or private.is_active_member() is not true then raise exception 'PERMISSION: Order unavailable'; end if;
  if v_receipt.result_id is not null then return private.read_order_rating(p_order_id); end if;
  if v_order.state<>'delivery_confirmed' then
    raise exception 'CONFLICT: Order is not eligible for rating';
  end if;

  insert into private.order_ratings(order_id,author_id,score,feedback) values(p_order_id,v_actor,p_score,v_feedback)
    on conflict(order_id,author_id) do nothing;
  if not found then raise exception 'CONFLICT: Rating already submitted'; end if;
  update private.operation_receipts set result_id=p_order_id where actor_id=v_actor and operation_id=p_operation_id;
  return jsonb_build_object('score',p_score,'feedback',v_feedback);
end;
$$;

create table private.booth_case_operators (
  order_id uuid not null references public.orders(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (order_id,member_id)
);
create index booth_case_operators_member on private.booth_case_operators(member_id);
alter table private.booth_case_operators enable row level security;
revoke all on private.booth_case_operators from public,anon,authenticated;

create function private.case_reviewer_for(p_member uuid,p_order uuid) returns boolean
language sql stable set search_path='' as $$
  select case when exists(select 1 from public.orders where id=p_order and booth_demo) then
    exists(select 1 from private.booth_case_operators s join public.orders o on o.id=s.order_id
      where s.order_id=p_order and s.member_id=p_member and p_member not in (o.customer_id,o.provider_id))
    and private.notification_recipient_active(p_member)
    and exists(select 1 from public.staff_roles where member_id=p_member and role='finance_operation' and revoked_at is null)
    and exists(select 1 from auth.mfa_factors where user_id=p_member and status='verified')
  else private.case_operator_for(p_member,p_order) end;
$$;

create function private.booth_case_openable(p_order public.orders) returns boolean
language sql stable set search_path='' as $$
  select p_order.state in ('delivering','delivery_confirmed')
    or (p_order.state='awaiting_payment' and exists(select 1 from public.reservations r
      where r.order_id=p_order.id and r.released_at is null and r.expires_at>statement_timestamp()));
$$;

revoke all on function private.case_reviewer_for(uuid,uuid),private.booth_case_openable(public.orders)
  from public,anon,authenticated;


create or replace function private.case_evidence_path(p_order uuid,p_key uuid,p_upload boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_path text;
begin
  if private.is_active_member() is not true or p_key is null or p_upload is null then
    raise exception 'PERMISSION: Case evidence unavailable';
  end if;
  if p_upload then
    if exists(select 1 from public.orders o where o.id=p_order and auth.uid() in (o.customer_id,o.provider_id)
        and o.booth_demo and o.state not in ('expired','cancelled')) then
      return auth.uid()::text||'/'||p_order::text||'/'||p_key::text;
    end if;
  else
    select e.object_name into v_path from private.order_case_evidence e
      join private.order_cases c on c.id=e.case_id join public.orders o on o.id=c.order_id
      where e.id=p_key and o.id=p_order and (auth.uid() in (o.customer_id,o.provider_id)
        or (private.has_staff_role('finance_operation') and private.case_reviewer_for(auth.uid(),p_order)));
    if found then return v_path; end if;
  end if;
  raise exception 'PERMISSION: Case evidence unavailable';
end;
$$;

create or replace function private.order_case_command(p_operation_id uuid,p_order uuid,p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
  v_kind text := p_payload->>'kind';
  v_reason text := btrim(p_payload->>'reason');
  v_zero constant private.case_amounts := row(0,0,0);
  v_case private.order_cases%rowtype;
  v_proposal private.order_case_proposals%rowtype;
  v_amounts private.case_amounts;
  v_result uuid;
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
  elsif private.has_staff_role('finance_operation') is not true or not private.case_reviewer_for(v_actor,p_order) then
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
  if p_action in ('propose','review') and (private.has_staff_role('finance_operation') is not true or not private.case_reviewer_for(v_actor,p_order)) then
    raise exception 'PERMISSION: Finance MFA and account scope required';
  end if;
  if not v_order.booth_demo then raise exception 'PERMISSION: Legacy order cases are read-only'; end if;
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
    if not private.booth_case_openable(v_order) or (v_kind='cancellation' and v_order.state='delivery_confirmed')
      or exists(select 1 from private.order_cases where order_id=p_order and not private.case_closed(id))
      or exists(select 1 from private.funding_submissions where order_id=p_order and state='pending') then
      raise exception 'CONFLICT: New case unavailable';
    end if;
    if v_kind='dispute' then
      if not exists(select 1 from private.purchase_completions where order_id=p_order) then
        raise exception 'CONFLICT: Complete purchase progress before opening a dispute';
      end if;
      if p_payload ?| array['amount','component','itemIndex'] then
        raise exception 'VALIDATION: Demo disputes do not specify money or an item allocation';
      end if;
    end if;
    insert into private.order_cases(id,order_id,opened_by,kind,reason,baseline,held)
      values(gen_random_uuid(),p_order,v_actor,v_kind,v_reason,v_zero,v_zero) returning * into v_case;
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
      if private.case_reviewer_for(v_proposal.proposed_by,p_order) is not true then
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
        update public.reservations set released_at=clock_timestamp()
          where order_id=p_order and released_at is null and funding_verified_at is null;
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

create or replace function private.read_order_cases(p_order uuid) returns jsonb
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
    or (private.has_staff_role('finance_operation') and private.case_reviewer_for(auth.uid(),p_order))) is true then
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
        when p.evidence_count<>v_count or not private.case_reviewer_for(p.proposed_by,p_order) then 'stale' else 'pending' end,
      'canReview',v_order.booth_demo and not v_party and p.proposed_by<>auth.uid() and r.decision is null
        and p.evidence_count=v_count and private.case_reviewer_for(p.proposed_by,p_order),
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
  v_enabled := v_order.booth_demo and v_party and not v_open and private.booth_case_openable(v_order)
    and not exists(select 1 from private.funding_submissions where order_id=p_order and state='pending');
  return jsonb_build_object('held',to_jsonb(v_held),'allocation',to_jsonb(v_amounts),
    'unheld',to_jsonb(v_unheld),'verified',private.case_funding(p_order),'case',v_case_data,'items',v_items,
    'boothDemo',v_order.booth_demo,'access',case when v_party then 'member' else 'reviewer' end,
    'canCancel',v_enabled and v_order.state<>'delivery_confirmed',
    'canDispute',v_enabled
      and exists(select 1 from private.purchase_completions where order_id=p_order));
end;
$$;

create or replace function private.order_case_queue(p_order uuid,p_after uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_cursor timestamptz; v_queue jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then raise exception 'PERMISSION: Finance MFA required'; end if;
  if p_after is not null then
    select opened_at into v_cursor from private.order_cases where id=p_after and private.case_reviewer_for(auth.uid(),order_id);
    if not found then raise exception 'VALIDATION: Invalid queue cursor'; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."openedAt",q.id),'[]'::jsonb) into v_queue from (
    select c.id,c.order_id as "orderId",t.terms->>'title' title,c.kind,c.opened_at as "openedAt"
    from private.order_cases c join public.order_terms t on t.order_id=c.order_id
    where (p_order is null or c.order_id=p_order) and (p_order is not null or not private.case_closed(c.id))
      and (v_cursor is null or (c.opened_at,c.id)>(v_cursor,p_after)) and private.case_reviewer_for(auth.uid(),c.order_id)
    order by c.opened_at,c.id limit 30
  ) q;
  return v_queue;
end;
$$;

create or replace function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.btp16_previous_target_allowed(p_member,p_type,p_target)
    or (p_type in ('order_case_activity','dispute_opened','dispute_resolved')
      and (auth.uid() is distinct from p_member or private.has_staff_role('finance_operation'))
      and private.case_reviewer_for(p_member,p_target));
$$;

create or replace function private.notify_order_case() returns trigger
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
  if v_order.booth_demo then
    select coalesce(array_agg(s.member_id),'{}'::uuid[]) into v_staff
      from private.booth_case_operators s
      where s.order_id=v_order.id and private.case_reviewer_for(s.member_id,v_order.id);
  end if;
  perform private.enqueue_notification(new.id,v_event,v_order.id,new.actor_id,array[v_order.customer_id,v_order.provider_id]||v_staff);
  return new;
end;
$$;
