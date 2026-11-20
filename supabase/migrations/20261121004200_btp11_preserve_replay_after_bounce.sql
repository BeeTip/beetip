create or replace function private.btp11_webhook(p_dispatch uuid,p_address_hash text,p_provider_id text,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_dispatch private.email_dispatches%rowtype;
  v_delivery private.email_deliveries%rowtype;
begin
  if p_event is null or p_event not in ('accepted','delivered','hard_bounce','soft_bounce','blocked','invalid','spam','unsubscribed')
    or p_provider_id is null or p_provider_id !~ '^[!-~]{1,240}$' then raise exception 'Invalid webhook'; end if;
  select d.* into v_delivery from private.email_deliveries d
    join private.email_dispatches s on s.delivery_id=d.id
    where s.id=p_dispatch and s.address_hash=p_address_hash for update of d;
  if not found then return; end if;
  select * into v_dispatch from private.email_dispatches where id=p_dispatch;
  if v_dispatch.provider_id is not null and v_dispatch.provider_id<>p_provider_id then return; end if;
  insert into private.email_webhook_receipts values(p_dispatch,p_provider_id,p_event) on conflict do nothing;
  if not found then return; end if;
  update private.email_dispatches set provider_id=p_provider_id where id=p_dispatch;
  if p_event in ('hard_bounce','blocked','invalid','spam','unsubscribed') then
    insert into private.email_suppressions(address_hash,reason) values(p_address_hash,p_event) on conflict do nothing;
  end if;
  if v_delivery.dispatch_id<>p_dispatch and exists(
    select 1 from private.email_dispatches where id=v_delivery.dispatch_id
  ) then return; end if;
  if v_delivery.dispatch_id<>p_dispatch and p_event not in ('accepted','delivered') and exists(
    select 1 from auth.users where id=v_delivery.recipient_id
      and encode(sha256(convert_to(lower(btrim(email)),'UTF8')),'hex')<>p_address_hash
  ) then return; end if;
  if p_event='accepted' then
    if exists(select 1 from private.email_webhook_receipts where dispatch_id=p_dispatch
      and event_type in ('hard_bounce','soft_bounce','blocked','invalid','spam','unsubscribed')) then return; end if;
    if v_delivery.status in ('queued','leased','sending','retry','uncertain')
      or (v_delivery.status='suppressed' and v_delivery.last_error is distinct from 'operator_closed')
      or (v_delivery.status='dead_letter' and v_delivery.last_error in ('rejected','rate_limited')) then
      update private.email_deliveries set status='accepted',last_error=null,dispatch_id=p_dispatch,
        lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
    end if;
  elsif p_event='delivered' and not exists(select 1 from private.email_webhook_receipts
      where dispatch_id=p_dispatch and event_type in ('hard_bounce','blocked','invalid','spam','unsubscribed')) then
    update private.email_deliveries set status='delivered',last_error=null,dispatch_id=p_dispatch,
      lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
  elsif p_event<>'delivered' and (p_event<>'soft_bounce' or (v_delivery.status<>'delivered' and not exists(
    select 1 from private.email_webhook_receipts where dispatch_id=p_dispatch
      and event_type in ('hard_bounce','blocked','invalid','spam','unsubscribed')
  ))) then
    update private.email_deliveries set status='dead_letter',last_error=p_event,dispatch_id=p_dispatch,
      lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=v_delivery.id;
  end if;
end; $$;
