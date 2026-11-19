create table private.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.members(id) on delete cascade,
  template text not null,
  conversation_id uuid references public.conversations(id) on delete cascade,
  window_end timestamptz,
  max_sequence bigint,
  open_for_sources boolean not null default false,
  due_at timestamptz not null,
  status text not null default 'queued' check (status in
    ('queued','leased','sending','retry','uncertain','accepted','delivered','dead_letter','suppressed')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  dispatch_id uuid not null default gen_random_uuid(),
  last_error text,
  updated_at timestamptz not null default clock_timestamp(),
  check ((conversation_id is null and window_end is null and max_sequence is null and not open_for_sources)
    or (conversation_id is not null and window_end is not null and max_sequence is not null)),
  check ((status in ('leased','sending')) = (lease_token is not null and lease_until is not null))
);
create unique index email_open_window on private.email_deliveries(recipient_id,conversation_id,window_end)
  where open_for_sources;
create index email_due on private.email_deliveries(due_at,id) where status in ('queued','retry');
create index email_expiring on private.email_deliveries(lease_until,id) where status in ('leased','sending');
create index email_attention on private.email_deliveries(updated_at desc,id) where status in ('dead_letter','uncertain');
create index email_accepted on private.email_deliveries(updated_at,id) where status='accepted';
create index email_recipient on private.email_deliveries(recipient_id);
create index email_conversation on private.email_deliveries(conversation_id);

create table private.email_delivery_sources (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  delivery_id uuid not null references private.email_deliveries(id) on delete cascade
);
create index email_sources_delivery on private.email_delivery_sources(delivery_id);

