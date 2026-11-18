-- Operational rollback preserves terminal orders, funding protection and audit facts.
begin;
select pg_advisory_xact_lock(707,9);
do $$
begin
  if to_regclass('cron.job') is not null then
    if exists(select 1 from cron.job where jobname='btp07-reservation-expiry') then
      perform cron.unschedule('btp07-reservation-expiry');
    end if;
  end if;
end;
$$;
commit;
