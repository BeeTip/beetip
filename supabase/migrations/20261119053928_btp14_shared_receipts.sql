create table private.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.members(id),
  listing_id uuid not null references public.listings(id),
  anchor_order_id uuid not null references public.orders(id),
  merchant text not null,
  merchant_key text not null,
  reference text not null,
  reference_key text not null,
  purchased_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider_id, merchant_key, purchased_on, reference_key)
);
create index purchase_receipts_listing on private.purchase_receipts(listing_id, provider_id, created_at desc, id);
create index purchase_receipts_anchor on private.purchase_receipts(anchor_order_id);

create table private.purchase_receipt_lines (
  receipt_id uuid not null references private.purchase_receipts(id),
  line_no integer not null check (line_no between 1 and 40),
  label text not null,
  quantity integer not null check (quantity between 1 and 1000),
  allocated_quantity integer not null default 0 check (allocated_quantity between 0 and quantity),
  gross bigint not null check (gross between 1 and 100000000),
  primary key (receipt_id, line_no)
);

create table private.purchase_receipt_discounts (
  receipt_id uuid primary key references private.purchase_receipts(id),
  amount bigint not null check (amount >= 0)
);

create table private.purchase_receipt_evidence (
  receipt_id uuid primary key references private.purchase_receipts(id),
  provider_id uuid not null references public.members(id),
  object_name text not null unique,
  image_hash text not null check (image_hash ~ '^[a-f0-9]{64}$'),
  unique (provider_id, image_hash)
);

create table private.purchase_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  terms_version integer not null,
  item_index integer not null check (item_index >= 0),
  receipt_id uuid not null,
  line_no integer not null,
  quantity integer not null check (quantity > 0),
  gross bigint not null check (gross >= 0),
  discount bigint not null check (discount between 0 and gross),
  net bigint generated always as (gross - discount) stored,
  foreign key (receipt_id, line_no) references private.purchase_receipt_lines(receipt_id, line_no)
);
create index purchase_allocations_line on private.purchase_allocations(receipt_id, line_no);
create index purchase_allocations_order on private.purchase_allocations(order_id, item_index);

create table private.purchase_order_totals (
  order_id uuid primary key references public.orders(id),
  spent bigint not null default 0 check (spent between 0 and 150000)
);

create table private.purchase_completions (
  order_id uuid primary key references public.orders(id),
  terms_version integer not null,
  note text,
  completed_at timestamptz not null default clock_timestamp()
);

create table private.purchase_unavailable_items (
  order_id uuid not null references private.purchase_completions(order_id),
  item_index integer not null check (item_index >= 0),
  quantity integer not null check (quantity > 0),
  primary key (order_id, item_index)
);

alter table private.purchase_receipts enable row level security;
alter table private.purchase_receipt_lines enable row level security;
alter table private.purchase_receipt_discounts enable row level security;
alter table private.purchase_receipt_evidence enable row level security;
alter table private.purchase_allocations enable row level security;
alter table private.purchase_order_totals enable row level security;
alter table private.purchase_completions enable row level security;
alter table private.purchase_unavailable_items enable row level security;
revoke all on private.purchase_receipts, private.purchase_receipt_lines, private.purchase_receipt_discounts,
  private.purchase_receipt_evidence, private.purchase_allocations, private.purchase_order_totals, private.purchase_completions,
  private.purchase_unavailable_items from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-receipts', 'purchase-receipts', false, 2097152, array['image/jpeg', 'image/png']);

