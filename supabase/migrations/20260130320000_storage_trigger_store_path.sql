-- Update roof_quotes storage trigger to store path instead of public URL.
-- Bucket is private; paths are resolved to signed URLs when needed.
create or replace function public.on_roof_quotes_object_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_widget_id uuid;
  v_email text;
  v_metadata jsonb;
  v_name text;
  v_path text;  -- Store path for private bucket; signed URLs created on demand
begin
  if new.bucket_id != 'roof_quotes' then
    return new;
  end if;

  v_name := new.name;
  v_metadata := coalesce(new.metadata, '{}'::jsonb);
  v_path := v_name;  -- Path within bucket (e.g. conv-id/quote_xxx.pdf)

  -- Try metadata first: conversation_id + widget_id
  begin
    v_conversation_id := (v_metadata->>'conversation_id')::uuid;
    v_widget_id := (v_metadata->>'widget_id')::uuid;
  exception when others then
    v_conversation_id := null;
    v_widget_id := null;
  end;

  if v_conversation_id is not null and v_widget_id is not null then
    perform append_pdf_quote_to_contact(v_conversation_id, v_widget_id, v_path);
    return new;
  end if;

  -- Try metadata: email (find contact by email in any widget)
  v_email := nullif(trim(v_metadata->>'email'), '');
  if v_email is not null then
    update public.contacts
    set pdf_quotes = pdf_quotes || jsonb_build_array(jsonb_build_object('url', v_path, 'created_at', now()))
    where email = v_email;
    return new;
  end if;

  -- Fallback: path as {conversationId}/filename.pdf
  begin
    v_conversation_id := (split_part(v_name, '/', 1))::uuid;
  exception when others then
    return new;
  end;

  if v_conversation_id is not null then
    select widget_id into v_widget_id
    from public.widget_conversations
    where id = v_conversation_id
    limit 1;
    if v_widget_id is not null then
      perform append_pdf_quote_to_contact(v_conversation_id, v_widget_id, v_path);
    end if;
  end if;

  return new;
end;
$$;
