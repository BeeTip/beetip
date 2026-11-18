create table public.affiliation_requests (
  id uuid primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  institution text not null check (char_length(institution) between 2 and 100),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
  decision_code text check (decision_code in ('matched', 'unreadable', 'not_matched')),
  reviewed_by uuid references public.members(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index affiliation_one_open on public.affiliation_requests(member_id) where status in ('draft', 'pending', 'approved');
create index affiliation_queue on public.affiliation_requests(status, created_at, id);
create index affiliation_reviewer on public.affiliation_requests(reviewed_by);
alter table public.affiliation_requests enable row level security;
revoke all on public.affiliation_requests from public, anon, authenticated;
grant select on public.affiliation_requests to authenticated;

create function private.has_staff_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member()
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
    and exists (select 1 from public.staff_roles r where r.member_id = (select auth.uid()) and r.role = p_role and r.revoked_at is null);
$$;
revoke all on function private.has_staff_role(text) from public, anon, authenticated;
grant execute on function private.has_staff_role(text) to authenticated;

create policy affiliation_read on public.affiliation_requests for select to authenticated
using ((select private.is_active_member()) and (member_id = (select auth.uid()) or (status <> 'draft' and (select private.has_staff_role('membership_review')))));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('affiliation-evidence', 'affiliation-evidence', false, 2097152, array['image/jpeg', 'image/png']);

create function private.can_read_affiliation_evidence(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.affiliation_requests a
    where p_name = a.member_id::text || '/' || a.id::text || '/evidence'
      and (a.member_id = (select auth.uid()) or (a.status <> 'draft' and private.has_staff_role('membership_review')))
  );
$$;
create function private.can_upload_affiliation_evidence(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.affiliation_requests a
    where a.member_id = (select auth.uid()) and a.status = 'draft'
      and p_name = a.member_id::text || '/' || a.id::text || '/evidence'
  );
$$;
revoke all on function private.can_read_affiliation_evidence(text), private.can_upload_affiliation_evidence(text) from public, anon, authenticated;
grant execute on function private.can_read_affiliation_evidence(text), private.can_upload_affiliation_evidence(text) to authenticated;
create policy affiliation_evidence_insert on storage.objects for insert to authenticated
with check (bucket_id = 'affiliation-evidence' and private.can_upload_affiliation_evidence(name));
create policy affiliation_evidence_read on storage.objects for select to authenticated
using (bucket_id = 'affiliation-evidence' and private.can_read_affiliation_evidence(name));

create function private.affiliation_command(p_operation_id uuid, p_action text, p_request_id uuid, p_value text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_request public.affiliation_requests%rowtype;
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
begin
  if not private.is_active_member() then
    raise exception 'PERMISSION: Active confirmed account required.';
  end if;
  if p_action in ('approve', 'reject') and not private.has_staff_role('membership_review') then
    raise exception 'PERMISSION: Membership review with MFA required.';
  end if;
  if p_operation_id is null or p_request_id is null or p_action is null or p_action not in ('begin', 'submit', 'withdraw', 'approve', 'reject')
    or p_value is null or char_length(p_value) > 100
    or (p_action = 'begin' and char_length(btrim(p_value)) not between 2 and 100)
    or (p_action = 'approve' and p_value <> 'matched')
    or (p_action = 'reject' and p_value not in ('unreadable', 'not_matched'))
    or (p_action in ('submit', 'withdraw') and p_value <> '') then
    raise exception 'VALIDATION: Invalid affiliation command.';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_action, p_request_id, p_value)::text, 'UTF8')), 'hex');
  insert into private.operation_receipts(actor_id, operation_id, command, payload_hash)
  values (v_actor, p_operation_id, 'affiliation', v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id = v_actor and operation_id = p_operation_id for update;
  if v_receipt.command <> 'affiliation' or v_receipt.payload_hash <> v_hash then
    raise exception 'CONFLICT: Operation ID already used.';
  end if;
  if p_action = 'begin' then
    if v_receipt.result_id is null then
      begin
        insert into public.affiliation_requests(id, member_id, institution) values (p_request_id, v_actor, btrim(p_value));
      exception when unique_violation then
        raise exception 'CONFLICT: An affiliation request is already active.';
      end;
    end if;
  else
    select * into v_request from public.affiliation_requests where id = p_request_id for update;
    if not found or (p_action in ('submit', 'withdraw') and v_request.member_id <> v_actor)
      or (p_action in ('approve', 'reject') and v_request.member_id = v_actor) then
      raise exception 'PERMISSION: Request access denied.';
    end if;
  end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if p_action = 'submit' then
    if v_request.status <> 'draft' then raise exception 'CONFLICT: Request is no longer a draft.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'affiliation-evidence'
      and o.name = v_actor::text || '/' || p_request_id::text || '/evidence'
      and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png')
      and (o.metadata ->> 'size')::bigint between 1 and 2097152) then
      raise exception 'VALIDATION: Upload a supported evidence image first.';
    end if;
    update public.affiliation_requests set status = 'pending' where id = p_request_id;
  elsif p_action = 'withdraw' then
    if v_request.status = 'withdrawn' then raise exception 'CONFLICT: Request was already withdrawn.'; end if;
    update public.affiliation_requests set status = 'withdrawn' where id = p_request_id;
  elsif p_action in ('approve', 'reject') then
    if v_request.status <> 'pending' then raise exception 'CONFLICT: Request is no longer pending.'; end if;
    update public.affiliation_requests set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      decision_code = p_value, reviewed_by = v_actor, reviewed_at = now() where id = p_request_id;
  end if;
  insert into private.audit_events(actor_id, operation_id, event_type, target_id, detail)
  values (v_actor, p_operation_id, 'affiliation_' || p_action, p_request_id,
    case when p_action in ('approve', 'reject') then jsonb_build_object('decision_code', p_value) else '{}'::jsonb end);
  update private.operation_receipts set result_id = p_request_id where actor_id = v_actor and operation_id = p_operation_id;
  return p_request_id;
