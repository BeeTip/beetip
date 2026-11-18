alter table public.messages add column client_message_id uuid;
create unique index btp08_message_retry on public.messages(conversation_id,sender_id,client_message_id) where client_message_id is not null;
create index btp08_message_sender_time on public.messages(sender_id,created_at);
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  member_id uuid not null references public.members(id),
  last_sequence bigint not null default 0 check(last_sequence>=0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(conversation_id,member_id)
);
create index btp08_reads_member on public.conversation_reads(member_id);
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from public,anon,authenticated;
create table private.btp08_send_locks(member_id uuid primary key references public.members(id));
alter table private.btp08_send_locks enable row level security;
revoke all on private.btp08_send_locks from public,anon,authenticated;

-- Durable sources for the later delivery worker. No worker may dispatch a chat
-- intent without checking this sequence, live membership and the read cursor.
create table private.btp08_email_sources (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id),
  sequence bigint not null,
  window_end timestamptz not null,
  due_at timestamptz not null
);
create index btp08_email_conversation on private.btp08_email_sources(conversation_id);
alter table private.btp08_email_sources enable row level security;
revoke all on private.btp08_email_sources from public,anon,authenticated;

create function private.btp08_order_conversation(p_order uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_id uuid;
begin
  select conversation_id into v_id from public.orders where id=p_order and auth.uid() in(customer_id,provider_id);
  if v_id is null or not private.can_read_conversation(v_id) then raise exception 'PERMISSION: Conversation unavailable'; end if;
  return v_id;
end; $$;

create function private.btp08_message_json(p_message public.messages) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',p_message.id,'sequence',p_message.sequence,'senderId',p_message.sender_id,
    'clientId',p_message.client_message_id,'body',p_message.body,'createdAt',p_message.created_at);
$$;

