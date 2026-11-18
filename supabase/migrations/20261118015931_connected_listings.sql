create table public.listings (
  id uuid primary key,
  owner_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('request', 'trip')),
  title text not null check (char_length(title) between 4 and 100),
  shop text not null check (char_length(shop) between 2 and 100),
  category text not null check (category in ('Makanan', 'Minuman', 'Belanja')),
  area text not null check (char_length(area) between 2 and 100),
  destination text not null check (char_length(destination) between 2 and 200),
  items jsonb not null,
  budget integer not null check (budget between 1000 and 150000),
  fee integer not null check (fee between 0 and 150000),
  bound integer not null check (bound between 0 and 150000),
  negotiable boolean not null,
  capacity integer not null check (capacity between 1 and 3 and (type <> 'request' or capacity = 1)),
  spending_capacity integer not null check (spending_capacity between 1000 and 450000 and spending_capacity >= budget),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  cutoff_at timestamptz not null check (cutoff_at <= start_at),
  status text not null check (status in ('active', 'paused', 'closed')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  check ((not negotiable and bound = fee) or (negotiable and ((type = 'request' and bound >= fee) or (type = 'trip' and bound <= fee))))
);
create index listings_board on public.listings(created_at desc, id desc) where status = 'active';
create index listings_owner on public.listings(owner_id, created_at desc, id desc);
alter table public.listings enable row level security;
revoke all on public.listings from public, anon, authenticated;
grant select on public.listings to authenticated;
create policy listings_owner_read on public.listings for select to authenticated
using (owner_id = (select auth.uid()) and (select private.is_active_member()));

