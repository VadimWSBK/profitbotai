-- Store LLM API keys per user (used when widget uses "Direct LLM" instead of n8n)
create table if not exists public.user_llm_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

comment on table public.user_llm_keys is 'API keys for OpenAI, Anthropic, Google etc.; used by Direct LLM chat backend';

create index if not exists idx_user_llm_keys_user_id on public.user_llm_keys(user_id);

drop trigger if exists set_user_llm_keys_updated_at on public.user_llm_keys;
create trigger set_user_llm_keys_updated_at
  before update on public.user_llm_keys
  for each row execute function public.set_updated_at();

alter table public.user_llm_keys enable row level security;

create policy "Users can manage own llm keys" on public.user_llm_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
