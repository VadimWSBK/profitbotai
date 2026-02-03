-- Agent rules: tagged rules with vector embeddings for RAG retrieval
create table if not exists public.agent_rules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  content text not null,
  tags text[] not null default '{}',
  embedding vector(1536),
  priority int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agent_rules is 'Tagged rules per agent; embedded for RAG retrieval. Only relevant rules are injected at chat time.';

create index if not exists idx_agent_rules_agent_id on public.agent_rules(agent_id);
create index if not exists idx_agent_rules_enabled on public.agent_rules(agent_id, enabled) where enabled = true;

create index if not exists idx_agent_rules_embedding_cosine
  on public.agent_rules
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

drop trigger if exists set_agent_rules_updated_at on public.agent_rules;
create trigger set_agent_rules_updated_at
  before update on public.agent_rules
  for each row execute function public.set_updated_at();

alter table public.agent_rules enable row level security;

create policy "Admins can manage agent_rules" on public.agent_rules
  for all using (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  );

-- RPC for similarity search: returns top match_count rules by cosine similarity
create or replace function public.match_agent_rules(
  p_agent_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (id uuid, content text, tags text[], similarity float)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    r.id,
    r.content,
    r.tags,
    1 - (r.embedding <=> p_query_embedding)::float as similarity
  from public.agent_rules r
  where r.agent_id = p_agent_id
    and r.enabled
    and r.embedding is not null
  order by r.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
end;
$$;
