-- RPC: upsert contact by email. Creates if new, updates if exists. Call from n8n webhook.
create or replace function public.upsert_contact_by_email(
  p_email text,
  p_name text default null,
  p_phone text default null,
  p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  p_email := nullif(trim(lower(p_email)), '');
  if p_email is null then
    return jsonb_build_object('success', false, 'error', 'email required');
  end if;

  update public.contacts
  set
    name = coalesce(p_name, name),
    phone = coalesce(p_phone, phone),
    address = coalesce(p_address, address),
    updated_at = now()
  where email = p_email
  returning id into v_id;

  if found then
    return jsonb_build_object('success', true, 'action', 'updated', 'id', v_id);
  end if;

  insert into public.contacts (email, name, phone, address)
  values (p_email, p_name, p_phone, p_address)
  returning id into v_id;

  return jsonb_build_object('success', true, 'action', 'created', 'id', v_id);
end;
$$;

grant execute on function public.upsert_contact_by_email(text, text, text, text) to anon;