create function private.purchase_items(p_order uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce((select items from private.order_amendments where order_id=p_order and state='approved'
    order by revision desc limit 1), (select terms->'items' from public.order_terms where order_id=p_order));
$$;

create function private.guard_purchased_items() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_items jsonb;
begin
  insert into private.purchase_order_totals as totals(order_id) values (new.order_id)
    on conflict (order_id) do update set spent=totals.spent;
  if exists (select 1 from private.purchase_completions where order_id=new.order_id) then
    raise exception 'CONFLICT: Shopping already completed';
  end if;
  v_items := private.purchase_items(new.order_id);
  if exists (select 1 from private.purchase_allocations a where a.order_id=new.order_id
    and (v_items->a.item_index) is distinct from (new.items->a.item_index)) then
    raise exception 'CONFLICT: Purchased items cannot change';
  end if;
  return new;
end;
$$;
create trigger amendments_preserve_purchased_items before insert on private.order_amendments
  for each row execute function private.guard_purchased_items();

create function private.purchase_evidence_path(p_order uuid, p_key uuid, p_upload boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_path text;
begin
  if private.is_active_member() is not true or p_key is null or p_upload is null then
    raise exception 'PERMISSION: Receipt evidence unavailable';
  end if;
  if p_upload then
    if exists (select 1 from public.orders o where o.id=p_order and o.provider_id=auth.uid())
      and private.funding_purchase_ready(p_order)
      and not exists (select 1 from private.purchase_completions where order_id=p_order) then
      return auth.uid()::text || '/' || p_order::text || '/' || p_key::text;
    end if;
  else
    select e.object_name into v_path from private.purchase_receipt_evidence e
      join private.purchase_receipts r on r.id=e.receipt_id
      join public.orders o on o.listing_id=r.listing_id and o.provider_id=r.provider_id
      where r.id=p_key and o.id=p_order and r.provider_id=auth.uid();
    if found then return v_path; end if;
  end if;
  raise exception 'PERMISSION: Receipt evidence unavailable';
end;
$$;

create function private.record_purchase(p_operation_id uuid, p_order uuid, p_version integer, p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_res public.reservations%rowtype;
  v_operation private.operation_receipts%rowtype;
  v_hash text;
  v_id uuid;
  v_receipt uuid;
  v_items jsonb;
  v_item jsonb;
  v_row jsonb;
  v_index integer;
  v_quantity integer;
  v_line private.purchase_receipt_lines%rowtype;
  v_used bigint;
  v_gross bigint;
  v_gross_before bigint;
  v_discount bigint;
  v_line_discount bigint;
  v_total bigint;
  v_prior bigint;
  v_spent bigint;
  v_merchant text;
  v_reference text;
  v_merchant_key text;
  v_reference_key text;
  v_date date;
  v_path text;
  v_image_hash text;
  v_note text;
  v_missing jsonb;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if p_operation_id is null or p_version is null or p_version<1 or p_action is null
    or p_action not in ('receipt','allocate','finish') or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>32768 then raise exception 'VALIDATION: Invalid purchase command'; end if;
  select * into v_order from public.orders where id=p_order and provider_id=v_actor;
  if not found then raise exception 'PERMISSION: Purchase unavailable'; end if;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_order,p_version,p_action,p_payload)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values (v_actor,p_operation_id,'record_purchase',v_hash) on conflict do nothing;
  select * into strict v_operation from private.operation_receipts
    where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_operation.command<>'record_purchase' or v_operation.payload_hash<>v_hash then
    raise exception 'CONFLICT: Operation ID already used';
  end if;
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  if v_operation.result_id is not null then return v_operation.result_id; end if;

  v_res := private.btp07_lock_payable_order(p_order);
  select * into strict v_order from public.orders where id=p_order;
  if private.is_active_member() is not true or v_order.provider_id<>v_actor then raise exception 'PERMISSION: Purchase unavailable'; end if;
  if v_order.terms_version<>p_version then raise exception 'CONFLICT: Order terms changed'; end if;
  insert into private.purchase_order_totals as totals(order_id) values (p_order)
    on conflict (order_id) do update set spent=totals.spent returning spent into v_spent;
  if not private.funding_purchase_ready(p_order) then raise exception 'CONFLICT: Purchase funding or approval pending'; end if;
  if exists (select 1 from private.purchase_completions where order_id=p_order) then raise exception 'CONFLICT: Shopping already completed'; end if;

  if p_action='receipt' then
    v_merchant := btrim(p_payload->>'merchant');
    v_reference := btrim(p_payload->>'reference');
    v_merchant_key := upper(regexp_replace(v_merchant, '[[:space:]]+', ' ', 'g'));
    v_reference_key := upper(regexp_replace(v_reference, '[[:space:]-]+', '', 'g'));
    if char_length(v_merchant) is null or char_length(v_merchant) not between 1 and 100
      or v_merchant ~ '[[:cntrl:]]' or v_reference is null or char_length(v_reference)>80
      or v_reference_key !~ '^[A-Z0-9][A-Z0-9/._]{0,59}$'
      or coalesce(p_payload->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(p_payload->>'discount','') !~ '^[0-9]{1,10}$'
      or jsonb_typeof(p_payload->'lines') is distinct from 'array' then
      raise exception 'VALIDATION: Invalid receipt header';
    end if;
    v_date := (p_payload->>'date')::date;
    if v_date < (v_order.created_at at time zone 'Asia/Jakarta')::date
      or v_date > (clock_timestamp() at time zone 'Asia/Jakarta')::date
      or jsonb_array_length(p_payload->'lines') not between 1 and 40 then
      raise exception 'VALIDATION: Invalid date or receipt lines';
    end if;
    v_path := private.purchase_evidence_path(p_order,p_operation_id,true);
    v_image_hash := p_payload->>'imageHash';
    if v_image_hash is null or v_image_hash !~ '^[a-f0-9]{64}$' or not exists (
      select 1 from storage.objects where bucket_id='purchase-receipts' and name=v_path||'/'||v_image_hash
        and metadata->>'mimetype' in ('image/jpeg','image/png')
        and case when metadata->>'size' ~ '^[0-9]{1,7}$' then (metadata->>'size')::integer between 1 and 2097152 else false end
    ) then raise exception 'VALIDATION: Receipt image missing or belongs to another order'; end if;
    insert into private.purchase_receipts(provider_id,listing_id,anchor_order_id,merchant,merchant_key,reference,reference_key,purchased_on)
      values (v_actor,v_order.listing_id,p_order,v_merchant,v_merchant_key,v_reference,v_reference_key,v_date)
      on conflict (provider_id,merchant_key,purchased_on,reference_key) do nothing returning id into v_id;
    if v_id is null then raise exception 'CONFLICT: Receipt reference already recorded'; end if;
    insert into private.purchase_receipt_evidence(receipt_id,provider_id,object_name,image_hash)
      values (v_id,v_actor,v_path||'/'||v_image_hash,v_image_hash) on conflict do nothing;
    if not found then raise exception 'CONFLICT: Receipt image already recorded'; end if;
    v_total := 0;
    v_index := 0;
    for v_row in select value from jsonb_array_elements(p_payload->'lines') loop
      v_index := v_index+1;
      if coalesce(char_length(btrim(v_row->>'label')),0) not between 1 and 100
        or coalesce(v_row->>'quantity','') !~ '^[0-9]{1,4}$' or (v_row->>'quantity')::integer not between 1 and 1000
        or coalesce(v_row->>'gross','') !~ '^[0-9]{1,9}$' or (v_row->>'gross')::bigint not between 1 and 100000000 then
        raise exception 'VALIDATION: Invalid receipt line';
      end if;
      v_gross := (v_row->>'gross')::bigint;
      insert into private.purchase_receipt_lines(receipt_id,line_no,label,quantity,gross)
        values (v_id,v_index,btrim(v_row->>'label'),(v_row->>'quantity')::integer,v_gross);
      v_total := v_total+v_gross;
    end loop;
    v_discount := (p_payload->>'discount')::bigint;
    if v_discount>v_total then raise exception 'VALIDATION: Discount exceeds receipt gross'; end if;
    insert into private.purchase_receipt_discounts(receipt_id,amount) values (v_id,v_discount);

  elsif p_action='allocate' then
    if jsonb_typeof(p_payload->'entries') is distinct from 'array' or p_payload->>'receipt' is null then
      raise exception 'VALIDATION: Invalid allocations';
    end if;
    if jsonb_array_length(p_payload->'entries') not between 1 and 40 then raise exception 'VALIDATION: Invalid allocations'; end if;
    if exists (select 1 from jsonb_array_elements(p_payload->'entries') row
      group by row->>'line',row->>'item' having count(*)>1) then raise exception 'VALIDATION: Duplicate allocation row'; end if;
    select id into v_receipt from private.purchase_receipts where id=(p_payload->>'receipt')::uuid
      and listing_id=v_order.listing_id and provider_id=v_actor
      and purchased_on>=(v_order.created_at at time zone 'Asia/Jakarta')::date for update;
    if not found then raise exception 'PERMISSION: Receipt unavailable'; end if;
    v_items := private.purchase_items(p_order);
    select sum(gross) into strict v_total from private.purchase_receipt_lines where receipt_id=v_receipt;
    select amount into strict v_discount from private.purchase_receipt_discounts where receipt_id=v_receipt;
    for v_row in select value from jsonb_array_elements(p_payload->'entries') loop
      if coalesce(v_row->>'line','') !~ '^[0-9]{1,2}$' or coalesce(v_row->>'item','') !~ '^[0-9]{1,2}$'
        or coalesce(v_row->>'quantity','') !~ '^[0-9]{1,4}$' then raise exception 'VALIDATION: Invalid allocation'; end if;
      v_index := (v_row->>'item')::integer;
      v_quantity := (v_row->>'quantity')::integer;
      v_item := v_items->v_index;
      if v_item is null or v_quantity<1 then raise exception 'VALIDATION: Invalid order item or quantity'; end if;
      select * into v_line from private.purchase_receipt_lines where receipt_id=v_receipt and line_no=(v_row->>'line')::integer for update;
      if not found then raise exception 'VALIDATION: Unknown receipt line'; end if;
      v_used := v_line.allocated_quantity;
      if v_used+v_quantity>v_line.quantity then raise exception 'CONFLICT: Receipt line quantity exhausted'; end if;
      select coalesce(sum(quantity),0) into v_prior from private.purchase_allocations where order_id=p_order and item_index=v_index;
      if v_prior+v_quantity>(v_item->>'quantity')::integer then raise exception 'CONFLICT: Order item quantity exceeded'; end if;

      select coalesce(sum(gross),0) into v_prior from private.purchase_receipt_lines where receipt_id=v_receipt and line_no<v_line.line_no;
      v_line_discount := (div(v_discount::numeric*(v_prior+v_line.gross),v_total)-div(v_discount::numeric*v_prior,v_total))::bigint;
      v_gross_before := v_line.gross*v_used/v_line.quantity;
      v_gross := v_line.gross*(v_used+v_quantity)/v_line.quantity-v_gross_before;
      v_line_discount := v_line_discount*(v_gross_before+v_gross)/v_line.gross-v_line_discount*v_gross_before/v_line.gross;
      v_spent := v_spent+v_gross-v_line_discount;
      if v_spent>v_res.amount or v_gross-v_line_discount>v_quantity*(v_item->>'unitBudget')::bigint then
        raise exception 'CONFLICT: Approved purchase budget exceeded';
      end if;
      insert into private.purchase_allocations(order_id,terms_version,item_index,receipt_id,line_no,quantity,gross,discount)
        values (p_order,p_version,v_index,v_receipt,v_line.line_no,v_quantity,v_gross,v_line_discount) returning id into v_id;
      update private.purchase_receipt_lines set allocated_quantity=allocated_quantity+v_quantity
        where receipt_id=v_receipt and line_no=v_line.line_no;
    end loop;
    update private.purchase_order_totals set spent=v_spent where order_id=p_order;

  else
    v_items := private.purchase_items(p_order);
    v_note := nullif(btrim(p_payload->>'note'),'');
    select coalesce(jsonb_agg(i.idx-1 order by i.idx) filter (where i.remaining>0),'[]'::jsonb) into v_missing
      from (select ordinality as idx,(value->>'quantity')::integer-coalesce((
        select sum(quantity) from private.purchase_allocations where order_id=p_order and item_index=ordinality-1),0) as remaining
        from jsonb_array_elements(v_items) with ordinality) i;
    if p_payload->'unavailable' is distinct from v_missing or coalesce(char_length(v_note),0)>400
      or (v_missing<>'[]'::jsonb and v_note is null) then
      raise exception 'CONFLICT: Confirm all remaining quantities and provide a reason';
    end if;
    insert into private.purchase_completions(order_id,terms_version,note) values (p_order,p_version,v_note);
    insert into private.purchase_unavailable_items(order_id,item_index,quantity)
      select p_order,ordinality-1,(value->>'quantity')::integer-coalesce((
        select sum(quantity) from private.purchase_allocations where order_id=p_order and item_index=ordinality-1),0)
      from jsonb_array_elements(v_items) with ordinality where v_missing @> jsonb_build_array(ordinality-1);
    v_id := p_order;
  end if;

  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail)
    values (v_actor,p_operation_id,'purchase_'||p_action,p_order,jsonb_build_object('resultId',v_id,'termsVersion',p_version));
  update private.operation_receipts set result_id=v_id where actor_id=v_actor and operation_id=p_operation_id;
  return v_id;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'VALIDATION: Invalid receipt or allocation values';
end;
$$;

create function private.purchase_progress_state(p_order uuid) returns text
language sql stable set search_path='' as $$
  select case when exists (select 1 from private.purchase_completions where order_id=p_order) then
    case when not exists (select 1 from private.purchase_unavailable_items where order_id=p_order) then 'purchased'
      when exists (select 1 from private.purchase_allocations where order_id=p_order) then 'purchase_partial'
      else 'purchase_unavailable' end
    when exists (select 1 from private.purchase_allocations where order_id=p_order) then 'purchasing' end;
$$;

create function private.read_purchase(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_provider boolean;
  v_result jsonb;
begin
  if private.is_active_member() is not true then raise exception 'PERMISSION: Active member required'; end if;
  select * into v_order from public.orders where id=p_order and auth.uid() in (customer_id,provider_id);
  if not found then raise exception 'PERMISSION: Purchase unavailable'; end if;
  v_provider := auth.uid()=v_order.provider_id;
  select jsonb_build_object('version',v_order.terms_version,'provider',v_provider,
    'customerName',case when v_provider then (select display_name from public.members where id=v_order.customer_id) end,
    'tripOrders',case when v_provider and v_order.trip_id is not null then coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'name',m.display_name,'state',private.btp13_order_state(o,related)) order by o.created_at,o.id)
      from public.orders o join public.members m on m.id=o.customer_id join public.reservations related on related.order_id=o.id
      where o.trip_id=v_order.trip_id and o.provider_id=v_order.provider_id and o.id<>p_order),'[]'::jsonb) else '[]'::jsonb end,
    'ready',private.funding_purchase_ready(p_order), 'state',private.purchase_progress_state(p_order),
    'budget',r.amount,'spent',coalesce(t.spent,0),
    'note',c.note,'items',coalesce((select jsonb_agg(jsonb_build_object('index',i.ordinality-1,'name',i.value->>'name',
      'specification',i.value->>'specification','quantity',(i.value->>'quantity')::integer,'unitBudget',(i.value->>'unitBudget')::bigint,
      'purchased',coalesce((select sum(quantity) from private.purchase_allocations where order_id=p_order and item_index=i.ordinality-1),0),
      'unavailable',coalesce((select quantity from private.purchase_unavailable_items where order_id=p_order and item_index=i.ordinality-1),0))
      order by i.ordinality) from jsonb_array_elements(private.purchase_items(p_order)) with ordinality i),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'receipt',a.receipt_id,'merchant',h.merchant,
      'date',h.purchased_on,'reference',h.reference,'item',a.item_index,'line',a.line_no,'label',l.label,'quantity',a.quantity,
      'gross',a.gross,'discount',a.discount,'net',a.net) order by h.created_at,a.line_no,a.id)
      from private.purchase_allocations a join private.purchase_receipt_lines l using (receipt_id,line_no)
      join private.purchase_receipts h on h.id=a.receipt_id where a.order_id=p_order),'[]'::jsonb),
    'receipts',case when v_provider and c.order_id is null then coalesce((select jsonb_agg(h.entry order by h.created_at desc,h.id)
      from (select h.id,h.created_at,jsonb_build_object('id',h.id,'merchant',h.merchant,'reference',h.reference,'date',h.purchased_on,
        'discount',d.amount,'lines',lines.entries) entry
        from private.purchase_receipts h join private.purchase_receipt_discounts d on d.receipt_id=h.id
        cross join lateral (select jsonb_agg(jsonb_build_object('line',l.line_no,'label',l.label,'gross',l.gross,
          'remaining',l.quantity-l.allocated_quantity) order by l.line_no) entries
          from private.purchase_receipt_lines l where l.receipt_id=h.id and l.quantity>l.allocated_quantity) lines
        where h.listing_id=v_order.listing_id and h.provider_id=v_order.provider_id and lines.entries is not null
          and h.purchased_on>=(v_order.created_at at time zone 'Asia/Jakarta')::date
        order by h.created_at desc,h.id) h),'[]'::jsonb) else '[]'::jsonb end)
  into v_result from public.reservations r left join private.purchase_completions c on c.order_id=r.order_id
  left join private.purchase_order_totals t on t.order_id=r.order_id
  where r.order_id=p_order;
  return v_result;
