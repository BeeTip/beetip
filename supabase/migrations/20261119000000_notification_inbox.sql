create table private.notification_rules (
  event_type text primary key,
  recipient_rule text not null,
  target_kind text not null,
  template text not null unique,
  title text not null,
  email_mode text not null check (email_mode in ('summary','unread_window')),
  implemented boolean not null
);
-- registry:start
insert into private.notification_rules(event_type,recipient_rule,target_kind,template,title,email_mode,implemented) values
  ('affiliation_decided','applicant','affiliation','affiliation_decided.v1','Hasil pemeriksaan afiliasi tersedia','summary',true),
  ('offer_received','listing_owner','offer','offer_received.v1','Penawaran baru diterima','summary',true),
  ('offer_changed','listing_owner','offer','offer_changed.v1','Penawaran diperbarui','summary',true),
  ('offer_withdrawn','listing_owner','offer','offer_withdrawn.v1','Penawaran ditarik','summary',true),
  ('listing_changed','offer_authors','listing','listing_changed.v1','Rincian titipan berubah','summary',true),
  ('support_opened','support_queue','support_queue','support_opened.v1','Permintaan bantuan baru','summary',true),
  ('support_assigned','support_members','conversation','support_assigned.v1','Penugasan bantuan diperbarui','summary',true),
  ('support_message','support_members','conversation','support_message.v1','Pesan bantuan baru','unread_window',false),
  ('staff_role_changed','member','account','staff_role_changed.v1','Peran akun diperbarui','summary',true),
  ('order_accepted','order_parties','order','order_accepted.v1','Penawaran disepakati','summary',true),
  ('order_expired','order_parties','order','order_expired.v1','Pesanan kedaluwarsa','summary',false),
  ('order_cancelled','order_parties','order','order_cancelled.v1','Pembatalan pesanan diperbarui','summary',false),
  ('funding_review','parties_and_assignees','order','funding_review.v1','Pemeriksaan dana diperbarui','summary',false),
  ('amendment_action','parties_and_assignees','order','amendment_action.v1','Perubahan pesanan perlu diperiksa','summary',false),
  ('delivery_confirmed','parties_and_assignees','order','delivery_confirmed.v1','Serah terima dikonfirmasi','summary',false),
  ('order_message','other_participant','order','order_message.v1','Pesan pesanan baru','unread_window',false),
  ('dispute_opened','parties_and_assignees','order','dispute_opened.v1','Sengketa dibuka','summary',false),
  ('dispute_resolved','parties_and_assignees','order','dispute_resolved.v1','Sengketa diselesaikan','summary',false),
  ('transfer_review','parties_and_assignees','order','transfer_review.v1','Transfer perlu diperiksa','summary',false),
  ('transfer_outcome','parties_and_assignees','order','transfer_outcome.v1','Status transfer diperbarui','summary',false);
-- registry:end

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  recipient_id uuid not null references public.members(id) on delete cascade,
  actor_id uuid,
  event_type text not null references private.notification_rules(event_type),
  target_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(event_id,recipient_id),
  check (actor_id is null or actor_id <> recipient_id)
);
create index notifications_inbox on public.notifications(recipient_id,created_at desc,id desc);
create index notifications_unread on public.notifications(recipient_id) where read_at is null;
create table public.notification_preferences (
  recipient_id uuid not null references public.members(id) on delete cascade,
  event_type text not null references private.notification_rules(event_type),
  email_enabled boolean not null,
  primary key(recipient_id,event_type)
);
create table private.notification_delivery_intents (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  event_id uuid not null,
  recipient_id uuid not null references public.members(id) on delete cascade,
  channel text not null check (channel in ('in_app','email')),
  template text not null,
  status text not null default 'pending' check (status in ('pending','suppressed','delivered')),
  created_at timestamptz not null default clock_timestamp(),
  unique(event_id,recipient_id,channel),
  unique(notification_id,channel)
);
create index notification_delivery_pending on private.notification_delivery_intents(created_at,id) where status='pending';
create index notification_delivery_recipient on private.notification_delivery_intents(recipient_id);
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table private.notification_rules enable row level security;
alter table private.notification_delivery_intents enable row level security;
revoke all on public.notifications,public.notification_preferences,private.notification_rules,private.notification_delivery_intents from public,anon,authenticated;

