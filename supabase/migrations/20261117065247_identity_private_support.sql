create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.staff_roles (
  member_id uuid not null references public.members(id) on delete cascade,
  role text not null check (role in ('membership_review', 'support', 'finance_operation', 'finance_review', 'platform_admin')),
  granted_by uuid references public.members(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (member_id, role)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'support' check (kind = 'support'),
  requester_id uuid not null references public.members(id),
  status text not null default 'open' check (status in ('open', 'resolved')),
  next_sequence bigint not null default 2 check (next_sequence >= 2),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  member_id uuid not null references public.members(id),
  role text not null check (role in ('requester', 'support')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (conversation_id, member_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  sequence bigint not null check (sequence > 0),
  sender_id uuid not null references public.members(id),
  body text not null check (char_length(body) between 1 and 1000 and body = btrim(body)),
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence)
);

create table private.operation_receipts (
  actor_id uuid not null,
  operation_id uuid not null,
  command text not null,
  payload_hash text not null,
  result_id uuid,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  operation_id uuid,
  event_type text not null,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversations_requester_created on public.conversations(requester_id, created_at desc, id);
create index conversation_members_member_active on public.conversation_members(member_id, conversation_id) where revoked_at is null;
create index staff_roles_active on public.staff_roles(member_id, role) where revoked_at is null;
create index audit_events_actor_created on private.audit_events(actor_id, created_at desc);

alter table public.members enable row level security;
alter table public.staff_roles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table private.operation_receipts enable row level security;
alter table private.audit_events enable row level security;

revoke all on table public.members, public.staff_roles, public.conversations, public.conversation_members, public.messages from public, anon, authenticated;
revoke all on table private.operation_receipts, private.audit_events from public, anon, authenticated;
grant select on public.members, public.staff_roles, public.conversations, public.conversation_members, public.messages to authenticated;

create function private.create_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Anggota BeeTip'), 80)
  );
  return new;
end;
$$;
revoke all on function private.create_member() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_member();

create function private.has_verified_identity()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join auth.sessions s on s.user_id = u.id
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
      and s.id::text = (select auth.jwt() ->> 'session_id')
      and (s.not_after is null or s.not_after > now())
  );
$$;

create function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_verified_identity() and exists (
    select 1 from public.members m
    where m.id = (select auth.uid()) and m.status <> 'suspended'
  );
$$;

create function private.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_member() and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.member_id = (select auth.uid())
      and cm.revoked_at is null
      and (
        cm.role = 'requester'
        or (
          cm.role = 'support'
          and (select auth.jwt() ->> 'aal') = 'aal2'
          and exists (
            select 1 from public.staff_roles sr
            where sr.member_id = (select auth.uid()) and sr.role = 'support' and sr.revoked_at is null
          )
        )
      )
  );
$$;

revoke all on function private.has_verified_identity(), private.is_active_member(), private.can_read_conversation(uuid) from public, anon, authenticated;
grant execute on function private.has_verified_identity(), private.is_active_member(), private.can_read_conversation(uuid) to authenticated;

create policy members_read_self on public.members for select to authenticated
using (id = (select auth.uid()) and (select private.has_verified_identity()));
create policy staff_read_own_grants on public.staff_roles for select to authenticated
using (member_id = (select auth.uid()) and (select private.is_active_member()));
create policy conversations_read_participant on public.conversations for select to authenticated
using (private.can_read_conversation(id));
create policy conversation_members_read_participant on public.conversation_members for select to authenticated
using (private.can_read_conversation(conversation_id));
create policy messages_read_participant on public.messages for select to authenticated
using (private.can_read_conversation(conversation_id));

create function private.open_support(p_operation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_receipt private.operation_receipts%rowtype;
  v_conversation_id uuid;
begin
  if not private.is_active_member() then
    raise exception using errcode = 'P0001', message = 'PERMISSION: Sign in with an active confirmed account.';
  end if;
  if p_operation_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: A valid operation ID and 1 to 1000 character message are required.';
  end if;

  v_payload_hash := encode(sha256(convert_to(jsonb_build_object('command', 'open_support', 'body', p_body)::text, 'UTF8')), 'hex');
  insert into private.operation_receipts (actor_id, operation_id, command, payload_hash)
  values (v_actor, p_operation_id, 'open_support', v_payload_hash)
  on conflict (actor_id, operation_id) do nothing;

  select * into strict v_receipt from private.operation_receipts
  where actor_id = v_actor and operation_id = p_operation_id for update;

  if v_receipt.command <> 'open_support' or v_receipt.payload_hash <> v_payload_hash then
    raise exception using errcode = 'P0001', message = 'CONFLICT: This operation ID was used with another request.';
  end if;
  if v_receipt.result_id is not null then
    return v_receipt.result_id;
  end if;

  insert into public.conversations (requester_id) values (v_actor) returning id into v_conversation_id;
  insert into public.conversation_members (conversation_id, member_id, role) values (v_conversation_id, v_actor, 'requester');
  insert into public.messages (conversation_id, sequence, sender_id, body) values (v_conversation_id, 1, v_actor, btrim(p_body));
  insert into private.audit_events (actor_id, operation_id, event_type, target_id)
  values (v_actor, p_operation_id, 'support_opened', v_conversation_id);
  update private.operation_receipts set result_id = v_conversation_id where actor_id = v_actor and operation_id = p_operation_id;
  return v_conversation_id;
end;
$$;
revoke all on function private.open_support(uuid, text) from public, anon, authenticated;
grant execute on function private.open_support(uuid, text) to authenticated;

create function public.open_support(p_operation_id uuid, p_body text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.open_support(p_operation_id, p_body);
$$;
revoke all on function public.open_support(uuid, text) from public, anon, authenticated;
grant execute on function public.open_support(uuid, text) to authenticated;
