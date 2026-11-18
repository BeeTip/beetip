create table public.offers (
  id uuid primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  author_id uuid not null references public.members(id) on delete cascade,
  owner_id uuid not null references public.members(id) on delete cascade,
  version integer not null check (version > 0),
  listing_version integer not null check (listing_version > 0),
  fee integer not null check (fee between 0 and 150000),
  status text not null check (status in ('active', 'withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  check (author_id <> owner_id)
);
create unique index offers_one_active on public.offers(listing_id, author_id) where status = 'active';
create index offers_author on public.offers(author_id, created_at desc, id desc);
create index offers_listing on public.offers(listing_id, created_at desc, id desc);
create index offers_owner on public.offers(owner_id);
alter table public.offers enable row level security;
revoke all on public.offers from public, anon, authenticated;
grant select on public.offers to authenticated;
create policy offers_participant_read on public.offers for select to authenticated
using ((author_id = (select auth.uid()) or owner_id = (select auth.uid())) and (select private.is_active_member()));

create table public.offer_revisions (
  offer_id uuid not null references public.offers(id) on delete cascade,
  version integer not null,
  listing_version integer not null,
  fee integer not null,
  status text not null,
  terms jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (offer_id, version)
);
alter table public.offer_revisions enable row level security;
revoke all on public.offer_revisions from public, anon, authenticated;
grant select on public.offer_revisions to authenticated;
create policy offer_revisions_participant_read on public.offer_revisions for select to authenticated
using (exists (select 1 from public.offers o where o.id = offer_id));

create function private.save_offer(p_operation_id uuid,p_offer_id uuid,p_listing_id uuid,p_version integer,p_listing_version integer,p_fee integer,p_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_offer public.offers%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if p_operation_id is null or p_offer_id is null or p_listing_id is null or p_version is null or p_version < 0
    or p_listing_version is null or p_listing_version < 1 or p_fee is null or p_fee not between 0 and 150000
    or p_action is null or p_action not in ('save','withdraw') then raise exception 'VALIDATION: Invalid offer'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('offer',p_offer_id,'listing',p_listing_id,'version',p_version,'listingVersion',p_listing_version,'fee',p_fee,'action',p_action)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'save_offer',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command <> 'save_offer' or v_receipt.payload_hash <> v_hash then raise exception 'CONFLICT: Changed operation payload'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;

  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'PERMISSION: Listing unavailable'; end if;
  if v_listing.owner_id=v_actor then raise exception 'PERMISSION: Owner cannot propose an offer'; end if;
  if p_version > 0 then
    select * into v_offer from public.offers where id=p_offer_id and listing_id=p_listing_id and author_id=v_actor for update;
    if not found then raise exception 'PERMISSION: Only author can change offer'; end if;
    if v_offer.version<>p_version or v_offer.status<>'active' then raise exception 'CONFLICT: Offer changed'; end if;
  elsif p_action='withdraw' then raise exception 'VALIDATION: No offer to withdraw';
  end if;

  if p_action='save' then
    if not exists(select 1 from public.members where id=v_listing.owner_id and status<>'suspended') then raise exception 'PERMISSION: Listing unavailable'; end if;
    if v_listing.status<>'active' or v_listing.cutoff_at<=now() then raise exception 'CONFLICT: Listing closed'; end if;
    if v_listing.version<>p_listing_version then raise exception 'CONFLICT: Confirm current listing terms'; end if;
    if (not v_listing.negotiable and p_fee<>v_listing.fee)
      or (v_listing.type='request' and p_fee>v_listing.bound)
      or (v_listing.type='trip' and p_fee<v_listing.bound) then raise exception 'VALIDATION: Fee outside listing bounds'; end if;
  elsif p_listing_version<>v_offer.listing_version or p_fee<>v_offer.fee then
    raise exception 'CONFLICT: Withdrawal must match existing offer';
  end if;

  if p_version=0 then
    insert into public.offers(id,listing_id,author_id,owner_id,version,listing_version,fee,status)
      values(p_offer_id,p_listing_id,v_actor,v_listing.owner_id,1,p_listing_version,p_fee,'active');
  else
    update public.offers set version=version+1,
      listing_version=case when p_action='save' then p_listing_version else listing_version end,
      fee=p_fee,status=case when p_action='save' then 'active' else 'withdrawn' end where id=p_offer_id;
  end if;
  insert into public.offer_revisions(offer_id,version,listing_version,fee,status,terms)
    select id,version,listing_version,fee,status,
      case when p_action='save' then jsonb_build_object('type',v_listing.type,'items',v_listing.items,'budget',v_listing.budget,'start',v_listing.start_at,'end',v_listing.end_at,'cutoff',v_listing.cutoff_at,'fee',v_listing.fee,'bound',v_listing.bound,'negotiable',v_listing.negotiable)
      else (select r.terms from public.offer_revisions r where r.offer_id=p_offer_id order by r.version desc limit 1) end
    from public.offers where id=p_offer_id;
  insert into private.audit_events(actor_id,operation_id,event_type,target_id,detail)
    values(v_actor,p_operation_id,case when p_action='withdraw' then 'offer_withdrawn' else 'offer_saved' end,p_offer_id,jsonb_build_object('version',p_version+1,'listingVersion',p_listing_version));
  update private.operation_receipts set result_id=p_offer_id where actor_id=v_actor and operation_id=p_operation_id;
  return p_offer_id;
exception when unique_violation then raise exception 'CONFLICT: Active offer already exists';
end;
$$;
revoke all on function private.save_offer(uuid,uuid,uuid,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function private.save_offer(uuid,uuid,uuid,integer,integer,integer,text) to authenticated;
create function public.save_offer(p_operation_id uuid,p_offer_id uuid,p_listing_id uuid,p_version integer,p_listing_version integer,p_fee integer,p_action text)
returns uuid language sql security invoker set search_path = '' as $$ select private.save_offer(p_operation_id,p_offer_id,p_listing_id,p_version,p_listing_version,p_fee,p_action); $$;
revoke all on function public.save_offer(uuid,uuid,uuid,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.save_offer(uuid,uuid,uuid,integer,integer,integer,text) to authenticated;

create function private.offer_listing(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_listing public.listings%rowtype;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  select * into v_listing from public.listings l where l.id=p_id and (
    l.owner_id=auth.uid() or exists(select 1 from public.offers o where o.listing_id=l.id and o.author_id=auth.uid())
    or (l.status='active' and l.cutoff_at>now() and exists(select 1 from public.members m where m.id=l.owner_id and m.status<>'suspended')));
  if not found then raise exception 'PERMISSION: Listing unavailable'; end if;
  return jsonb_build_object('id',v_listing.id,'title',v_listing.title,'type',v_listing.type,'version',v_listing.version,
    'fee',v_listing.fee,'bound',v_listing.bound,'negotiable',v_listing.negotiable,'start',v_listing.start_at,'end',v_listing.end_at,
    'cutoff',v_listing.cutoff_at,'status',v_listing.status,'isOwner',v_listing.owner_id=auth.uid());
end;
$$;
revoke all on function private.offer_listing(uuid) from public,anon,authenticated;
grant execute on function private.offer_listing(uuid) to authenticated;
create function public.offer_listing(p_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.offer_listing(p_id); $$;
revoke all on function public.offer_listing(uuid) from public,anon,authenticated;
grant execute on function public.offer_listing(uuid) to authenticated;