create function private.notification_recipient_active(p_member uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.members m join auth.users u on u.id=m.id
    where m.id=p_member and m.status<>'suspended' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false));
$$;
create function private.notification_support_operator(p_member uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.notification_recipient_active(p_member)
    and exists(select 1 from public.staff_roles r where r.member_id=p_member and r.role='support' and r.revoked_at is null)
    and exists(select 1 from auth.mfa_factors f where f.user_id=p_member and f.status='verified');
$$;
create function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_kind text; v_allowed boolean;
begin
  if not private.notification_recipient_active(p_member) then return false; end if;
  select target_kind into v_kind from private.notification_rules where event_type=p_type;
  case v_kind
    when 'affiliation' then return exists(select 1 from public.affiliation_requests where id=p_target and member_id=p_member);
    when 'offer' then return exists(select 1 from public.offers where id=p_target and p_member in (author_id,owner_id));
    when 'listing' then return exists(select 1 from public.listings l where l.id=p_target and
      (l.owner_id=p_member or exists(select 1 from public.offers o where o.listing_id=l.id and o.author_id=p_member)));
    when 'account' then return p_target=p_member;
    when 'support_queue' then return private.notification_support_operator(p_member)
      and exists(select 1 from public.conversations c where c.id=p_target and c.kind='support' and c.status='open'
        and not exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.role='support' and cm.revoked_at is null));
    when 'conversation' then return exists(select 1 from public.conversation_members cm
      where cm.conversation_id=p_target and cm.member_id=p_member and cm.revoked_at is null
        and (cm.role='requester' or (cm.role='support' and private.notification_support_operator(p_member))));
    when 'order' then
      if to_regclass('public.orders') is null then return false; end if;
      execute 'select exists(select 1 from public.orders where id=$1 and $2 in (customer_id,provider_id))'
        into v_allowed using p_target,p_member;
      return v_allowed;
    else return false;
  end case;
end;
$$;