create function private.btp08_send(p_order uuid,p_client uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_listing uuid; v_row public.messages%rowtype; v_next bigint; v_recipient uuid; v_notification uuid; v_now timestamptz;
begin
  v_id:=private.btp08_order_conversation(p_order);
  if p_client is null or p_body is null or char_length(p_body)>1000 or char_length(btrim(p_body))<1 then raise exception 'VALIDATION: Invalid text'; end if;
  insert into private.btp08_send_locks values(auth.uid()) on conflict do nothing;
  perform 1 from private.btp08_send_locks where member_id=auth.uid() for update;
  select listing_id into v_listing from public.orders where id=p_order;
  perform 1 from public.listings where id=v_listing for update;
  perform 1 from public.orders where id=p_order for update;
  perform 1 from public.reservations where order_id=p_order for update;
  perform 1 from public.conversations where id=v_id for update;
  perform 1 from public.conversation_members where conversation_id=v_id and member_id=auth.uid() for share;
  perform 1 from public.members where id=auth.uid() for share;
  if not private.can_read_conversation(v_id) then raise exception 'PERMISSION: Conversation unavailable'; end if;
  select * into v_row from public.messages where conversation_id=v_id and sender_id=auth.uid() and client_message_id=p_client;
  if found then
    if v_row.body<>btrim(p_body) then raise exception 'CONFLICT: Client ID bound to another body'; end if;
    return private.btp08_message_json(v_row);
  end if;
  if exists(select 1 from public.conversations where id=v_id and status<>'open')
    or exists(select 1 from public.orders o join public.reservations r on r.order_id=o.id where o.id=p_order and
      (o.state in('cancelled','expired') or r.released_at is not null or (o.state='awaiting_payment' and r.funding_verified_at is null and r.expires_at<=clock_timestamp()))) then raise exception 'CONFLICT: Conversation closed'; end if;
  v_now:=clock_timestamp();
  if (select count(*) from public.messages where sender_id=auth.uid() and client_message_id is not null and created_at>v_now-interval '1 minute')>=10
    or (select count(*) from public.messages where sender_id=auth.uid() and client_message_id is not null and created_at>v_now-interval '1 hour')>=100 then
    raise exception 'THROTTLED: Retry after 60 seconds';
  end if;
  update public.conversations set next_sequence=next_sequence+1 where id=v_id returning next_sequence-1 into v_next;
  insert into public.messages(conversation_id,sequence,sender_id,client_message_id,body,created_at)
    values(v_id,v_next,auth.uid(),p_client,btrim(p_body),v_now) returning * into v_row;
  for v_recipient in select cm.member_id from public.conversation_members cm
    join public.orders o on o.conversation_id=cm.conversation_id
    where cm.conversation_id=v_id and cm.revoked_at is null and cm.role in('customer','provider')
      and cm.member_id in(o.customer_id,o.provider_id) and cm.member_id<>auth.uid()
      and private.notification_recipient_active(cm.member_id) loop
    insert into public.notifications(event_id,recipient_id,actor_id,event_type,target_id)
      values(v_row.id,v_recipient,auth.uid(),'order_message',p_order) returning id into v_notification;
    insert into private.notification_delivery_intents(notification_id,event_id,recipient_id,channel,template,status)
      values(v_notification,v_row.id,v_recipient,'in_app','order_message.v1','delivered'),
        (v_notification,v_row.id,v_recipient,'email','order_message.v1','pending');
    insert into private.btp08_email_sources values(v_notification,v_id,v_next,date_trunc('minute',v_now)+interval '1 minute',date_trunc('minute',v_now)+interval '2 minutes');
  end loop;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    for v_recipient in select member_id from public.conversation_members where conversation_id=v_id and revoked_at is null
      and role in('customer','provider') and private.notification_recipient_active(member_id) loop
      execute 'select realtime.send(''{}''::jsonb,''refresh'',$1,true)' using 'member:'||v_recipient::text;
    end loop;
  end if;
  return private.btp08_message_json(v_row);
end; $$;

create function private.btp08_history(p_order uuid,p_before bigint,p_after bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_id uuid; v_high bigint; v_rows jsonb; v_min bigint; v_max bigint; v_read bigint;
begin
  v_id:=private.btp08_order_conversation(p_order);
  if (p_before is not null and p_after is not null) or p_before<1 or p_after<0 then raise exception 'VALIDATION: Invalid cursor'; end if;
  select next_sequence-1 into v_high from public.conversations where id=v_id;
  select coalesce(jsonb_agg(private.btp08_message_json(m) order by m.sequence),'[]'),min(m.sequence),max(m.sequence)
    into v_rows,v_min,v_max from (
      select * from public.messages where conversation_id=v_id and sequence<=v_high
        and (p_before is null or sequence<p_before) and (p_after is null or sequence>p_after)
      order by case when p_after is not null then sequence end asc,sequence desc limit 50
    ) m;
  select coalesce((select last_sequence from public.conversation_reads where conversation_id=v_id and member_id=auth.uid()),0) into v_read;
  return jsonb_build_object('messages',v_rows,'highWater',v_high,'readSequence',v_read,
    'older',case when exists(select 1 from public.messages where conversation_id=v_id and sequence<v_min) then v_min end,
    'after',coalesce(v_max,p_after,0),'hasMore',p_after is not null and coalesce(v_max,p_after)<v_high,
    'unread',(select count(*) from public.messages where conversation_id=v_id and sender_id<>auth.uid() and sequence>v_read),
    'closed',exists(select 1 from public.conversations where id=v_id and status<>'open') or exists(select 1 from public.orders o join public.reservations r on r.order_id=o.id where o.id=p_order and
      (o.state in('cancelled','expired') or r.released_at is not null or (o.state='awaiting_payment' and r.funding_verified_at is null and r.expires_at<=clock_timestamp()))));
end; $$;

create function private.btp08_read(p_order uuid,p_sequence bigint) returns void
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_high bigint;
begin
  v_id:=private.btp08_order_conversation(p_order);
  select next_sequence-1 into v_high from public.conversations where id=v_id;
  if p_sequence is null or p_sequence<0 or p_sequence>v_high then raise exception 'VALIDATION: Invalid read cursor'; end if;
  insert into public.conversation_reads(conversation_id,member_id,last_sequence) values(v_id,auth.uid(),p_sequence)
    on conflict(conversation_id,member_id) do update set last_sequence=greatest(public.conversation_reads.last_sequence,excluded.last_sequence),updated_at=clock_timestamp();
end; $$;

create function public.btp08_send(p_order uuid,p_client uuid,p_body text) returns jsonb language sql security invoker set search_path='' as $$ select private.btp08_send(p_order,p_client,p_body); $$;
create function public.btp08_history(p_order uuid,p_before bigint default null,p_after bigint default null) returns jsonb language sql stable security invoker set search_path='' as $$ select private.btp08_history(p_order,p_before,p_after); $$;
create function public.btp08_read(p_order uuid,p_sequence bigint) returns void language sql security invoker set search_path='' as $$ select private.btp08_read(p_order,p_sequence); $$;
revoke all on function private.btp08_order_conversation(uuid),private.btp08_message_json(public.messages),private.btp08_send(uuid,uuid,text),private.btp08_history(uuid,bigint,bigint),private.btp08_read(uuid,bigint),public.btp08_send(uuid,uuid,text),public.btp08_history(uuid,bigint,bigint),public.btp08_read(uuid,bigint) from public,anon,authenticated;
grant execute on function private.btp08_send(uuid,uuid,text),private.btp08_history(uuid,bigint,bigint),private.btp08_read(uuid,bigint),public.btp08_send(uuid,uuid,text),public.btp08_history(uuid,bigint,bigint),public.btp08_read(uuid,bigint) to authenticated;

alter function private.notification_target_allowed(uuid,text,uuid) rename to btp08_previous_target_allowed;
create function private.notification_target_allowed(p_member uuid,p_type text,p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.btp08_previous_target_allowed(p_member,p_type,p_target) and (p_type<>'order_message' or exists(
    select 1 from public.orders o join public.conversation_members cm on cm.conversation_id=o.conversation_id
    where o.id=p_target and cm.member_id=p_member and cm.revoked_at is null and cm.role in('customer','provider')));
$$;
revoke all on function private.notification_target_allowed(uuid,text,uuid) from public,anon,authenticated;

do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute 'create policy btp08_member_hint on realtime.messages for select to authenticated using (extension=''broadcast'' and realtime.topic()=''member:''||auth.uid()::text and private.is_active_member())';
  end if;
end; $$;
