alter table public.members alter column status set default 'approved';

with activated as (
  update public.members set status = 'approved' where status = 'pending' returning id
)
insert into private.audit_events(event_type, target_id, detail)
select 'account_access_enabled', id, '{"reason":"Maker approved public self-service onboarding; email confirmation remains required"}'::jsonb
from activated;
