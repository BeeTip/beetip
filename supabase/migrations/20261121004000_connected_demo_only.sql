begin;

lock table public.orders in exclusive mode;
lock table private.funding_submissions in share row exclusive mode;

create or replace function private.mark_booth_order() returns trigger
language plpgsql set search_path='' as $$
begin
  new.booth_demo := true;
  return new;
end;
$$;

with converted as (
  update public.orders o set booth_demo=true
  from public.reservations r
  where not o.booth_demo and o.state='awaiting_payment'
    and r.order_id=o.id and r.released_at is null
    and r.expires_at>clock_timestamp() and r.funding_verified_at is null
    and not exists (select 1 from private.funding_submissions f where f.order_id=o.id)
  returning o.id
)
insert into private.booth_payments(order_id) select id from converted;

drop function public.funding_command(uuid,text,uuid,uuid,text,bigint,text),
  public.funding_view(uuid),public.funding_queue(uuid,timestamptz,uuid),public.funding_evidence(uuid,boolean),
  public.manual_transfer_command(uuid,uuid,text,jsonb),public.manual_transfer_operation(uuid),
  public.read_manual_transfers(uuid,uuid),public.manual_transfer_queue(uuid),
  public.read_reconciliation(text,uuid),public.export_reconciliation(text,uuid);

drop function private.funding_command(uuid,text,uuid,uuid,text,bigint,text),
  private.funding_view(uuid),private.funding_queue(uuid,timestamptz,uuid),private.funding_evidence(uuid,boolean),
  private.manual_transfer_command(uuid,uuid,text,jsonb),private.manual_transfer_operation(uuid),
  private.read_manual_transfers(uuid,uuid),private.manual_transfer_queue(uuid),
  private.export_reconciliation(text,uuid),private.read_reconciliation(text,uuid);

commit;
