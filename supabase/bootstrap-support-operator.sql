begin;

do $$
declare
  v_operator uuid := nullif(current_setting('beetip.bootstrap_operator_id', true), '')::uuid;
  v_conversation uuid := nullif(current_setting('beetip.bootstrap_conversation_id', true), '')::uuid;
  v_reason text := nullif(btrim(current_setting('beetip.bootstrap_reason', true)), '');
begin
  if current_user <> 'postgres' then
    raise exception 'Run bootstrap only as the project database owner.';
  end if;
  if v_operator is null or v_conversation is null or v_reason is null then
    raise exception 'Set beetip.bootstrap_operator_id, beetip.bootstrap_conversation_id, and beetip.bootstrap_reason first.';
  end if;
  if not exists (
    select 1 from public.members m join auth.users u on u.id = m.id
    where m.id = v_operator and m.status <> 'suspended'
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
  ) then
    raise exception 'Operator must have a confirmed active BeeTip account.';
  end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = v_operator and f.status = 'verified') then
    raise exception 'Operator must enroll and verify MFA before assignment.';
  end if;
  if not exists (select 1 from public.conversations c where c.id = v_conversation and c.requester_id <> v_operator) then
    raise exception 'Select an existing support case belonging to another member.';
  end if;
  insert into public.staff_roles(member_id, role)
  values (v_operator, 'support')
  on conflict (member_id, role) do update set granted_at = now(), revoked_at = null;
  insert into public.conversation_members(conversation_id, member_id, role)
  values (v_conversation, v_operator, 'support')
  on conflict (conversation_id, member_id) do update set role = 'support', granted_at = now(), revoked_at = null;
  insert into private.audit_events(actor_id, event_type, target_id, detail)
  values (v_operator, 'support_operator_bootstrapped', v_conversation, jsonb_build_object('database_role', current_user, 'reason', v_reason));
end;
$$;

commit;