create function private.save_listing(p_operation_id uuid, p_listing_id uuid, p_version integer, p_listing jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_row public.listings%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
  v_item jsonb;
  v_budget bigint := 0;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Active confirmed account required'; end if;
  if p_operation_id is null or p_listing_id is null or p_version is null or p_version < 0
    or p_listing is null or jsonb_typeof(p_listing) <> 'object'
    or not (p_listing ?& array['type','title','shop','category','area','destination','items','fee','bound','negotiable','capacity','spendingCapacity','start','end','cutoff','status'])
    or (p_listing - array['type','title','shop','category','area','destination','items','fee','bound','negotiable','capacity','spendingCapacity','start','end','cutoff','status']) <> '{}'::jsonb
    or octet_length(p_listing::text) > 8000 then raise exception 'VALIDATION: Invalid listing payload'; end if;
  if exists (select 1 from jsonb_each(p_listing) e where e.key not in ('items','fee','bound','negotiable','capacity','spendingCapacity') and jsonb_typeof(e.value) <> 'string')
    or jsonb_typeof(p_listing->'negotiable') <> 'boolean'
    or exists (select 1 from jsonb_each(p_listing) e where e.key in ('fee','bound','capacity','spendingCapacity') and (jsonb_typeof(e.value) <> 'number' or e.value::text !~ '^[0-9]+$'))
    or jsonb_typeof(p_listing->'items') <> 'array' then raise exception 'VALIDATION: Invalid field types'; end if;
  if jsonb_array_length(p_listing->'items') not between 1 and 20 then raise exception 'VALIDATION: Invalid items'; end if;
  for v_item in select value from jsonb_array_elements(p_listing->'items') loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ?& array['name','specification','quantity','unitBudget'])
      or (v_item - array['name','specification','quantity','unitBudget']) <> '{}'::jsonb
      or jsonb_typeof(v_item->'name') <> 'string' or jsonb_typeof(v_item->'specification') <> 'string'
      or char_length(btrim(v_item->>'name')) not between 1 and 100 or char_length(v_item->>'specification') > 200
      or jsonb_typeof(v_item->'quantity') <> 'number' or (v_item->>'quantity') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(v_item->'unitBudget') <> 'number' or (v_item->>'unitBudget') !~ '^[0-9]{1,6}$'
      or (v_item->>'quantity')::integer not between 1 and 50 or (v_item->>'unitBudget')::integer not between 1000 and 150000 then
      raise exception 'VALIDATION: Invalid shopping item';
    end if;
    v_budget := v_budget + (v_item->>'quantity')::integer * (v_item->>'unitBudget')::integer;
  end loop;
  v_row.type := p_listing->>'type'; v_row.title := btrim(p_listing->>'title');
  v_row.shop := btrim(p_listing->>'shop'); v_row.category := p_listing->>'category';
  v_row.area := btrim(p_listing->>'area'); v_row.destination := btrim(p_listing->>'destination');
  v_row.items := p_listing->'items'; v_row.budget := v_budget;
  v_row.fee := (p_listing->>'fee')::integer; v_row.bound := (p_listing->>'bound')::integer;
  v_row.negotiable := (p_listing->>'negotiable')::boolean; v_row.capacity := (p_listing->>'capacity')::integer;
  v_row.spending_capacity := (p_listing->>'spendingCapacity')::integer;
  if exists (select 1 from jsonb_each_text(p_listing) e where e.key in ('start','end','cutoff') and e.value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'VALIDATION: Schedule requires timezone'; end if;
  v_row.start_at := (p_listing->>'start')::timestamptz; v_row.end_at := (p_listing->>'end')::timestamptz;
  v_row.cutoff_at := (p_listing->>'cutoff')::timestamptz; v_row.status := p_listing->>'status';

  v_hash := encode(sha256(convert_to(jsonb_build_object('id',p_listing_id,'version',p_version,'listing',p_listing)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
  values(v_actor,p_operation_id,'save_listing',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command <> 'save_listing' or v_receipt.payload_hash <> v_hash then raise exception 'CONFLICT: Changed operation payload'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if v_row.cutoff_at <= now() or v_row.end_at > now() + interval '90 days' then raise exception 'VALIDATION: Use a future schedule within 90 days'; end if;
  if p_version = 0 then
    if exists(select 1 from public.listings where id=p_listing_id) then raise exception 'CONFLICT: Listing already exists'; end if;
    insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values(p_listing_id,v_actor,v_row.type,v_row.title,v_row.shop,v_row.category,v_row.area,v_row.destination,v_row.items,v_row.budget,v_row.fee,v_row.bound,v_row.negotiable,v_row.capacity,v_row.spending_capacity,v_row.start_at,v_row.end_at,v_row.cutoff_at,v_row.status);
  else
    perform 1 from public.listings where id=p_listing_id and owner_id=v_actor for update;
    if not found then raise exception 'PERMISSION: Only the owner can edit'; end if;
    update public.listings set type=v_row.type,title=v_row.title,shop=v_row.shop,category=v_row.category,area=v_row.area,destination=v_row.destination,
      items=v_row.items,budget=v_row.budget,fee=v_row.fee,bound=v_row.bound,negotiable=v_row.negotiable,capacity=v_row.capacity,spending_capacity=v_row.spending_capacity,
      start_at=v_row.start_at,end_at=v_row.end_at,cutoff_at=v_row.cutoff_at,status=v_row.status,version=version+1
    where id=p_listing_id and version=p_version;
    if not found then raise exception 'CONFLICT: Stale listing version'; end if;
  end if;
  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail)
  values(v_actor,p_operation_id,case when p_version=0 then 'listing_published' else 'listing_updated' end,p_listing_id,jsonb_build_object('version',p_version+1));
  update private.operation_receipts set result_id=p_listing_id where actor_id=v_actor and operation_id=p_operation_id;
  return p_listing_id;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'VALIDATION: Invalid listing fields';
end;
$$;
revoke all on function private.save_listing(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function private.save_listing(uuid,uuid,integer,jsonb) to authenticated;
create function public.save_listing(p_operation_id uuid,p_listing_id uuid,p_version integer,p_listing jsonb)
returns uuid language sql security invoker set search_path = '' as $$ select private.save_listing(p_operation_id,p_listing_id,p_version,p_listing); $$;
revoke all on function public.save_listing(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_listing(uuid,uuid,integer,jsonb) to authenticated;

create function private.browse_listings(p_type text,p_category text,p_search text,p_day date,p_before timestamptz,p_before_id uuid,p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb) from (
    select l.created_at,l.id,jsonb_build_object('id',l.id,'type',l.type,'title',l.title,'shop',l.shop,'category',l.category,'area',l.area,
      'items',l.items,'budget',l.budget,'fee',l.fee,'bound',l.bound,'negotiable',l.negotiable,'capacity',l.capacity,'spendingCapacity',l.spending_capacity,
      'start',l.start_at,'end',l.end_at,'cutoff',l.cutoff_at,'status',l.status,'version',l.version,'created_at',l.created_at) as row_data
    from public.listings l join public.members m on m.id=l.owner_id
    where l.status='active' and l.cutoff_at>now() and l.end_at>now() and m.status<>'suspended'
      and (p_type='all' or l.type=p_type) and (p_category='Semua' or l.category=p_category)
      and char_length(p_search)<=100 and position(lower(p_search) in lower(l.title || ' ' || l.shop || ' ' || l.area))>0
      and (p_day is null or (l.start_at>=p_day::timestamp at time zone 'Asia/Jakarta' and l.start_at<(p_day+1)::timestamp at time zone 'Asia/Jakarta'))
      and ((p_before is null and p_before_id is null) or (l.created_at,l.id)<(p_before,p_before_id))
      and (p_id is null or l.id=p_id)
    order by l.created_at desc,l.id desc limit 21
  ) rows;
$$;
revoke all on function private.browse_listings(text,text,text,date,timestamptz,uuid,uuid) from public,anon,authenticated;
grant usage on schema private to anon;
grant execute on function private.browse_listings(text,text,text,date,timestamptz,uuid,uuid) to anon,authenticated;
create function public.browse_listings(p_type text default 'all',p_category text default 'Semua',p_search text default '',p_day date default null,p_before timestamptz default null,p_before_id uuid default null,p_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.browse_listings(p_type,p_category,p_search,p_day,p_before,p_before_id,p_id); $$;
revoke all on function public.browse_listings(text,text,text,date,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.browse_listings(text,text,text,date,timestamptz,uuid,uuid) to anon,authenticated;
