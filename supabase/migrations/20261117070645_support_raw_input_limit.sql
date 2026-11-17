create or replace function private.open_support(p_operation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_receipt private.operation_receipts%rowtype;
  v_conversation_id uuid;
begin
  if not private.is_active_member() then
    raise exception using errcode = 'P0001', message = 'PERMISSION: Sign in with an active confirmed account.';
  end if;
  if p_operation_id is null or p_body is null or char_length(p_body) > 1000 or char_length(btrim(p_body)) < 1 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: A valid operation ID and 1 to 1000 character message are required.';
  end if;

  v_payload_hash := encode(sha256(convert_to(jsonb_build_object('command', 'open_support', 'body', p_body)::text, 'UTF8')), 'hex');
  insert into private.operation_receipts (actor_id, operation_id, command, payload_hash)
  values (v_actor, p_operation_id, 'open_support', v_payload_hash)
  on conflict (actor_id, operation_id) do nothing;

  select * into strict v_receipt from private.operation_receipts
  where actor_id = v_actor and operation_id = p_operation_id for update;

  if v_receipt.command <> 'open_support' or v_receipt.payload_hash <> v_payload_hash then
    raise exception using errcode = 'P0001', message = 'CONFLICT: This operation ID was used with another request.';
  end if;
  if v_receipt.result_id is not null then
    return v_receipt.result_id;
  end if;

  insert into public.conversations (requester_id) values (v_actor) returning id into v_conversation_id;
  insert into public.conversation_members (conversation_id, member_id, role) values (v_conversation_id, v_actor, 'requester');
  insert into public.messages (conversation_id, sequence, sender_id, body) values (v_conversation_id, 1, v_actor, btrim(p_body));
  insert into private.audit_events (actor_id, operation_id, event_type, target_id)
  values (v_actor, p_operation_id, 'support_opened', v_conversation_id);
  update private.operation_receipts set result_id = v_conversation_id where actor_id = v_actor and operation_id = p_operation_id;
  return v_conversation_id;
end;
$$;
