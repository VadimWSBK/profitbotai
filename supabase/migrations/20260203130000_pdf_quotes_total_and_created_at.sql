-- Add optional total to pdf_quotes entries. append_pdf_quote_to_contact gets p_total (text); stored in jsonb.
-- Keeps created_at; when p_total is provided, store it for display in contact overview.
create or replace function public.append_pdf_quote_to_contact(
  p_conversation_id uuid,
  p_widget_id uuid,
  p_pdf_url text,
  p_total text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_exists boolean;
  v_obj jsonb;
begin
  v_obj := jsonb_build_object('url', p_pdf_url, 'created_at', now());
  if p_total is not null and p_total != '' then
    v_obj := v_obj || jsonb_build_object('total', p_total);
  end if;

  -- Create contact if conversation exists but contact doesn't
  insert into public.contacts (conversation_id, widget_id, pdf_quotes)
  select p_conversation_id, p_widget_id, jsonb_build_array(v_obj)
  where exists (select 1 from public.widget_conversations c where c.id = p_conversation_id and c.widget_id = p_widget_id)
    and not exists (select 1 from public.contacts where conversation_id = p_conversation_id);

  -- Append only if this path/url not already in pdf_quotes (avoids duplicates from trigger + explicit call)
  select exists (
    select 1 from public.contacts c, jsonb_array_elements(c.pdf_quotes) elem
    where c.conversation_id = p_conversation_id and c.widget_id = p_widget_id
      and elem->>'url' = p_pdf_url
  ) into v_already_exists;

  if not v_already_exists then
    update public.contacts
    set pdf_quotes = pdf_quotes || jsonb_build_array(v_obj)
    where conversation_id = p_conversation_id and widget_id = p_widget_id;
  end if;
end;
$$;
