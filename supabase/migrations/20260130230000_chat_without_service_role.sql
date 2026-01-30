-- Allow anonymous chat operations (embed widget) without service role.
-- Chat API uses anon client + these policies instead of getSupabaseAdmin().

-- widget_conversations: anon can insert (new session) and select (load by session_id)
create policy "Anonymous can insert widget_conversations for existing widgets"
  on public.widget_conversations for insert
  with check (exists (select 1 from public.widgets where id = widget_id));

create policy "Anonymous can select widget_conversations"
  on public.widget_conversations for select using (true);

-- widget_conversation_messages: anon can insert (user/assistant messages) and select (history)
create policy "Anonymous can insert widget_conversation_messages for existing conversations"
  on public.widget_conversation_messages for insert
  with check (exists (select 1 from public.widget_conversations where id = conversation_id));

create policy "Anonymous can select widget_conversation_messages"
  on public.widget_conversation_messages for select using (true);

-- SECURITY DEFINER: fetch owner's LLM API key for chat. Called via RPC from server.
-- Does not expose keys to client; only our server (anon) invokes this.
create or replace function public.get_owner_llm_key_for_chat(p_widget_id uuid, p_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_key text;
begin
  select created_by into v_owner_id from public.widgets where id = p_widget_id;
  if v_owner_id is null then
    return null;
  end if;
  select api_key into v_key from public.user_llm_keys where user_id = v_owner_id and provider = p_provider;
  return v_key;
end;
$$;
