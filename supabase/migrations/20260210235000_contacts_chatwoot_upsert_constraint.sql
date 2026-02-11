-- ON CONFLICT requires a unique constraint, not a partial unique index.
-- Drop the partial index and add a proper unique constraint so upsert works.
drop index if exists public.idx_contacts_chatwoot_conversation;

alter table public.contacts
  add constraint contacts_chatwoot_account_conversation_unique
  unique (chatwoot_account_id, chatwoot_conversation_id);
