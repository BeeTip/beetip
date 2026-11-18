begin;
drop trigger if exists notification_audit on private.audit_events;
drop trigger if exists notification_assignment on public.conversation_members;
do $$
begin
  if to_regclass('private.acceptance_notification_intents') is not null then
    execute 'drop trigger if exists notification_acceptance on private.acceptance_notification_intents';
  end if;
end;
$$;
drop function public.notification_inbox(timestamptz,uuid),public.read_notification(uuid),public.set_notification_preference(text,boolean),public.notification_target(uuid);
drop function private.notification_inbox(timestamptz,uuid),private.read_notification(uuid),private.set_notification_preference(text,boolean),private.notification_target(uuid),
  private.notification_email_allowed(uuid),private.notification_from_audit(),private.notification_from_assignment(),private.notification_from_acceptance();
drop table private.notification_delivery_intents;
drop table public.notifications;
drop table public.notification_preferences;
drop function private.notification_visible(uuid,text,uuid),private.enqueue_notification(uuid,text,uuid,uuid,uuid[]),private.notification_target_allowed(uuid,text,uuid),
  private.notification_support_operator(uuid),private.notification_recipient_active(uuid);
drop table private.notification_rules;
commit;
