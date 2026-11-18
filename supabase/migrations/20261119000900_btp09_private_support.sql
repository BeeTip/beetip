alter table public.conversations
  add column support_category text,
  add column support_order_id uuid references public.orders(id),
  add column support_escalated boolean not null default false,
  add column support_version integer not null default 0,
  add column support_updated_at timestamptz;

update public.conversations c set support_category='general',
  support_updated_at=greatest(c.created_at,(select max(m.created_at) from public.messages m where m.conversation_id=c.id)),
  next_sequence=greatest(c.next_sequence,(select max(m.sequence)+1 from public.messages m where m.conversation_id=c.id))
where c.kind='support';
alter table public.conversations add constraint btp09_conversation_metadata check (
  (kind='support' and support_category is not null and support_category in ('general','account','order')
    and support_updated_at is not null and support_version>=0 and (support_order_id is null or support_category='order'))
  or (kind='order' and support_category is null and support_order_id is null and support_updated_at is null
    and not support_escalated and support_version=0)
);
create index btp09_support_queue on public.conversations(status,support_updated_at desc,id) where kind='support';
create index btp09_support_order on public.conversations(support_order_id) where support_order_id is not null;

create function private.btp09_support_defaults() returns trigger
language plpgsql set search_path='' as $$
begin
  new.support_category:=coalesce(new.support_category,case when new.support_order_id is null then 'general' else 'order' end);
  new.support_updated_at:=coalesce(new.support_updated_at,new.created_at);
  return new;
end; $$;
revoke all on function private.btp09_support_defaults() from public,anon,authenticated;
create trigger btp09_support_defaults before insert on public.conversations
  for each row when (new.kind='support') execute function private.btp09_support_defaults();

-- Preserve the newest historical assignment if more than one is still active.
with ranked as (
  select conversation_id,member_id,row_number() over(partition by conversation_id order by granted_at desc,member_id) as rank
  from public.conversation_members where role='support' and revoked_at is null
), revoked as (
  update public.conversation_members cm set revoked_at=clock_timestamp()
  from ranked r where r.rank>1 and cm.conversation_id=r.conversation_id and cm.member_id=r.member_id
  returning cm.conversation_id,cm.member_id
)
insert into private.audit_events(event_type,target_id,detail)
select 'support_migration_revoked',conversation_id,jsonb_build_object('member_id',member_id) from revoked;

create unique index btp09_one_assignee on public.conversation_members(conversation_id) where role='support' and revoked_at is null;

create table private.btp09_order_grants (
  case_id uuid primary key references public.conversations(id) on delete cascade,
  member_id uuid not null references public.members(id),
  granted_at timestamptz not null default clock_timestamp()
);
create index btp09_order_grants_member on private.btp09_order_grants(member_id);
alter table private.btp09_order_grants enable row level security;
revoke all on private.btp09_order_grants from public,anon,authenticated;

alter table private.notification_rules drop constraint notification_rules_email_mode_check;
alter table private.notification_rules add constraint notification_rules_email_mode_check
  check(email_mode in ('summary','unread_window','in_app_only'));
update private.notification_rules set implemented=true where event_type='support_message';
update private.notification_rules set email_mode='in_app_only' where event_type='support_opened';
update private.notification_delivery_intents d set status='suppressed'
from public.notifications n where n.id=d.notification_id and n.event_type='support_opened'
  and d.channel='email' and d.status='pending';

create or replace function private.enqueue_notification(p_event uuid,p_type text,p_target uuid,p_actor uuid,p_recipients uuid[])
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
      values(v_id,p_event,v_recipient,'in_app',v_rule.template,'delivered') on conflict do nothing;
    if v_rule.email_mode<>'in_app_only' then
      insert into private.notification_delivery_intents(notification_id,event_id,recipient_id,channel,template,status)
        values(v_id,p_event,v_recipient,'email',v_rule.template,'pending') on conflict do nothing;
    end if;
  end loop;
end; $$;

create or replace function private.notification_target(p_id uuid)
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
    when 'conversation' then return '/support?case='||v_row.target_id::text;
    when 'order' then return '/orders/'||v_row.target_id::text;
    else raise exception 'PERMISSION: Target unavailable';
  end case;
end; $$;

create function private.btp09_lock_sender() returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into private.btp08_send_locks values(auth.uid()) on conflict do nothing;
  perform 1 from private.btp08_send_locks where member_id=auth.uid() for update;
end; $$;

