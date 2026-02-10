-- Link internal contacts to Chatwoot conversations so we can upsert from webhook and show the LLM what we have.
alter table public.contacts
  add column if not exists chatwoot_account_id bigint,
  add column if not exists chatwoot_conversation_id bigint,
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

comment on column public.contacts.chatwoot_account_id is 'Chatwoot account id when this contact was created/updated from a Chatwoot conversation.';
comment on column public.contacts.chatwoot_conversation_id is 'Chatwoot conversation id; one contact per (chatwoot_account_id, chatwoot_conversation_id).';
comment on column public.contacts.agent_id is 'Profitbot agent id for Chatwoot-originated contacts; used for RLS and filtering.';

create unique index if not exists idx_contacts_chatwoot_conversation
  on public.contacts(chatwoot_account_id, chatwoot_conversation_id)
  where chatwoot_account_id is not null and chatwoot_conversation_id is not null;
