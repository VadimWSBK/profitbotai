-- Allow anon (chat API) to call SECURITY DEFINER functions. Chat endpoint uses anon client.
grant execute on function public.get_owner_llm_key_for_chat(uuid, text) to anon;
grant execute on function public.switch_conversation_back_to_ai(uuid) to anon;
