-- Allow chat API (anon) to switch a conversation back to AI after live-agent timeout.
-- SECURITY DEFINER so anon can call it; only updates is_ai_active to true.
create or replace function public.switch_conversation_back_to_ai(p_conv_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.widget_conversations
  set is_ai_active = true, updated_at = now()
  where id = p_conv_id;
end;
$$;