end;
$$;
revoke all on function private.affiliation_command(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function private.affiliation_command(uuid, text, uuid, text) to authenticated;
create function public.affiliation_command(p_operation_id uuid, p_action text, p_request_id uuid, p_value text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.affiliation_command(p_operation_id, p_action, p_request_id, p_value);
$$;
revoke all on function public.affiliation_command(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.affiliation_command(uuid, text, uuid, text) to authenticated;

create function private.set_staff_role(p_operation_id uuid, p_member_id uuid, p_role text, p_grant boolean, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_receipt private.operation_receipts%rowtype;
  v_hash text;
begin
  if not private.has_staff_role('platform_admin') or p_member_id = v_actor then
    raise exception 'PERMISSION: Independent platform administrator with MFA required.';
  end if;
  if p_operation_id is null or p_member_id is null or p_grant is null or p_role is null
    or p_role not in ('membership_review', 'support', 'finance_operation', 'finance_review', 'platform_admin')
    or p_reason is null or p_reason not in ('owner_approved', 'duty_changed', 'access_removed') then
    raise exception 'VALIDATION: Invalid staff grant.';
  end if;
  perform 1 from public.members where id = p_member_id for update;
  if not found then raise exception 'VALIDATION: Member not found.'; end if;
  if p_grant and not exists (select 1 from public.members m join auth.users u on u.id = m.id
    where m.id = p_member_id and m.status <> 'suspended' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and exists (select 1 from auth.mfa_factors f where f.user_id = m.id and f.status = 'verified')) then
    raise exception 'PERMISSION: Staff target needs active confirmed identity and verified MFA.';
  end if;
  if p_grant and p_role in ('finance_operation', 'finance_review') and exists (
    select 1 from public.staff_roles where member_id = p_member_id and revoked_at is null
      and role = case when p_role = 'finance_operation' then 'finance_review' else 'finance_operation' end
  ) then raise exception 'CONFLICT: Financial operation and review must be independent.'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_member_id, p_role, p_grant, p_reason)::text, 'UTF8')), 'hex');
  insert into private.operation_receipts(actor_id, operation_id, command, payload_hash)
  values (v_actor, p_operation_id, 'set_staff_role', v_hash) on conflict do nothing;
  select * into strict v_receipt from private.operation_receipts where actor_id = v_actor and operation_id = p_operation_id for update;
  if v_receipt.command <> 'set_staff_role' or v_receipt.payload_hash <> v_hash then raise exception 'CONFLICT: Operation ID already used.'; end if;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  insert into public.staff_roles(member_id, role, granted_by, revoked_at)
    values (p_member_id, p_role, v_actor, case when p_grant then null else now() end)
  on conflict (member_id, role) do update set granted_by = v_actor, granted_at = now(), revoked_at = excluded.revoked_at;
  insert into private.audit_events(actor_id, operation_id, event_type, target_id, detail)
  values (v_actor, p_operation_id, case when p_grant then 'staff_granted' else 'staff_revoked' end,
    p_member_id, jsonb_build_object('role', p_role, 'reason_code', p_reason));
  update private.operation_receipts set result_id = p_member_id where actor_id = v_actor and operation_id = p_operation_id;
  return p_member_id;
end;
$$;
revoke all on function private.set_staff_role(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function private.set_staff_role(uuid, uuid, text, boolean, text) to authenticated;
create function public.set_staff_role(p_operation_id uuid, p_member_id uuid, p_role text, p_grant boolean, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.set_staff_role(p_operation_id, p_member_id, p_role, p_grant, p_reason);
$$;
revoke all on function public.set_staff_role(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.set_staff_role(uuid, uuid, text, boolean, text) to authenticated;

create policy platform_read_staff on public.staff_roles for select to authenticated
using ((select private.has_staff_role('platform_admin')));

create or replace function private.can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.member_id = (select auth.uid()) and cm.revoked_at is null
      and (cm.role = 'requester' or (cm.role = 'support' and private.has_staff_role('support')))
  );
$$;