create function private.btp09_check_quota(p_now timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if (select count(*) from public.messages where sender_id=auth.uid() and client_message_id is not null
        and created_at>p_now-interval '1 minute')>=10
    or (select count(*) from public.messages where sender_id=auth.uid() and client_message_id is not null
        and created_at>p_now-interval '1 hour')>=100 then
    raise exception 'THROTTLED: Retry later';
  end if;
end; $$;

create function private.btp09_hint(p_recipients uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_recipient uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  for v_recipient in select distinct r from unnest(p_recipients) r
    where private.notification_recipient_active(r) loop
    execute 'select realtime.send(''{}''::jsonb,''refresh'',$1,true)' using 'member:'||v_recipient::text;
  end loop;
end; $$;

create function private.btp09_open(p_operation uuid,p_body text,p_category text,p_order uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_hash text; v_receipt private.operation_receipts%rowtype; v_case uuid; v_payload jsonb; v_now timestamptz; v_event uuid;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Sign in with an active confirmed account'; end if;
  if p_operation is null or p_body is null or char_length(p_body)>1000 or char_length(btrim(p_body))<1
    or p_category is null or p_category not in ('general','account','order') or (p_order is not null and p_category<>'order') then
    raise exception 'VALIDATION: Invalid support request';
  end if;
  perform private.btp09_lock_sender();
  perform 1 from public.members where id=v_actor for share;
  if not private.is_active_member() then raise exception 'PERMISSION: Account unavailable'; end if;
  v_payload:=jsonb_build_object('command','open_support','body',p_body);
  if p_category<>'general' or p_order is not null then
    v_payload:=v_payload||jsonb_build_object('category',p_category,'order',p_order);
  end if;
  v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  insert into private.operation_receipts(actor_id,operation_id,command,payload_hash)
    values(v_actor,p_operation,'open_support',v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id=v_actor and operation_id=p_operation for update;
  if v_receipt.command<>'open_support' or v_receipt.payload_hash<>v_hash then raise exception 'CONFLICT: Operation ID already used'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if p_order is not null and not exists(select 1 from public.orders where id=p_order and v_actor in(customer_id,provider_id)) then
    raise exception 'PERMISSION: Order reference unavailable';
  end if;
  v_now:=clock_timestamp();
  perform private.btp09_check_quota(v_now);
  insert into public.conversations(requester_id,support_category,support_order_id,support_updated_at,created_at)
    values(v_actor,p_category,p_order,v_now,v_now) returning id into v_case;
  insert into public.conversation_members(conversation_id,member_id,role) values(v_case,v_actor,'requester');
  insert into public.messages(conversation_id,sequence,sender_id,client_message_id,body,created_at)
    values(v_case,1,v_actor,p_operation,btrim(p_body),v_now);
  insert into private.audit_events(actor_id,operation_id,event_type,target_id)
    values(v_actor,p_operation,'support_opened',v_case) returning id into v_event;
  update private.operation_receipts set result_id=v_case where actor_id=v_actor and operation_id=p_operation;
  perform private.btp09_hint(array(select recipient_id from public.notifications where event_id=v_event));
  return v_case;
end; $$;

create or replace function private.open_support(p_operation_id uuid,p_body text) returns uuid
language sql security definer set search_path='' as $$
  select private.btp09_open(p_operation_id,p_body,'general',null);
$$;

create function private.btp09_cases(p_before timestamptz,p_before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_operator boolean; v_lead boolean; v_cases jsonb; v_queue jsonb; v_operators jsonb;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Account unavailable'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION: Invalid queue cursor'; end if;
  v_operator:=private.has_staff_role('support');
  v_lead:=private.has_staff_role('platform_admin');
  select coalesce(jsonb_agg(to_jsonb(q) order by q."updatedAt" desc,q.id desc),'[]') into v_cases from (
    select c.id,c.status,c.support_category as category,c.support_updated_at as "updatedAt",
      c.support_escalated as escalated,c.requester_id=v_actor as requester,
      exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.role='support' and cm.revoked_at is null) as assigned
    from public.conversations c join public.conversation_members me on me.conversation_id=c.id and me.member_id=v_actor
    where c.kind='support' and me.revoked_at is null and (me.role='requester' or (me.role='support' and v_operator))
    order by (c.status='open') desc,c.support_updated_at desc,c.id desc limit 50
  ) q;
  if v_operator or v_lead then
    select coalesce(jsonb_agg(
      case when v_lead then to_jsonb(q) else to_jsonb(q)-'assigneeId'-'orderAccess'-'hasOrder'-'escalated'-'canClaim' end
      order by q."updatedAt" desc,q.id desc),'[]') into v_queue from (
      select c.id,c.support_category as category,c.support_version as version,c.support_updated_at as "updatedAt",
        c.support_escalated as escalated,cm.member_id as "assigneeId",g.member_id is not null as "orderAccess",
        c.support_order_id is not null as "hasOrder",c.requester_id<>v_actor as "canClaim"
      from public.conversations c
      left join public.conversation_members cm on cm.conversation_id=c.id and cm.role='support' and cm.revoked_at is null
      left join private.btp09_order_grants g on g.case_id=c.id
      where c.kind='support' and c.status='open'
        and (v_lead or (v_operator and cm.member_id is null and c.requester_id<>v_actor))
        and (p_before is null or (c.support_updated_at,c.id)<(p_before,p_before_id))
      order by c.support_updated_at desc,c.id desc limit 50
    ) q;
  end if;
  if v_lead then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name) order by m.display_name,m.id),'[]') into v_operators
      from public.staff_roles r join public.members m on m.id=r.member_id
      where r.role='support' and r.revoked_at is null and private.notification_support_operator(r.member_id);
  end if;
  return jsonb_build_object('cases',v_cases,'queue',coalesce(v_queue,'[]'),'operators',coalesce(v_operators,'[]'),'operator',v_operator,'lead',v_lead);
end; $$;

create function private.btp09_history(p_case uuid,p_before bigint,p_order_history boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_case public.conversations%rowtype; v_source uuid; v_messages jsonb; v_oldest bigint; v_assigned boolean; v_granted boolean;
begin
  if p_before<1 or p_order_history is null then raise exception 'VALIDATION: Invalid history cursor'; end if;
  if not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  select * into v_case from public.conversations where id=p_case and kind='support' for share;
  if not found or not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  select exists(select 1 from public.conversation_members where conversation_id=p_case and role='support' and revoked_at is null) into v_assigned;
  v_granted:=v_case.status='open' and private.has_staff_role('support') and exists(
    select 1 from private.btp09_order_grants g join public.conversation_members cm on cm.conversation_id=g.case_id and cm.member_id=g.member_id
    where g.case_id=p_case and g.member_id=auth.uid() and cm.role='support' and cm.revoked_at is null);
  v_source:=p_case;
  if p_order_history then
    if not v_granted then raise exception 'PERMISSION: Order chat grant unavailable'; end if;
    select conversation_id into strict v_source from public.orders where id=v_case.support_order_id;
    insert into private.audit_events(actor_id,event_type,target_id,detail)
      values(auth.uid(),'support_order_history_read',p_case,jsonb_build_object('order_id',v_case.support_order_id,'before',p_before));
  end if;
  select coalesce(jsonb_agg(private.btp08_message_json(m) order by m.sequence),'[]'),min(m.sequence)
    into v_messages,v_oldest from (
      select * from public.messages where conversation_id=v_source and (p_before is null or sequence<p_before)
      order by sequence desc limit 50
    ) m;
  return jsonb_build_object('id',p_case,'status',v_case.status,'category',v_case.support_category,
    'requester',v_case.requester_id=auth.uid(),'assigned',v_assigned,'escalated',v_case.support_escalated,
    'version',v_case.support_version,'orderAccess',v_granted,
    'hasOrder',v_case.support_order_id is not null,'messages',v_messages,
    'older',case when exists(select 1 from public.messages where conversation_id=v_source and sequence<v_oldest) then v_oldest end);
end; $$;

create function private.btp09_act(p_case uuid,p_action text,p_version integer,p_assignee uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_case public.conversations%rowtype; v_assignee uuid; v_member boolean; v_lead boolean; v_event uuid;
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Account unavailable'; end if;
  select * into v_case from public.conversations where id=p_case and kind='support' for update;
  if not found then raise exception 'PERMISSION: Case unavailable'; end if;
  select member_id into v_assignee from public.conversation_members where conversation_id=p_case and role='support' and revoked_at is null;
  v_member:=private.can_read_conversation(p_case);
  v_lead:=private.has_staff_role('platform_admin');
  if p_action='claim' then
    if not private.has_staff_role('support') or v_actor=v_case.requester_id then raise exception 'PERMISSION: Claim unavailable'; end if;
  elsif p_action in ('reassign','grant_order','revoke_order') then
    if not v_lead then raise exception 'PERMISSION: Lead access required'; end if;
  elsif p_action in ('resolve','escalate') then
    if not v_member or v_assignee is distinct from v_actor then raise exception 'PERMISSION: Assignee access required'; end if;
  elsif p_action='reopen' then
    if not v_member then raise exception 'PERMISSION: Case unavailable'; end if;
  else
    raise exception 'VALIDATION: Invalid case action';
  end if;
  if p_version is distinct from v_case.support_version or (p_action='reopen' and v_case.status<>'resolved')
    or (p_action<>'reopen' and v_case.status<>'open') then raise exception 'CONFLICT: Case state changed'; end if;
  if p_action='claim' and v_assignee is not null then raise exception 'CONFLICT: Case already assigned'; end if;
  if p_action in ('reassign','grant_order','revoke_order','escalate') and v_assignee is null then raise exception 'CONFLICT: Assign case first'; end if;
  if p_action in ('reassign','grant_order','revoke_order','escalate')
    and (p_reason is null or char_length(p_reason)>200 or char_length(btrim(p_reason))<1) then
    raise exception 'VALIDATION: An operational reason is required';
  end if;
  if p_action='reassign' and (p_assignee is null or p_assignee in (v_assignee,v_case.requester_id)
    or not private.notification_support_operator(p_assignee)) then raise exception 'VALIDATION: Choose an active support operator'; end if;
  if p_action in ('claim','reassign') then
    if p_action='reassign' then
      update public.conversation_members set revoked_at=clock_timestamp() where conversation_id=p_case and member_id=v_assignee;
      delete from private.btp09_order_grants where case_id=p_case;
      update private.notification_delivery_intents d set status='suppressed'
      from public.notifications n where n.id=d.notification_id and n.target_id=p_case and n.recipient_id=v_assignee
        and n.event_type in ('support_message','support_assigned') and d.channel='email' and d.status='pending';
    end if;
    insert into public.conversation_members(conversation_id,member_id,role)
      values(p_case,case when p_action='claim' then v_actor else p_assignee end,'support')
      on conflict(conversation_id,member_id) do update set granted_at=clock_timestamp(),revoked_at=null;
  elsif p_action='grant_order' then
    if not v_case.support_escalated or v_case.support_order_id is null or not private.notification_support_operator(v_assignee) then
      raise exception 'CONFLICT: Active escalated case with order required';
    end if;
    insert into private.btp09_order_grants(case_id,member_id) values(p_case,v_assignee) on conflict do nothing;
    if not found then raise exception 'CONFLICT: Order access already granted'; end if;
  elsif p_action in ('resolve','revoke_order') then
    delete from private.btp09_order_grants where case_id=p_case;
    if p_action='revoke_order' and not found then raise exception 'CONFLICT: Order access already revoked'; end if;
  elsif p_action='escalate' and v_case.support_escalated then
    raise exception 'CONFLICT: Case already escalated';
  end if;
  update public.conversations set support_version=support_version+1,support_updated_at=clock_timestamp(),
    status=case p_action when 'resolve' then 'resolved' when 'reopen' then 'open' else status end,
    support_escalated=case p_action when 'escalate' then true when 'resolve' then false else support_escalated end where id=p_case;
  insert into private.audit_events(actor_id,event_type,target_id,detail)
    values(v_actor,'support_'||p_action,p_case,jsonb_strip_nulls(jsonb_build_object('previous_assignee',v_assignee,
      'new_assignee',case p_action when 'claim' then v_actor when 'reassign' then p_assignee end,
      'order_id',case when p_action in ('grant_order','revoke_order') then v_case.support_order_id end,
      'reason',btrim(p_reason)))) returning id into v_event;
  if p_action='reopen' and v_assignee is null then
    perform private.enqueue_notification(v_event,'support_opened',p_case,v_actor,array(
      select member_id from public.staff_roles where role='support' and revoked_at is null));
  end if;
  perform private.btp09_hint(array[v_case.requester_id,v_assignee,
    case p_action when 'claim' then v_actor when 'reassign' then p_assignee end]);
end; $$;

create function private.btp09_send(p_case uuid,p_client uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_message public.messages%rowtype; v_seq bigint; v_status text; v_now timestamptz; v_recipients uuid[];
begin
  if not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  if p_client is null or p_body is null or char_length(p_body)>1000 or char_length(btrim(p_body))<1 then raise exception 'VALIDATION: Invalid text'; end if;
  perform private.btp09_lock_sender();
  select status into v_status from public.conversations where id=p_case and kind='support' for update;
  perform 1 from public.members where id=v_actor for share;
  if v_status is null or not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  select * into v_message from public.messages where conversation_id=p_case and sender_id=v_actor and client_message_id=p_client;
  if found then
    if v_message.body<>btrim(p_body) then raise exception 'CONFLICT: Client ID already used'; end if;
    return private.btp08_message_json(v_message);
  end if;
  if v_status<>'open' then raise exception 'CONFLICT: Reopen this case before replying'; end if;
  v_now:=clock_timestamp();
  perform private.btp09_check_quota(v_now);
  update public.conversations set next_sequence=next_sequence+1,support_updated_at=v_now where id=p_case returning next_sequence-1 into v_seq;
  insert into public.messages(conversation_id,sequence,sender_id,client_message_id,body,created_at)
    values(p_case,v_seq,v_actor,p_client,btrim(p_body),v_now) returning * into v_message;
  select array_agg(member_id) into v_recipients from public.conversation_members
    where conversation_id=p_case and revoked_at is null and member_id<>v_actor and role in ('requester','support');
  perform private.enqueue_notification(v_message.id,'support_message',p_case,v_actor,coalesce(v_recipients,'{}'::uuid[]));
  insert into private.btp08_email_sources(notification_id,conversation_id,sequence,window_end,due_at)
    select id,p_case,v_seq,date_trunc('minute',v_now)+interval '1 minute',date_trunc('minute',v_now)+interval '2 minutes'
    from public.notifications where event_id=v_message.id and event_type='support_message';
  perform private.btp09_hint(array(
    select recipient_id from public.notifications where event_id=v_message.id and event_type='support_message'));
  return private.btp08_message_json(v_message);
end; $$;

create function private.btp09_read(p_case uuid,p_sequence bigint) returns void
language plpgsql security definer set search_path='' as $$
declare v_high bigint;
begin
  if not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  select next_sequence-1 into v_high from public.conversations where id=p_case and kind='support' for share;
  if v_high is null or not private.can_read_conversation(p_case) then raise exception 'PERMISSION: Case unavailable'; end if;
  if p_sequence is null or p_sequence<1 or p_sequence>v_high then raise exception 'VALIDATION: Invalid read cursor'; end if;
  insert into public.conversation_reads(conversation_id,member_id,last_sequence) values(p_case,auth.uid(),p_sequence)
    on conflict(conversation_id,member_id) do update set last_sequence=excluded.last_sequence,updated_at=clock_timestamp()
    where public.conversation_reads.last_sequence<excluded.last_sequence;
end; $$;

create function public.btp09_open(p_operation uuid,p_body text,p_category text,p_order uuid default null) returns uuid
language sql security invoker set search_path='' as $$ select private.btp09_open(p_operation,p_body,p_category,p_order); $$;
create function public.btp09_cases(p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.btp09_cases(p_before,p_before_id); $$;
create function public.btp09_history(p_case uuid,p_before bigint default null,p_order_history boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select private.btp09_history(p_case,p_before,p_order_history); $$;
create function public.btp09_act(p_case uuid,p_action text,p_version integer,p_assignee uuid default null,p_reason text default null) returns void
language sql security invoker set search_path='' as $$ select private.btp09_act(p_case,p_action,p_version,p_assignee,p_reason); $$;
create function public.btp09_send(p_case uuid,p_client uuid,p_body text) returns jsonb
language sql security invoker set search_path='' as $$ select private.btp09_send(p_case,p_client,p_body); $$;
create function public.btp09_read(p_case uuid,p_sequence bigint) returns void
language sql security invoker set search_path='' as $$ select private.btp09_read(p_case,p_sequence); $$;

revoke all on function private.btp09_lock_sender(),private.btp09_check_quota(timestamptz),private.btp09_hint(uuid[]),
  private.btp09_open(uuid,text,text,uuid),private.btp09_cases(timestamptz,uuid),private.btp09_history(uuid,bigint,boolean),
  private.btp09_act(uuid,text,integer,uuid,text),private.btp09_send(uuid,uuid,text),private.btp09_read(uuid,bigint),
  public.btp09_open(uuid,text,text,uuid),public.btp09_cases(timestamptz,uuid),public.btp09_history(uuid,bigint,boolean),
  public.btp09_act(uuid,text,integer,uuid,text),public.btp09_send(uuid,uuid,text),public.btp09_read(uuid,bigint) from public,anon,authenticated;
grant execute on function private.btp09_open(uuid,text,text,uuid),private.btp09_cases(timestamptz,uuid),private.btp09_history(uuid,bigint,boolean),
  private.btp09_act(uuid,text,integer,uuid,text),private.btp09_send(uuid,uuid,text),private.btp09_read(uuid,bigint),
  public.btp09_open(uuid,text,text,uuid),public.btp09_cases(timestamptz,uuid),public.btp09_history(uuid,bigint,boolean),
  public.btp09_act(uuid,text,integer,uuid,text),public.btp09_send(uuid,uuid,text),public.btp09_read(uuid,bigint) to authenticated;
