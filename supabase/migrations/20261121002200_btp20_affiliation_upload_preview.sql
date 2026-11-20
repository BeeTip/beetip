create function private.preview_affiliation_uploads(p_before timestamptz)
returns table (object_id uuid, created_at timestamptz, updated_at timestamptz, disposition text)
language sql stable security invoker set search_path = '' set row_security = off as $$
  select o.id, o.created_at, o.updated_at,
    case
      when o.owner is not null or o.owner_id is not null then 'storage_owned'
      when exists (select 1 from public.affiliation_requests a where a.id = path.parts[2]::uuid) then 'linked_request'
      when exists (
        select 1 from private.operation_receipts r where r.command = 'affiliation' and r.result_id = path.parts[2]::uuid
      ) or exists (
        select 1 from private.audit_events e
        where e.target_id = path.parts[2]::uuid
          and e.event_type in ('affiliation_begin', 'affiliation_submit', 'affiliation_withdraw', 'affiliation_approve', 'affiliation_reject')
      ) then 'request_history'
      when exists (select 1 from public.members m where m.id = path.parts[1]::uuid) then 'linked_member'
      else 'unlinked'
    end
  from storage.objects o
  cross join lateral regexp_matches(o.name collate "C",
    '^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/evidence$') as path(parts)
  where o.bucket_id = 'affiliation-evidence'
    and isfinite(p_before) and p_before <= now()
    and o.created_at < p_before and o.updated_at < p_before;
$$;

revoke all on function private.preview_affiliation_uploads(timestamptz) from public, anon, authenticated, service_role;
