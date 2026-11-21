begin;

do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('beetip-email-worker','beetip-email-watchdog');
  end if;
end;
$$;

drop trigger btp11_summary_source on private.notification_delivery_intents;
drop trigger btp11_unread_source on private.btp08_email_sources;

-- Suppress queued work while preserving prior provider outcomes and audit references.
update private.email_deliveries
  set status='suppressed',last_error='application_email_retired',open_for_sources=false,
    lease_token=null,lease_until=null,updated_at=clock_timestamp()
  where status in ('queued','retry','leased','sending','uncertain','dead_letter');
update private.notification_delivery_intents
  set status='suppressed' where channel='email' and status='pending';

drop trigger btp11_sync_intents on private.email_deliveries;
drop function public.btp11_claim(), public.btp11_prepare(uuid,uuid,text[]),
  public.btp11_finish(uuid,uuid,text,text,integer), public.btp11_webhook(uuid,text,text,text),
  public.btp11_heartbeat(), public.btp11_operator_queue(), public.btp11_operator_action(uuid,uuid,text);
drop function private.btp11_claim(), private.btp11_prepare(uuid,uuid,text[]),
  private.btp11_finish(uuid,uuid,text,text,integer), private.btp11_webhook(uuid,text,text,text),
  private.btp11_heartbeat(), private.btp11_operator_queue(), private.btp11_operator_action(uuid,uuid,text),
  private.btp11_alerts(), private.btp11_email_allowed(uuid), private.btp11_on_source(),
  private.btp11_enqueue(uuid), private.btp11_sync_intents();

drop function public.set_notification_preference(text,boolean), private.set_notification_preference(text,boolean);
drop function private.notification_email_allowed(uuid);
revoke all on public.notification_preferences from public,anon,authenticated;

update private.notification_rules set email_mode='in_app_only' where email_mode<>'in_app_only';
alter table private.notification_rules add constraint notification_rules_in_app_only check (email_mode='in_app_only');

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
  end loop;
end; $$;

create or replace function private.btp08_send(p_order uuid,p_client uuid,p_body text) returns jsonb
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
      values(v_notification,v_row.id,v_recipient,'in_app','order_message.v1','delivered');
  end loop;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    for v_recipient in select member_id from public.conversation_members where conversation_id=v_id and revoked_at is null
      and role in('customer','provider') and private.notification_recipient_active(member_id) loop
      execute 'select realtime.send(''{}''::jsonb,''refresh'',$1,true)' using 'member:'||v_recipient::text;
    end loop;
  end if;
  return private.btp08_message_json(v_row);
end; $$;

create or replace function private.btp09_send(p_case uuid,p_client uuid,p_body text) returns jsonb
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
  perform private.btp09_hint(array(
    select recipient_id from public.notifications where event_id=v_message.id and event_type='support_message'));
  return private.btp08_message_json(v_message);
end; $$;

create or replace function private.notification_inbox(p_before timestamptz default null,p_before_id uuid default null)
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
    where read_at is null and private.notification_visible(recipient_id,event_type,target_id)));
end;
$$;

commit;
