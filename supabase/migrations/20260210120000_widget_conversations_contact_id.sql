-- Allow multiple conversations to point to one contact (for merged contacts).
-- Backfill: set contact_id from the contact that currently has this conversation_id.
alter table public.widget_conversations
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_widget_conversations_contact_id
  on public.widget_conversations(contact_id) where contact_id is not null;

comment on column public.widget_conversations.contact_id is 'Contact this conversation belongs to. Used when contacts are merged: multiple conversations can point to one contact.';

-- Backfill: each conversation is currently linked from contacts.conversation_id
update public.widget_conversations w
set contact_id = c.id
from public.contacts c
where c.conversation_id = w.id
  and w.contact_id is null;
