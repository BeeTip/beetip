create function private.reconciliation_order(p_order public.orders, p_title text) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('order_id',p_order.id,'trip_id',p_order.trip_id,'title',p_title,
    'fulfillment',case when p_order.state='awaiting_payment'
      then coalesce(private.purchase_progress_state(p_order.id),'awaiting_purchase') else p_order.state end,
    'money_status',case
      when outstanding<0 or unallocated<0 or purchase_paid>(due).purchase or fee_paid>(due).fee
        or refund_paid>(due).refund then 'mismatch'
      when ambiguous>0 then 'ambiguous'
      when open_case then 'held'
      when outstanding=0 and unallocated=0 and started=0 and pending=0
        and purchase_paid=(due).purchase and fee_paid=(due).fee and refund_paid=(due).refund
        and p_order.state in ('delivery_confirmed','cancelled','expired') then 'settled'
      else 'outstanding' end,
    'amounts',jsonb_build_object(
      'received',received::text,'pending',pending::text,
      'item_budget',item_budget::text,'receipt_cost',receipt_cost::text,
      'unused_budget',greatest(item_budget-receipt_cost,0)::text,'agreed_fee',agreed_fee::text,
      'purchase_due',(due).purchase::text,'fee_due',(due).fee::text,'refund_due',(due).refund::text,
      'purchase_paid',purchase_paid::text,'fee_paid',fee_paid::text,'refund_paid',refund_paid::text,
      'platform_revenue','0','disclosed_charges','0',
      'started',started::text,'ambiguous',ambiguous::text,'held',held::text,
      'outstanding',outstanding::text,'unallocated',unallocated::text))
  from (
    select private.case_entitlement(p_order.id) due,
      private.case_funding(p_order.id) received,
      coalesce((select sum(f.amount) from private.funding_submissions f
        where f.order_id=p_order.id and f.state='pending'),0) pending,
      (select (terms->>'fee')::bigint from public.order_terms where order_id=p_order.id) agreed_fee,
      private.funding_required(p_order.id) item_and_fee,
      coalesce((select spent from private.purchase_order_totals where order_id=p_order.id),0) receipt_cost
  ) funding
  cross join lateral (
    select count(*)>0 open_case,coalesce(sum((c.held).purchase+(c.held).fee+(c.held).refund),0) held
    from private.order_cases c where c.order_id=p_order.id and not private.case_closed(c.id)
  ) cases
  cross join lateral (
    select coalesce(sum(t.amount) filter (where f.state='completed' and t.component='purchase'),0) purchase_paid,
      coalesce(sum(t.amount) filter (where f.state='completed' and t.component='fee'),0) fee_paid,
      coalesce(sum(t.amount) filter (where f.state='completed' and t.component='refund'),0) refund_paid,
      coalesce(sum(t.amount) filter (where f.state='started'),0) started,
      coalesce(sum(t.amount) filter (where f.state='ambiguous'),0) ambiguous
    from private.manual_transfers t join lateral (
      select state from private.manual_transfer_facts where transfer_id=t.id order by version desc limit 1
    ) f on true where t.order_id=p_order.id
  ) transfers
  cross join lateral (
    select item_and_fee-agreed_fee item_budget,
      received-purchase_paid-fee_paid-refund_paid outstanding,
      received-(due).purchase-(due).fee-(due).refund unallocated
  ) balances;
$$;