create table private.email_dispatches (
  id uuid primary key,
  delivery_id uuid not null references private.email_deliveries(id) on delete cascade,
  address_hash text not null,
  provider_id text,
  first_started_at timestamptz not null
);
create index email_dispatch_delivery on private.email_dispatches(delivery_id);
create table private.email_webhook_receipts (
  dispatch_id uuid not null references private.email_dispatches(id) on delete cascade,
  provider_id text not null,
  event_type text not null,
  primary key (dispatch_id,provider_id,event_type)
);
create table private.email_suppressions (
  address_hash text primary key,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.email_budget (
  utc_day date primary key,
  submissions integer not null
);
create table private.email_worker_health (
  singleton boolean primary key check (singleton),
  monitoring_since timestamptz,
  last_success_at timestamptz
);
insert into private.email_worker_health(singleton) values(true);

alter table private.email_deliveries enable row level security;
alter table private.email_delivery_sources enable row level security;
alter table private.email_dispatches enable row level security;
alter table private.email_webhook_receipts enable row level security;
alter table private.email_suppressions enable row level security;
alter table private.email_budget enable row level security;
alter table private.email_worker_health enable row level security;
revoke all on private.email_deliveries,private.email_delivery_sources,private.email_dispatches,
  private.email_webhook_receipts,private.email_suppressions,private.email_budget,private.email_worker_health
  from public,anon,authenticated,service_role;

create function private.btp11_enqueue(p_notification uuid)
returns void language plpgsql set search_path='' as $$
declare
  v_source record;
  v_delivery uuid;
begin
  if exists(select 1 from private.email_delivery_sources where notification_id=p_notification) then return; end if;
  select n.recipient_id,d.template,d.created_at,r.email_mode,s.conversation_id,s.sequence,s.window_end,s.due_at
    into v_source
    from private.notification_delivery_intents d join public.notifications n on n.id=d.notification_id
    join private.notification_rules r on r.event_type=n.event_type
    left join private.btp08_email_sources s on s.notification_id=n.id
    where d.notification_id=p_notification and d.channel='email' and d.status='pending';
  if not found or v_source.email_mode='in_app_only' then return; end if;
  if v_source.email_mode='unread_window' then
    if v_source.conversation_id is null then return; end if;
    insert into private.email_deliveries(recipient_id,template,conversation_id,window_end,max_sequence,open_for_sources,due_at)
      values(v_source.recipient_id,v_source.template,v_source.conversation_id,v_source.window_end,v_source.sequence,true,v_source.due_at)
      on conflict(recipient_id,conversation_id,window_end) where open_for_sources do update
        set max_sequence=greatest(private.email_deliveries.max_sequence,excluded.max_sequence)
      returning id into v_delivery;
  else
    insert into private.email_deliveries(recipient_id,template,due_at)
      values(v_source.recipient_id,v_source.template,v_source.created_at) returning id into v_delivery;
  end if;
  insert into private.email_delivery_sources(notification_id,delivery_id) values(p_notification,v_delivery);
end; $$;

create function private.btp11_on_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.btp11_enqueue(new.notification_id);
  return new;
end; $$;
create trigger btp11_summary_source after insert on private.notification_delivery_intents
  for each row when (new.channel='email' and new.status='pending') execute function private.btp11_on_source();
create trigger btp11_unread_source after insert on private.btp08_email_sources
  for each row execute function private.btp11_on_source();

select private.btp11_enqueue(notification_id)
  from private.notification_delivery_intents where channel='email' and status='pending';

create function private.btp11_email_allowed(p_delivery uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from private.email_delivery_sources source
    join public.notifications n on n.id=source.notification_id
    join private.notification_rules r on r.event_type=n.event_type
    left join private.btp08_email_sources s on s.notification_id=n.id
    where source.delivery_id=p_delivery and (
      (r.email_mode='summary' and private.notification_email_allowed(n.id)
        and (n.event_type<>'support_assigned' or exists (
          select 1 from public.conversation_members cm where cm.conversation_id=n.target_id and cm.member_id=n.recipient_id
            and cm.revoked_at is null and cm.granted_at<=n.created_at)))
      or (r.email_mode='unread_window' and private.notification_target_allowed(n.recipient_id,n.event_type,n.target_id)
        and coalesce((select email_enabled from public.notification_preferences p
          where p.recipient_id=n.recipient_id and p.event_type=n.event_type),true)
        and exists(select 1 from public.conversation_members cm
          where cm.conversation_id=s.conversation_id and cm.member_id=n.recipient_id and cm.revoked_at is null
            and cm.granted_at<=n.created_at
            and ((n.event_type='support_message' and cm.role in ('requester','support'))
              or (n.event_type='order_message' and cm.role in ('customer','provider'))))
        and s.sequence>coalesce((select last_sequence from public.conversation_reads cr
          where cr.conversation_id=s.conversation_id and cr.member_id=n.recipient_id),0))
    )
  );
$$;

create function private.btp11_sync_intents()
returns trigger language plpgsql set search_path='' as $$
begin
  update private.notification_delivery_intents d set status=new.status
    from private.email_delivery_sources s
    where s.delivery_id=new.id and s.notification_id=d.notification_id and d.channel='email';
  return new;
end; $$;
create trigger btp11_sync_intents after update of status on private.email_deliveries
  for each row when (new.status in ('delivered','suppressed') and old.status<>new.status)
  execute function private.btp11_sync_intents();

create function private.btp11_claim()
returns table(id uuid,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  with expired as (
    select d.id from private.email_deliveries d where status='sending' and lease_until<=statement_timestamp()
    order by lease_until,d.id limit 25 for update skip locked
  )
  update private.email_deliveries d set status='uncertain',last_error='submission_lease_expired',
    lease_token=null,lease_until=null,updated_at=clock_timestamp() from expired e where d.id=e.id;

  return query with due as (
    select d.id from private.email_deliveries d
    where (d.status in ('queued','retry') and d.due_at<=statement_timestamp())
      or (d.status='leased' and d.lease_until<=statement_timestamp())
    order by d.due_at,d.id limit 10 for update skip locked
  )
  update private.email_deliveries d set status='leased',open_for_sources=false,lease_token=gen_random_uuid(),
    lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
    from due where d.id=due.id returning d.id,d.lease_token;
end; $$;

create function private.btp11_prepare(p_id uuid,p_lease uuid,p_allowlist text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row private.email_deliveries%rowtype;
  v_address text;
  v_hash text;
  v_reason text;
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_dispatch uuid;
begin
  select * into v_row from private.email_deliveries
    where id=p_id and status='leased' and lease_token=p_lease and lease_until>clock_timestamp() for update;
  if not found then return null; end if;
  select lower(btrim(email)) into v_address from auth.users where id=v_row.recipient_id;
  v_hash:=encode(sha256(convert_to(v_address,'UTF8')),'hex');
  if v_address is null or v_address='' or not private.btp11_email_allowed(p_id) then
    v_reason:='ineligible';
  elsif exists(select 1 from private.email_suppressions where address_hash=v_hash) then
    v_reason:='address_suppressed';
  elsif p_allowlist is not null and not coalesce(v_hash=any(p_allowlist),false) then
    v_reason:='recipient_allowlist';
  end if;
  if v_reason is not null then
    update private.email_deliveries set status='suppressed',last_error=v_reason,
      lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;

  insert into private.email_budget as b(utc_day,submissions) values(v_day,1)
    on conflict(utc_day) do update set submissions=b.submissions+1 where b.submissions<100;
  if not found then
    update private.email_deliveries set status='retry',due_at=(v_day+1)::timestamp at time zone 'UTC',
      last_error='daily_budget',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;

  v_dispatch:=v_row.dispatch_id;
  if exists(select 1 from private.email_dispatches where id=v_dispatch and address_hash<>v_hash) then
    v_dispatch:=gen_random_uuid();
  end if;
  insert into private.email_dispatches(id,delivery_id,address_hash,first_started_at)
    values(v_dispatch,p_id,v_hash,clock_timestamp()) on conflict(id) do nothing;
  update private.email_deliveries set status='sending',attempts=attempts+1,dispatch_id=v_dispatch,updated_at=clock_timestamp() where id=p_id;
  return jsonb_build_object('address',v_address,'dispatchId',v_dispatch);
end; $$;

create function private.btp11_finish(p_id uuid,p_lease uuid,p_outcome text,p_provider_id text,p_retry_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_row private.email_deliveries%rowtype;
  v_status text;
  v_error text;
  v_delay integer;
begin
  select * into v_row from private.email_deliveries
    where id=p_id and status='sending' and lease_token=p_lease and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  case p_outcome
    when 'accepted' then
      if p_provider_id is null or p_provider_id !~ '^[!-~]{1,240}$' then raise exception 'Invalid provider ID'; end if;
      update private.email_dispatches set provider_id=p_provider_id where id=v_row.dispatch_id;
      v_status:='accepted';
    when 'rate_limited' then
      v_status:=case when v_row.attempts>=5 then 'dead_letter' else 'retry' end;
      v_error:=p_outcome;
      v_delay:=greatest((array[60,300,900,3600])[least(v_row.attempts,4)] + floor(random()*16)::integer,
        least(greatest(p_retry_seconds,0),86400));
    when 'rejected' then v_status:='dead_letter'; v_error:=p_outcome;
    when 'transport_uncertain','duplicate_key' then v_status:='uncertain'; v_error:=p_outcome;
    else raise exception 'Invalid send outcome';
  end case;
  update private.email_deliveries set status=v_status,last_error=v_error,
    due_at=coalesce(clock_timestamp()+make_interval(secs=>v_delay),due_at),
    lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
  return true;
end; $$;

create function private.btp11_webhook(p_dispatch uuid,p_address_hash text,p_provider_id text,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_dispatch private.email_dispatches%rowtype;
  v_delivery private.email_deliveries%rowtype;
begin
  if p_event is null or p_event not in ('accepted','delivered','hard_bounce','soft_bounce','blocked','invalid','spam','unsubscribed')
    or p_provider_id is null or p_provider_id !~ '^[!-~]{1,240}$' then raise exception 'Invalid webhook'; end if;
  select d.* into v_delivery from private.email_deliveries d
    join private.email_dispatches s on s.delivery_id=d.id
    where s.id=p_dispatch and s.address_hash=p_address_hash for update of d;
  if not found then return; end if;
  select * into v_dispatch from private.email_dispatches where id=p_dispatch;
  if v_dispatch.provider_id is not null and v_dispatch.provider_id<>p_provider_id then return; end if;
  insert into private.email_webhook_receipts values(p_dispatch,p_provider_id,p_event) on conflict do nothing;
  if not found then return; end if;
  update private.email_dispatches set provider_id=p_provider_id where id=p_dispatch;
  if p_event in ('hard_bounce','blocked','invalid','spam','unsubscribed') then
    insert into private.email_suppressions(address_hash,reason) values(p_address_hash,p_event) on conflict do nothing;
  end if;
  if v_delivery.dispatch_id<>p_dispatch and exists(
    select 1 from private.email_dispatches where id=v_delivery.dispatch_id
  ) then return; end if;
  if p_event='accepted' then
    if v_delivery.status in ('queued','leased','sending','retry','uncertain')
      or (v_delivery.status='suppressed' and v_delivery.last_error is distinct from 'operator_closed')
      or (v_delivery.status='dead_letter' and v_delivery.last_error in ('rejected','rate_limited')) then
      update private.email_deliveries set status='accepted',last_error=null,dispatch_id=p_dispatch,
        lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
    end if;
  elsif p_event='delivered' and not exists(select 1 from private.email_webhook_receipts
      where dispatch_id=p_dispatch and event_type in ('hard_bounce','blocked','invalid','spam','unsubscribed')) then
    update private.email_deliveries set status='delivered',last_error=null,dispatch_id=p_dispatch,
      lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
  elsif p_event<>'delivered' and (p_event<>'soft_bounce' or (v_delivery.status<>'delivered' and not exists(
    select 1 from private.email_webhook_receipts where dispatch_id=p_dispatch
      and event_type in ('hard_bounce','blocked','invalid','spam','unsubscribed')
  ))) then
    update private.email_deliveries set status='dead_letter',last_error=p_event,dispatch_id=p_dispatch,
      lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
  end if;
end; $$;

create function private.btp11_heartbeat()
returns void language sql security definer set search_path='' as $$
  update private.email_worker_health set last_success_at=clock_timestamp() where singleton;
$$;

create function private.btp11_alerts()
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('missedScheduler',h.monitoring_since is not null
      and coalesce(h.last_success_at,h.monitoring_since)<now()-interval '5 minutes',
    'lastSuccessAt',h.last_success_at,
    'overdue',exists(select 1 from private.email_deliveries where status in ('queued','retry') and due_at<now()-interval '5 minutes'),
    'needsAttention',exists(select 1 from private.email_deliveries where status in ('uncertain','dead_letter')
      or (status='accepted' and updated_at<=now()-interval '48 hours')))
  from private.email_worker_health h where singleton;
$$;

create function private.btp11_operator_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_staff_role('platform_admin') then raise exception 'PERMISSION: Platform admin and MFA required'; end if;
  return private.btp11_alerts() || jsonb_build_object('items',(
    select coalesce(jsonb_agg(to_jsonb(page) order by updated_at desc,id),'[]'::jsonb) from (
      select id,dispatch_id,status,last_error,attempts,updated_at,
        status='dead_letter' or (status='uncertain' and updated_at<=now()-interval '30 minutes') as replay_ready
      from private.email_deliveries where status in ('uncertain','dead_letter')
        or (status='accepted' and updated_at<=now()-interval '48 hours')
      order by updated_at desc,id limit 50
    ) page
  ));
end; $$;

create function private.btp11_operator_action(p_id uuid,p_dispatch uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_row private.email_deliveries%rowtype;
begin
  if not private.has_staff_role('platform_admin') then raise exception 'PERMISSION: Platform admin and MFA required'; end if;
  if p_action is null or p_action not in ('replay','reconciled_replay','close') then raise exception 'VALIDATION: Invalid email action'; end if;
  select * into v_row from private.email_deliveries where id=p_id and dispatch_id=p_dispatch for update;
  if not found or (v_row.status not in ('dead_letter','uncertain') and not
    (v_row.status='accepted' and p_action='close' and v_row.updated_at<=clock_timestamp()-interval '48 hours')) then
    raise exception 'CONFLICT: Email status changed';
  end if;
  if p_action<>'close' then
    if (v_row.status='uncertain' and (p_action<>'reconciled_replay' or v_row.updated_at>clock_timestamp()-interval '30 minutes'))
      or (v_row.status='dead_letter' and p_action<>'replay') then
      raise exception 'CONFLICT: Provider reconciliation required';
    end if;
    if not private.btp11_email_allowed(p_id) or exists (
      select 1 from auth.users u join private.email_suppressions s on s.address_hash=encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex')
      where u.id=v_row.recipient_id
    ) then raise exception 'CONFLICT: Recipient cannot receive this email'; end if;
    update private.email_deliveries set status='queued',attempts=0,dispatch_id=gen_random_uuid(),last_error=null,
      due_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
  else
    update private.email_deliveries set status='suppressed',last_error='operator_closed',updated_at=clock_timestamp() where id=p_id;
  end if;
  insert into private.audit_events(actor_id,event_type,target_id,detail)
    values(auth.uid(),'email_'||p_action,p_id,jsonb_build_object('dispatch_id',p_dispatch,'previous_status',v_row.status));
end; $$;

create function public.btp11_claim() returns table(id uuid,lease_token uuid)
  language sql security invoker set search_path='' as $$ select * from private.btp11_claim(); $$;
create function public.btp11_prepare(p_id uuid,p_lease uuid,p_allowlist text[]) returns jsonb
  language sql security invoker set search_path='' as $$ select private.btp11_prepare(p_id,p_lease,p_allowlist); $$;
create function public.btp11_finish(p_id uuid,p_lease uuid,p_outcome text,p_provider_id text,p_retry_seconds integer) returns boolean
  language sql security invoker set search_path='' as $$ select private.btp11_finish(p_id,p_lease,p_outcome,p_provider_id,p_retry_seconds); $$;
create function public.btp11_webhook(p_dispatch uuid,p_address_hash text,p_provider_id text,p_event text) returns void
  language sql security invoker set search_path='' as $$ select private.btp11_webhook(p_dispatch,p_address_hash,p_provider_id,p_event); $$;
create function public.btp11_heartbeat() returns void
  language sql security invoker set search_path='' as $$ select private.btp11_heartbeat(); $$;
create function public.btp11_operator_queue() returns jsonb
  language sql stable security invoker set search_path='' as $$ select private.btp11_operator_queue(); $$;
create function public.btp11_operator_action(p_id uuid,p_dispatch uuid,p_action text) returns void
  language sql security invoker set search_path='' as $$ select private.btp11_operator_action(p_id,p_dispatch,p_action); $$;

revoke all on function private.btp11_enqueue(uuid),private.btp11_on_source(),private.btp11_email_allowed(uuid),
  private.btp11_sync_intents(),private.btp11_alerts(),
  private.btp11_claim(),private.btp11_prepare(uuid,uuid,text[]),private.btp11_finish(uuid,uuid,text,text,integer),
  private.btp11_webhook(uuid,text,text,text),private.btp11_heartbeat(),
  public.btp11_claim(),public.btp11_prepare(uuid,uuid,text[]),public.btp11_finish(uuid,uuid,text,text,integer),
  public.btp11_webhook(uuid,text,text,text),public.btp11_heartbeat(),
  private.btp11_operator_queue(),private.btp11_operator_action(uuid,uuid,text),
  public.btp11_operator_queue(),public.btp11_operator_action(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.btp11_claim(),private.btp11_prepare(uuid,uuid,text[]),
  private.btp11_finish(uuid,uuid,text,text,integer),private.btp11_webhook(uuid,text,text,text),private.btp11_heartbeat(),
  public.btp11_claim(),public.btp11_prepare(uuid,uuid,text[]),public.btp11_finish(uuid,uuid,text,text,integer),
  public.btp11_webhook(uuid,text,text,text),public.btp11_heartbeat() to service_role;
grant execute on function private.btp11_operator_queue(),private.btp11_operator_action(uuid,uuid,text),
  public.btp11_operator_queue(),public.btp11_operator_action(uuid,uuid,text) to authenticated;
