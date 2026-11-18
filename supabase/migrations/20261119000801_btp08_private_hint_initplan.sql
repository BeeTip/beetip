do $$ begin
  if to_regclass('realtime.messages') is not null then
    alter policy btp08_member_hint on realtime.messages using (
      extension='broadcast' and (select realtime.topic())='member:'||(select auth.uid())::text
      and (select private.is_active_member())
    );
  end if;
end; $$;