create function private.enqueue_notification(p_event uuid,p_type text,p_target uuid,p_actor uuid,p_recipients uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_recipient uuid; v_id uuid; v_rule private.notification_rules%rowtype;
begin
  select * into strict v_rule from private.notification_rules where event_type=p_type;
  if not v_rule.implemented then raise exception 'VALIDATION: Event slice is not integrated'; end if;
  if p_event is null or p_target is null then raise exception 'VALIDATION: Missing event identity'; end if;
  foreach v_recipient in array p_recipients loop
    if v_recipient is null or v_recipient=p_actor or not private.notification_target_allowed(v_recipient,p_type,p_target) then continue; end if;
    insert into public.notifications(event_id,recipient_id,actor_id,event_type,target_id)
      values(p_event,v_recipient,p_actor,p_type,p_target) on conflict(event_id,recipient_id) do nothing;
    select id into strict v_id from public.notifications where event_id=p_event and recipient_id=v_recipient
      and event_type=p_type and target_id=p_target and actor_id is not distinct from p_actor;
    insert into private.notification_delivery_intents(notification_id,event_id,recipient_id,channel,template,status)
      values(v_id,p_event,v_recipient,'in_app',v_rule.template,'delivered'),
        (v_id,p_event,v_recipient,'email',v_rule.template,'pending') on conflict do nothing;
  end loop;
end;
$$;

create function private.notification_from_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_type text; v_recipients uuid[];
begin
  case new.event_type
    when 'affiliation_approve','affiliation_reject' then
      v_type:='affiliation_decided';
      select array[member_id] into v_recipients from public.affiliation_requests where id=new.target_id;
    when 'offer_saved','offer_withdrawn' then
      v_type:=case when new.event_type='offer_withdrawn' then 'offer_withdrawn'
        when (new.detail->>'version')::integer=1 then 'offer_received' else 'offer_changed' end;
      select array[owner_id] into v_recipients from public.offers where id=new.target_id;
    when 'listing_updated' then
      v_type:='listing_changed';
      select array_agg(distinct author_id) into v_recipients from public.offers where listing_id=new.target_id and status='active';
    when 'support_opened' then
      v_type:='support_opened';
      select array_agg(member_id) into v_recipients from public.staff_roles where role='support' and revoked_at is null;
    when 'staff_granted','staff_revoked' then
      v_type:='staff_role_changed'; v_recipients:=array[new.target_id];
    else return new;
  end case;
  perform private.enqueue_notification(new.id,v_type,new.target_id,new.actor_id,coalesce(v_recipients,'{}'::uuid[]));
  return new;
end;
$$;
create trigger notification_audit after insert on private.audit_events for each row execute function private.notification_from_audit();

create function private.notification_from_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_requester uuid;
begin
  if new.role<>'support' or new.revoked_at is not null then return new; end if;
  if tg_op='UPDATE' then
    if old.revoked_at is null then return new; end if;
  end if;
  select requester_id into v_requester from public.conversations where id=new.conversation_id;
  perform private.enqueue_notification(gen_random_uuid(),'support_assigned',new.conversation_id,auth.uid(),array[new.member_id,v_requester]);
  return new;
end;
$$;
create trigger notification_assignment after insert or update on public.conversation_members for each row execute function private.notification_from_assignment();

create function private.notification_visible(p_recipient uuid,p_type text,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_recipient=auth.uid() and private.is_active_member()
    and private.notification_target_allowed(p_recipient,p_type,p_target)
    and (p_type not in ('support_opened','support_assigned','support_message')
      or not exists(select 1 from public.conversation_members cm where cm.conversation_id=p_target and cm.member_id=p_recipient and cm.role='support')
        and p_type<>'support_opened'
      or private.has_staff_role('support'));
$$;
grant select on public.notifications,public.notification_preferences to authenticated;
create policy notifications_private_read on public.notifications for select to authenticated
  using(private.notification_visible(recipient_id,event_type,target_id));
create policy notification_preferences_private_read on public.notification_preferences for select to authenticated
  using(recipient_id=(select auth.uid()) and (select private.is_active_member()));

create function private.notification_inbox(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Active account required'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION: Incomplete cursor'; end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(row_to_json(page) order by page.created_at desc,page.id desc),'[]'::jsonb)) into v_result
    from (select id,event_type,created_at,read_at from public.notifications
      where private.notification_visible(recipient_id,event_type,target_id)
        and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 21) page;
  return v_result || jsonb_build_object('unread',(select count(*) from public.notifications
    where read_at is null and private.notification_visible(recipient_id,event_type,target_id)),
    'preferences',(select coalesce(jsonb_agg(jsonb_build_object('event_type',r.event_type,'email_enabled',coalesce(p.email_enabled,true)) order by r.event_type),'[]'::jsonb)
      from private.notification_rules r left join public.notification_preferences p on p.event_type=r.event_type and p.recipient_id=auth.uid()));
end;
$$;
create function private.read_notification(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.notifications set read_at=coalesce(read_at,clock_timestamp())
    where id=p_id and private.notification_visible(recipient_id,event_type,target_id);
  if not found then raise exception 'PERMISSION: Notification unavailable'; end if;
end;
$$;
create function private.set_notification_preference(p_type text,p_email boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Active account required'; end if;
  if p_email is null or not exists(select 1 from private.notification_rules where event_type=p_type) then raise exception 'VALIDATION: Invalid preference'; end if;
  insert into public.notification_preferences(recipient_id,event_type,email_enabled) values(auth.uid(),p_type,p_email)
    on conflict(recipient_id,event_type) do update set email_enabled=excluded.email_enabled;
end;
$$;
create function private.notification_target(p_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_row public.notifications%rowtype; v_kind text; v_listing uuid;
begin
  select * into v_row from public.notifications where id=p_id and private.notification_visible(recipient_id,event_type,target_id);
  if not found then raise exception 'PERMISSION: Notification unavailable'; end if;
  select target_kind into v_kind from private.notification_rules where event_type=v_row.event_type;
  case v_kind
    when 'affiliation' then return '/account/affiliation';
    when 'offer' then
      select listing_id into strict v_listing from public.offers where id=v_row.target_id;
      return '/account/offers?listing='||v_listing::text;
    when 'listing' then return '/account/offers?listing='||v_row.target_id::text;
    when 'account' then return '/account';
    when 'support_queue' then return '/support';
    when 'conversation' then return '/support';
    when 'order' then return '/orders/'||v_row.target_id::text;
    else raise exception 'PERMISSION: Target unavailable';
  end case;
end;
$$;

create function private.notification_email_allowed(p_notification uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.notifications n join private.notification_rules r on r.event_type=n.event_type
    where n.id=p_notification and n.read_at is null and r.email_mode='summary'
      and private.notification_target_allowed(n.recipient_id,n.event_type,n.target_id)
      and coalesce((select email_enabled from public.notification_preferences p where p.recipient_id=n.recipient_id and p.event_type=n.event_type),true));
$$;

create function public.notification_inbox(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.notification_inbox(p_before,p_before_id); $$;
create function public.read_notification(p_id uuid) returns void language sql security invoker set search_path='' as $$ select private.read_notification(p_id); $$;
create function public.set_notification_preference(p_type text,p_email boolean) returns void language sql security invoker set search_path='' as $$ select private.set_notification_preference(p_type,p_email); $$;
create function public.notification_target(p_id uuid) returns text language sql stable security invoker set search_path='' as $$ select private.notification_target(p_id); $$;

revoke all on function private.notification_recipient_active(uuid),private.notification_support_operator(uuid),private.notification_target_allowed(uuid,text,uuid),
  private.enqueue_notification(uuid,text,uuid,uuid,uuid[]),private.notification_from_audit(),private.notification_from_assignment(),
  private.notification_visible(uuid,text,uuid),private.notification_inbox(timestamptz,uuid),private.read_notification(uuid),
  private.set_notification_preference(text,boolean),private.notification_target(uuid),private.notification_email_allowed(uuid),
  public.notification_inbox(timestamptz,uuid),public.read_notification(uuid),public.set_notification_preference(text,boolean),public.notification_target(uuid)
  from public,anon,authenticated;
grant execute on function private.notification_visible(uuid,text,uuid),private.notification_inbox(timestamptz,uuid),private.read_notification(uuid),
  private.set_notification_preference(text,boolean),private.notification_target(uuid),public.notification_inbox(timestamptz,uuid),
  public.read_notification(uuid),public.set_notification_preference(text,boolean),public.notification_target(uuid) to authenticated;

create function private.notification_from_acceptance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.enqueue_notification(new.order_id,'order_accepted',new.order_id,null,array[new.recipient_id]);
  return new;
end;
$$;
revoke all on function private.notification_from_acceptance() from public,anon,authenticated;
do $$
begin
  if to_regclass('private.acceptance_notification_intents') is not null then
    execute 'create trigger notification_acceptance after insert on private.acceptance_notification_intents for each row execute function private.notification_from_acceptance()';
    execute 'select private.enqueue_notification(order_id,''order_accepted'',order_id,null,array[recipient_id]) from private.acceptance_notification_intents where event_type=''order_accepted''';
  end if;
end;
$$;
