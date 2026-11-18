begin;
do $$
declare
  v_operator uuid := nullif(current_setting('beetip.bootstrap_operator_id', true), '')::uuid;
  v_reason text := nullif(btrim(current_setting('beetip.bootstrap_reason', true)), '');
begin
  if current_user <> 'postgres' then raise exception 'Run bootstrap only as the project database owner.'; end if;
  if v_operator is null or v_reason is null or char_length(v_reason) not between 10 and 200 then
    raise exception 'Set operator ID and a 10 to 200 character named owner approval reference without private identity data.';
  end if;
  lock table public.staff_roles in share row exclusive mode;
  if exists (select 1 from public.staff_roles where role = 'platform_admin' and revoked_at is null) then
    raise exception 'An active platform administrator already exists. Use the audited staff command.';
  end if;
  if not exists (
    select 1 from public.members m join auth.users u on u.id = m.id
    where m.id = v_operator and m.status <> 'suspended' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
  ) then raise exception 'Operator needs an active confirmed account and verified MFA.'; end if;
  insert into public.staff_roles(member_id, role) values (v_operator, 'platform_admin')
  on conflict (member_id, role) do update set granted_at = now(), revoked_at = null;
  insert into private.audit_events(event_type, target_id, detail)
  values ('platform_operator_bootstrapped', v_operator, jsonb_build_object('database_role', current_user, 'approval_reference', v_reason));
end;
$$;
commit;
