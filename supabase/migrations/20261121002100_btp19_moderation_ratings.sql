alter table public.listings drop constraint listings_status_check;
alter table public.listings add column moderation_hold uuid;
alter table public.listings add constraint listings_status_check
  check (status in ('active','paused','closed') or (status='removed' and moderation_hold is not null));
alter table public.listings add constraint listings_moderation_hold_check
  check (moderation_hold is null or status<>'active');

create function private.guard_listing_moderation() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.moderation_hold is not null and new.moderation_hold=old.moderation_hold
    and (old.status='removed' or new.status is distinct from old.status) then
    raise exception 'CONFLICT: Only an operator can change a moderated listing status';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_listing_moderation() from public,anon,authenticated;
create trigger listing_moderation_guard before update on public.listings
  for each row execute function private.guard_listing_moderation();

insert into private.notification_rules(event_type,recipient_rule,target_kind,template,title,email_mode,implemented) values
  ('listing_moderated','listing_owner_and_offer_authors','listing','listing_moderated.v1','Status moderasi listing berubah','in_app_only',true);

create function private.moderate_listing(p_operation_id uuid,p_listing_id uuid,p_version integer,p_status text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_reason text := btrim(p_reason, E' \t\n\r');
  v_hash text;
  v_now timestamptz;
  v_count integer;
  v_spending bigint;
  v_event uuid := gen_random_uuid();
  v_recipients uuid[];
begin
  if private.has_staff_role('platform_admin') is not true then
    raise exception 'PERMISSION: Platform administrator MFA required';
  end if;
  if p_operation_id is null or p_listing_id is null or p_version is null or p_version<1
    or p_status is null or p_status not in ('active','paused','closed','removed')
    or v_reason is null or char_length(v_reason) not between 3 and 500 or octet_length(p_reason)>2000 then
    raise exception 'VALIDATION: Invalid moderation decision';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_listing_id,p_version,p_status,v_reason)::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation_id,'moderate_listing',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation_id for update;
  if v_receipt.command<>'moderate_listing' or v_receipt.payload_hash<>v_hash then
    raise exception 'CONFLICT: Changed operation payload';
  end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;

  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'PERMISSION: Listing unavailable'; end if;
  if private.has_staff_role('platform_admin') is not true then
    raise exception 'PERMISSION: Platform administrator MFA required';
  end if;
  if v_listing.version<>p_version then raise exception 'CONFLICT: Stale listing version'; end if;
  if v_listing.status=p_status and (v_listing.moderation_hold is not null or p_status='active') then
    raise exception 'CONFLICT: Listing already has this moderation status';
  end if;
  v_now := clock_timestamp();
  if p_status='active' then
    if v_listing.cutoff_at<=v_now or v_listing.end_at>v_now+interval '90 days' then
      raise exception 'CONFLICT: Use a future schedule within 90 days';
    end if;
    if not private.notification_recipient_active(v_listing.owner_id) then
      raise exception 'CONFLICT: Listing owner unavailable';
    end if;
    select count(*),coalesce(sum(amount),0) into v_count,v_spending from public.reservations
      where listing_id=p_listing_id and released_at is null and (funding_verified_at is not null or expires_at>v_now);
    if v_count>=v_listing.capacity or v_spending+v_listing.budget>v_listing.spending_capacity then
      raise exception 'CONFLICT: Customer or spending capacity full';
    end if;
    if v_listing.type='request' and exists(select 1 from public.orders where request_id=p_listing_id) then
      raise exception 'CONFLICT: Request already accepted';
    end if;
  end if;

  update public.listings set status=p_status,version=version+1,
    moderation_hold=case when p_status<>'active' then v_event end where id=p_listing_id;
  insert into private.audit_events(id,actor_id,operation_id,event_type,target_id,detail)
    values(v_event,v_actor,p_operation_id,'listing_moderated',p_listing_id,
      jsonb_build_object('from',v_listing.status,'to',p_status,'reason',v_reason,'version',p_version+1));
  select array[v_listing.owner_id] || array(select distinct author_id from public.offers
    where listing_id=p_listing_id and status='active') into v_recipients;
  perform private.enqueue_notification(v_event,'listing_moderated',p_listing_id,v_actor,v_recipients);
  update private.operation_receipts set result_id=p_listing_id where actor_id=v_actor and operation_id=p_operation_id;
  return p_listing_id;
