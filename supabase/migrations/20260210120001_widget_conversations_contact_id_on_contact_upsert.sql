-- When a contact is created or updated with conversation_id, set that conversation's contact_id
-- so the conversation list and merge logic stay in sync.
create or replace function public.sync_widget_conversation_contact_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is not null then
    update public.widget_conversations
    set contact_id = new.id
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_widget_conversation_contact_id_on_contact on public.contacts;
create trigger sync_widget_conversation_contact_id_on_contact
  after insert or update of conversation_id on public.contacts
  for each row
  execute function public.sync_widget_conversation_contact_id();
