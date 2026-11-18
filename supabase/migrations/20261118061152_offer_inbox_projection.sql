create function private.browse_offers(p_listing_id uuid,p_before timestamptz,p_before_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_member() then raise exception 'PERMISSION: Confirmed active account required'; end if;
  if (p_before is null) <> (p_before_id is null) then raise exception 'VALIDATION: Incomplete cursor'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb) from (
    select o.created_at,o.id,jsonb_build_object('id',o.id,'listing_id',o.listing_id,'listing_title',l.title,
      'version',o.version,'listing_version',o.listing_version,'fee',o.fee,'status',o.status,'created_at',o.created_at,'own',o.author_id=auth.uid()) row_data
    from public.offers o join public.listings l on l.id=o.listing_id
    where ((p_listing_id is null and o.author_id=auth.uid())
      or (p_listing_id=o.listing_id and (o.author_id=auth.uid() or o.owner_id=auth.uid())))
      and ((p_before is null and p_before_id is null) or (o.created_at,o.id)<(p_before,p_before_id))
    order by o.created_at desc,o.id desc limit 21
  ) rows);
end;
$$;
revoke all on function private.browse_offers(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.browse_offers(uuid,timestamptz,uuid) to authenticated;
create function public.browse_offers(p_listing_id uuid default null,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.browse_offers(p_listing_id,p_before,p_before_id); $$;
revoke all on function public.browse_offers(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.browse_offers(uuid,timestamptz,uuid) to authenticated;
