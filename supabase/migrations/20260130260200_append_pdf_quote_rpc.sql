-- RPC: append a PDF quote URL to a contact. Used by n8n after uploading quote to bucket.
-- Creates the contact if it doesn't exist yet (e.g. first message was a quote request).
create or replace function public.append_pdf_quote_to_contact(
  p_conversation_id uuid,
  p_widget_id uuid,
  p_pdf_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Create contact if conversation exists but contact doesn't
  insert into public.contacts (conversation_id, widget_id, pdf_quotes)
  select p_conversation_id, p_widget_id, jsonb_build_array(jsonb_build_object('url', p_pdf_url, 'created_at', now()))
  where exists (select 1 from public.widget_conversations c where c.id = p_conversation_id and c.widget_id = p_widget_id)
    and not exists (select 1 from public.contacts where conversation_id = p_conversation_id);

  -- Append to existing contact's pdf_quotes
  update public.contacts
  set pdf_quotes = pdf_quotes || jsonb_build_array(jsonb_build_object('url', p_pdf_url, 'created_at', now()))
  where conversation_id = p_conversation_id and widget_id = p_widget_id;
end;
$$;

grant execute on function public.append_pdf_quote_to_contact(uuid, uuid, text) to anon;
