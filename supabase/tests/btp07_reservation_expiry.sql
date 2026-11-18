begin;
create function pg_temp.btp07_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'FAILED: %',p_label; end if; end;
$$;
select pg_temp.btp07_assert(not has_function_privilege(role,signature,'execute'),'expiry/funding owner-only: '||signature)
from unnest(array['anon','authenticated']) role cross join unnest(array[
  'private.btp07_lock_payable_order(uuid)','private.btp07_preserve_verified_funding(uuid)',
  'private.btp07_expire_reservations(integer)','private.btp07_run_expiry()',
  'private.btp07_order_state(text,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
]) signature;
select pg_temp.btp07_assert(not has_table_privilege(role,relation,'select,insert,update,delete'),'private job facts: '||relation)
from unnest(array['anon','authenticated']) role cross join unnest(array['private.btp07_expiry_runs','private.btp07_expiry_heartbeat']) relation;
select pg_temp.btp07_assert((select count(*)=2 from pg_class where oid in ('private.btp07_expiry_runs'::regclass,'private.btp07_expiry_heartbeat'::regclass) and relrowsecurity),'private job RLS');
select pg_temp.btp07_assert(private.btp07_order_state('awaiting_payment',clock_timestamp()-interval '1 second',null,null)='expired','delayed job projection');
select pg_temp.btp07_assert(private.btp07_order_state('awaiting_payment',clock_timestamp()-interval '1 second',null,clock_timestamp()-interval '2 seconds')='funding_verified','funded projection');
select pg_temp.btp07_assert(private.btp07_order_state('cancelled',clock_timestamp()-interval '1 second',null,null)='cancelled','cancelled projection');
do $$
declare v_limit integer;
begin
  foreach v_limit in array array[null,0,501]::integer[] loop
    begin
      perform private.btp07_expire_reservations(v_limit);
      raise exception 'FAILED: invalid batch accepted';
    exception when others then
      if sqlerrm not like 'VALIDATION:%' then raise; end if;
    end;
  end loop;
end;
$$;
rollback;