end;
$$;

create function public.moderate_listing(p_operation_id uuid,p_listing_id uuid,p_version integer,p_status text,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
  select private.moderate_listing(p_operation_id,p_listing_id,p_version,p_status,p_reason);
$$;
revoke all on function private.moderate_listing(uuid,uuid,integer,text,text),
  public.moderate_listing(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function private.moderate_listing(uuid,uuid,integer,text,text),
  public.moderate_listing(uuid,uuid,integer,text,text) to authenticated;

create function private.listing_moderation_queue(p_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if private.has_staff_role('platform_admin') is not true then
    raise exception 'PERMISSION: Platform administrator MFA required';
  end if;
  if p_search is null or char_length(p_search)>100 then raise exception 'VALIDATION: Invalid search'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'status',l.status,
    'version',l.version,'cutoff',l.cutoff_at,'moderated',l.moderation_hold is not null) order by l.created_at desc,l.id desc)
    from (select * from public.listings
      where p_search='' or id::text=lower(p_search) or position(lower(p_search) in lower(title))>0
      order by created_at desc,id desc limit 20) l),'[]'::jsonb);
end;
$$;
create function public.listing_moderation_queue(p_search text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.listing_moderation_queue(p_search);
$$;
revoke all on function private.listing_moderation_queue(text),public.listing_moderation_queue(text) from public,anon,authenticated;
grant execute on function private.listing_moderation_queue(text),public.listing_moderation_queue(text) to authenticated;

create table private.order_ratings (
  order_id uuid not null references public.orders(id),
  author_id uuid not null references public.members(id),
  score integer not null check (score between 1 and 5),
  feedback text not null check (char_length(feedback)<=500),
  created_at timestamptz not null default clock_timestamp(),
  primary key(order_id,author_id)
);
create index order_ratings_author on private.order_ratings(author_id);
alter table private.order_ratings enable row level security;
revoke all on private.order_ratings from public,anon,authenticated;

create function private.read_order_rating(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if private.is_active_member() is not true or not exists(
    select 1 from public.orders where id=p_order_id and auth.uid() in (customer_id,provider_id)
  ) then raise exception 'PERMISSION: Order unavailable'; end if;
  return (select jsonb_build_object('score',score,'feedback',feedback) from private.order_ratings
    where order_id=p_order_id and author_id=auth.uid());
end;
$$;

create function private.submit_order_rating(p_operation_id uuid,p_order_id uuid,p_score integer,p_feedback text)
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
  if v_order.state<>'delivery_confirmed' or v_order.booth_demo then
    raise exception 'CONFLICT: Order is not eligible for rating';
  end if;

  insert into private.order_ratings(order_id,author_id,score,feedback) values(p_order_id,v_actor,p_score,v_feedback)
    on conflict(order_id,author_id) do nothing;
  if not found then raise exception 'CONFLICT: Rating already submitted'; end if;
  update private.operation_receipts set result_id=p_order_id where actor_id=v_actor and operation_id=p_operation_id;
  return jsonb_build_object('score',p_score,'feedback',v_feedback);
end;
$$;

create function public.read_order_rating(p_order_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.read_order_rating(p_order_id); $$;
create function public.submit_order_rating(p_operation_id uuid,p_order_id uuid,p_score integer,p_feedback text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.submit_order_rating(p_operation_id,p_order_id,p_score,p_feedback);
$$;
revoke all on function private.read_order_rating(uuid),public.read_order_rating(uuid),
  private.submit_order_rating(uuid,uuid,integer,text),public.submit_order_rating(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function private.read_order_rating(uuid),public.read_order_rating(uuid),
  private.submit_order_rating(uuid,uuid,integer,text),public.submit_order_rating(uuid,uuid,integer,text) to authenticated;