create function private.read_reconciliation(p_scope text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb;
begin
  if private.has_staff_role('finance_operation') is not true then
    raise exception 'PERMISSION: Finance MFA required';
  end if;
  if p_scope is null or p_scope not in ('list','order','trip') or (p_scope<>'list' and p_id is null) then
    raise exception 'VALIDATION: Invalid reconciliation scope';
  end if;

  with candidates as materialized (
    select o,t.terms->>'title' title,o.id,
      row_number() over (order by o.id) position
    from public.orders o join public.order_terms t on t.order_id=o.id
    where ((p_scope='list' and (p_id is null or o.id>p_id))
      or (p_scope='order' and o.id=p_id) or (p_scope='trip' and o.trip_id=p_id))
      and private.case_operator_for(auth.uid(),o.id)
      and not exists (
        select 1 from private.funding_submissions f
        join private.funding_accounts a on a.id=f.account_id
        left join private.synthetic_transfer_accounts s on s.account_id=a.id
        where f.order_id=o.id and f.state in ('pending','verified')
          and (s.account_id is null or not a.enabled or not private.funding_operator_for(auth.uid(),a.id))
      )
    order by o.id limit (case when p_scope='list' then 31 end)
  ), rows as materialized (
    select id,private.reconciliation_order(o,title) body from candidates where position<=30 or p_scope<>'list'
  ), totals as (
    select a.key,sum(a.value::numeric)::text amount
    from rows r cross join lateral jsonb_each_text(r.body->'amounts') a group by a.key
  )
  select jsonb_build_object('orders',coalesce((select jsonb_agg(body order by id) from rows),'[]'::jsonb),
    'totals',(select jsonb_object_agg(key,amount) from totals),
    'next_cursor',case when exists(select 1 from candidates where position=31 and p_scope='list')
      then (select id from candidates where position=30) end)
  into v_report;

  if p_scope<>'list' and jsonb_array_length(v_report->'orders')=0 then
    raise exception 'PERMISSION: Synthetic order or trip unavailable';
  end if;
  return v_report;
end;
$$;

create function public.read_reconciliation(p_scope text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.read_reconciliation(p_scope,p_id);
$$;

revoke all on function private.reconciliation_order(public.orders,text),
  private.read_reconciliation(text,uuid),public.read_reconciliation(text,uuid) from public,anon,authenticated;
grant execute on function private.read_reconciliation(text,uuid),public.read_reconciliation(text,uuid) to authenticated;

create table private.reconciliation_exports (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.members(id),
  scope text not null check (scope in ('order','trip')),
  scope_id uuid not null,
  order_count integer not null check (order_count>0),
  csv_sha256 text not null check (csv_sha256 collate "C" ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index reconciliation_exports_actor on private.reconciliation_exports(actor_id);
alter table private.reconciliation_exports enable row level security;
revoke all on private.reconciliation_exports from public,anon,authenticated;

create function private.reconciliation_csv_cell(p_value text) returns text
language sql immutable strict set search_path='' as $$
  select '"' || case when p_value<>'' and p_value collate "C" !~ '^[A-Za-z0-9]' then '''' else '' end
    || replace(p_value,'"','""') || '"';
$$;

create function private.export_reconciliation(p_scope text,p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_report jsonb;
  v_csv text;
  v_id uuid;
begin
  if p_scope is null or p_scope not in ('order','trip') then
    raise exception 'VALIDATION: Invalid export scope';
  end if;
  v_report := private.read_reconciliation(p_scope,p_id);
  select 'order_id,trip_id,title,fulfillment,money_status,' ||
    (select string_agg(key,',' order by key collate "C") from jsonb_object_keys(v_report->'totals') k(key)) || E'\r\n' ||
    string_agg(private.reconciliation_csv_cell(o->>'order_id') || ',' ||
      private.reconciliation_csv_cell(coalesce(o->>'trip_id','')) || ',' ||
      private.reconciliation_csv_cell(o->>'title') || ',' ||
      private.reconciliation_csv_cell(o->>'fulfillment') || ',' ||
      private.reconciliation_csv_cell(o->>'money_status') || ',' ||
      (select string_agg(value,',' order by key collate "C") from jsonb_each_text(o->'amounts')),
      E'\r\n' order by positions) || E'\r\n'
  into v_csv from jsonb_array_elements(v_report->'orders') with ordinality as r(o,positions);

  insert into private.reconciliation_exports(actor_id,scope,scope_id,order_count,csv_sha256)
  values(auth.uid(),p_scope,p_id,jsonb_array_length(v_report->'orders'),encode(sha256(convert_to(v_csv,'UTF8')),'hex'))
  returning id into v_id;
  return jsonb_build_object('id',v_id,'csv',v_csv);
end;
$$;

create function public.export_reconciliation(p_scope text,p_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select private.export_reconciliation(p_scope,p_id);
$$;

revoke all on function private.reconciliation_csv_cell(text),private.export_reconciliation(text,uuid),
  public.export_reconciliation(text,uuid) from public,anon,authenticated;
grant execute on function private.export_reconciliation(text,uuid),public.export_reconciliation(text,uuid) to authenticated;
