-- When a PDF is uploaded to roof_quotes bucket, automatically append its URL to the matching contact.
-- Match by: 1) metadata.conversation_id + metadata.widget_id, or 2) metadata.email, or 3) path as {conversationId}/filename.pdf
-- n8n: Use path format roof_quotes/{conversationId}/quote.pdf so the trigger can extract conversationId.

create or replace function public.on_roof_quotes_object_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pdf_url text;
  v_conversation_id uuid;
  v_widget_id uuid;
  v_email text;
  v_metadata jsonb;
  v_name text;
  v_base_url text := 'https://ghbytxmsklcizlcnxwfq.supabase.co/storage/v1/object/public';
begin
  if new.bucket_id != 'roof_quotes' then
    return new;
  end if;

  v_name := new.name;
  v_metadata := coalesce(new.metadata, '{}'::jsonb);
  v_pdf_url := v_base_url || '/roof_quotes/' || v_name;

  -- Try metadata first: conversation_id + widget_id
  begin
    v_conversation_id := (v_metadata->>'conversation_id')::uuid;
    v_widget_id := (v_metadata->>'widget_id')::uuid;
  exception when others then
    v_conversation_id := null;
    v_widget_id := null;
  end;

  if v_conversation_id is not null and v_widget_id is not null then
    perform append_pdf_quote_to_contact(v_conversation_id, v_widget_id, v_pdf_url);
    return new;
  end if;

  -- Try metadata: email (find contact by email in any widget)
  v_email := nullif(trim(v_metadata->>'email'), '');
  if v_email is not null then
    update public.contacts
    set pdf_quotes = pdf_quotes || jsonb_build_array(jsonb_build_object('url', v_pdf_url, 'created_at', now()))
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
      perform append_pdf_quote_to_contact(v_conversation_id, v_widget_id, v_pdf_url);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_roof_quotes_object_created on storage.objects;
create trigger on_roof_quotes_object_created
  after insert on storage.objects
  for each row
  execute function public.on_roof_quotes_object_created();