end;
$$;

create or replace function private.btp13_order_state(p_order public.orders,p_reservation public.reservations)
returns text language sql volatile set search_path='' as $$
  select case when p_order.state='awaiting_payment' and p_order.terms_version>1
    and p_reservation.funding_verified_at is not null and private.funding_outstanding(p_order.id)>0 then 'awaiting_top_up'
    when p_order.state='awaiting_payment' and private.purchase_progress_state(p_order.id) is not null then private.purchase_progress_state(p_order.id)
    else private.btp07_order_state(p_order.state,p_reservation.expires_at,p_reservation.released_at,p_reservation.funding_verified_at) end;
$$;

create function public.record_purchase(p_operation_id uuid, p_order uuid, p_version integer, p_action text, p_payload jsonb)
returns uuid language sql security invoker set search_path='' as $$
  select private.record_purchase(p_operation_id,p_order,p_version,p_action,p_payload);
$$;
create function public.read_purchase(p_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.read_purchase(p_order); $$;
create function public.purchase_evidence_path(p_order uuid, p_key uuid, p_upload boolean) returns text
language sql stable security invoker set search_path='' as $$ select private.purchase_evidence_path(p_order,p_key,p_upload); $$;

revoke all on function private.purchase_items(uuid), private.guard_purchased_items(), private.purchase_progress_state(uuid),
  private.record_purchase(uuid,uuid,integer,text,jsonb), private.read_purchase(uuid), private.purchase_evidence_path(uuid,uuid,boolean),
  public.record_purchase(uuid,uuid,integer,text,jsonb), public.read_purchase(uuid), public.purchase_evidence_path(uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function private.record_purchase(uuid,uuid,integer,text,jsonb), private.read_purchase(uuid),
  private.purchase_evidence_path(uuid,uuid,boolean), public.record_purchase(uuid,uuid,integer,text,jsonb),
  public.read_purchase(uuid), public.purchase_evidence_path(uuid,uuid,boolean) to authenticated;
