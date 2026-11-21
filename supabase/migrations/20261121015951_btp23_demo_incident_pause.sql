begin;

create table private.demo_incident_pause (
  active boolean primary key default true check (active)
);
alter table private.demo_incident_pause enable row level security;
revoke all on private.demo_incident_pause from public,anon,authenticated,service_role;

create function private.block_paused_demo_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  lock table private.demo_incident_pause in share mode;
  if exists (select 1 from private.demo_incident_pause) then
    raise sqlstate 'PT503' using message = 'Connected demo writes paused';
  end if;
  return new;
end;
$$;
revoke all on function private.block_paused_demo_write() from public,anon,authenticated,service_role;

create trigger orders_block_paused_demo_acceptance before insert on public.orders
  for each row execute function private.block_paused_demo_write();

create trigger booth_payments_block_paused_checkout before update of confirmed_at on private.booth_payments
  for each row when (old.confirmed_at is null and new.confirmed_at is not null)
  execute function private.block_paused_demo_write();

commit;
