create table private.affiliation_upload_claims (
  request_id uuid primary key references public.affiliation_requests(id) on delete cascade,
  image_sha256 text not null check (image_sha256 collate "C" ~ '^[0-9a-f]{64}$')
);

alter table private.affiliation_upload_claims enable row level security;
revoke all on private.affiliation_upload_claims from public, anon, authenticated;

create function public.claim_affiliation_upload(p_request uuid, p_member uuid, p_digest text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_digest text;
begin
  if p_digest is null or p_digest collate "C" !~ '^[0-9a-f]{64}$' then
    return 'denied';
  end if;

  perform 1 from public.affiliation_requests a join public.members m on m.id = a.member_id
  where a.id = p_request and a.member_id = p_member and a.status = 'draft' and m.status <> 'suspended'
  for update of a;
  if not found then return 'denied'; end if;

  select image_sha256 into v_digest from private.affiliation_upload_claims where request_id = p_request;
  if v_digest is not null and v_digest <> p_digest then return 'conflict'; end if;

  if exists (select 1 from storage.objects where bucket_id = 'affiliation-evidence'
    and name = p_member::text || '/' || p_request::text || '/evidence') then
    return 'existing';
  end if;

  if v_digest is not null then return 'retry'; end if;

  insert into private.affiliation_upload_claims (request_id, image_sha256) values (p_request, p_digest);
  return 'first';
end;
$$;

revoke all on function public.claim_affiliation_upload(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_affiliation_upload(uuid, uuid, text) to service_role;
