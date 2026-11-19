begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists(select 1 from vault.decrypted_secrets
    where name='beetip_email_worker_origin' and decrypted_secret ~ '^https://[a-zA-Z0-9.-]+$')
    or not exists(select 1 from vault.decrypted_secrets
    where name='beetip_email_worker_token' and length(decrypted_secret)>=32) then
    raise exception 'Configure the BeeTip worker origin and token in Vault before scheduling';
  end if;
end;
$$;

update private.email_worker_health
set monitoring_since=clock_timestamp(),last_success_at=null where singleton;

select cron.schedule('beetip-email-worker','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='beetip_email_worker_origin')
      || '/api/jobs/transactional-email',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='beetip_email_worker_token')
    ),
    timeout_milliseconds := 28000
  );
$job$);

select cron.schedule('beetip-email-watchdog','* * * * *',$job$
  do $watch$
  begin
    if (private.btp11_alerts()->>'missedScheduler')::boolean then
      raise exception 'BeeTip email worker heartbeat overdue';
    end if;
  end;
  $watch$;
$job$);

commit;
