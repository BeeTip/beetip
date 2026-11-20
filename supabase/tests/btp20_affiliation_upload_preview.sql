begin;

insert into storage.objects(id, bucket_id, name, created_at, updated_at)
values (
  '22000000-0000-4000-8000-000000000001',
  'affiliation-evidence',
  '22100000-0000-4000-8000-000000000001/22200000-0000-4000-8000-000000000001/evidence',
  '2020-01-01T00:00:00Z',
  '2020-01-02T00:00:00Z'
);

do $$
begin
  if not exists (
    select 1 from private.preview_affiliation_uploads('2020-02-01T00:00:00Z')
    where object_id = '22000000-0000-4000-8000-000000000001'
      and disposition = 'unlinked'
  ) then
    raise exception 'Expected the old unlinked affiliation object in the preview';
  end if;
end;
$$;

insert into auth.users(id, email, email_confirmed_at, is_anonymous, raw_user_meta_data)
values ('22100000-0000-4000-8000-000000000002', 'btp20-preview@example.invalid', now(), false, '{}');

insert into public.affiliation_requests(id, member_id, institution, status)
values
  ('22200000-0000-4000-8000-000000000002', '22100000-0000-4000-8000-000000000002', 'Synthetic campus', 'draft'),
  ('22200000-0000-4000-8000-000000000003', '22100000-0000-4000-8000-000000000002', 'Synthetic campus', 'withdrawn');
select public.claim_affiliation_upload(
  '22200000-0000-4000-8000-000000000002',
  '22100000-0000-4000-8000-000000000002',
  repeat('a', 64)
);

insert into private.operation_receipts(actor_id, operation_id, command, payload_hash, result_id)
values ('22100000-0000-4000-8000-000000000001', '22300000-0000-4000-8000-000000000001',
  'affiliation', 'synthetic', '22200000-0000-4000-8000-000000000007');
insert into private.audit_events(event_type, target_id)
values ('affiliation_submit', '22200000-0000-4000-8000-000000000008');

insert into storage.objects(id, bucket_id, name, created_at, updated_at, owner, owner_id)
select ('22000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'affiliation-evidence',
  '22100000-0000-4000-8000-00000000000' || member_suffix ||
    '/22200000-0000-4000-8000-' || lpad(i::text, 12, '0') || '/evidence',
  '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z',
  case when i = 5 then '22100000-0000-4000-8000-000000000001'::uuid end,
  case when i = 6 then '22100000-0000-4000-8000-000000000001' end
from (values (2, 2), (3, 1), (4, 2), (5, 1), (6, 1), (7, 1), (8, 1)) as fixtures(i, member_suffix);

do $$
declare
  actual text[];
begin
  select array_agg(disposition order by object_id) into actual
  from private.preview_affiliation_uploads('2020-02-01T00:00:00Z')
  where object_id between '22000000-0000-4000-8000-000000000001' and '22000000-0000-4000-8000-000000000008';
  if actual is distinct from array['unlinked', 'linked_request', 'linked_request', 'linked_member',
    'storage_owned', 'storage_owned', 'request_history', 'request_history'] then
    raise exception 'Unexpected preview dispositions: %', actual;
  end if;
end;
$$;

insert into storage.buckets(id, name, public)
values ('btp20-preview-other-bucket', 'btp20-preview-other-bucket', false);
insert into storage.objects(id, bucket_id, name, created_at, updated_at)
select ('22000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, bucket_id,
  '22100000-0000-4000-8000-000000000001/22200000-0000-4000-8000-' || lpad(i::text, 12, '0') || suffix,
  '2020-01-01T00:00:00Z', updated_at::timestamptz
from (values
  (9, 'affiliation-evidence', '/evidence', '2020-02-01T00:00:00Z'),
  (10, 'affiliation-evidence', '/evidence', null),
  (11, 'affiliation-evidence', '/evidence.png', '2020-01-02T00:00:00Z'),
  (12, 'btp20-preview-other-bucket', '/evidence', '2020-01-02T00:00:00Z')
) as fixtures(i, bucket_id, suffix, updated_at);

do $$
declare
  app_role text;
begin
  if exists (
    select 1 from private.preview_affiliation_uploads('2020-02-01T00:00:00Z')
    where object_id between '22000000-0000-4000-8000-000000000009' and '22000000-0000-4000-8000-000000000012'
  ) then
    raise exception 'Preview included an out-of-scope object';
  end if;
  if exists (select 1 from private.preview_affiliation_uploads(null))
    or exists (select 1 from private.preview_affiliation_uploads('infinity'))
    or exists (select 1 from private.preview_affiliation_uploads(now() + interval '1 day')) then
    raise exception 'Preview accepted a missing, nonfinite or future cutoff';
  end if;
  foreach app_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(app_role, 'private.preview_affiliation_uploads(timestamptz)', 'execute') then
      raise exception 'Preview is callable by %', app_role;
    end if;
  end loop;
  if (select count(*) from storage.objects
      where id between '22000000-0000-4000-8000-000000000001' and '22000000-0000-4000-8000-000000000012') <> 12 then
    raise exception 'Preview altered the storage inventory';
  end if;
end;
$$;

rollback;
