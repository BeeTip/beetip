begin;

alter table private.purchase_receipt_evidence add column booth_listing_id uuid;

update private.purchase_receipt_evidence e set booth_listing_id=r.listing_id
  from private.purchase_receipts r join public.orders o on o.id=r.anchor_order_id
  where e.receipt_id=r.id and o.booth_demo;

alter table private.purchase_receipt_evidence
  drop constraint purchase_receipt_evidence_provider_id_image_hash_key;
create unique index purchase_receipt_evidence_regular_image
  on private.purchase_receipt_evidence(provider_id,image_hash) where booth_listing_id is null;
create unique index purchase_receipt_evidence_booth_image
  on private.purchase_receipt_evidence(provider_id,booth_listing_id,image_hash) where booth_listing_id is not null;

create function private.scope_booth_receipt_evidence() returns trigger
language plpgsql set search_path='' as $$
begin
  select r.listing_id into new.booth_listing_id
    from private.purchase_receipts r join public.orders o on o.id=r.anchor_order_id
    where r.id=new.receipt_id and o.booth_demo;
  return new;
end;
$$;
revoke all on function private.scope_booth_receipt_evidence() from public,anon,authenticated;
create trigger purchase_receipt_evidence_booth_scope before insert on private.purchase_receipt_evidence
  for each row execute function private.scope_booth_receipt_evidence();

commit;
