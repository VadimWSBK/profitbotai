-- Chatwoot conversation messages: we store each incoming message and our reply here
-- so we can load context for the LLM from our DB instead of calling Chatwoot's API every time.
-- Identified by (account_id, conversation_id) from Chatwoot.
create table if not exists public.chatwoot_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  conversation_id bigint not null,
  agent_id uuid references public.agents(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_chatwoot_conversation_messages_lookup
  on public.chatwoot_conversation_messages(account_id, conversation_id, created_at);

-- RLS: only backend (service_role) should access; no policies for anon/auth
alter table public.chatwoot_conversation_messages enable row level security;

comment on table public.chatwoot_conversation_messages is 'Messages from Chatwoot conversations; used for LLM context without calling Chatwoot API.';
