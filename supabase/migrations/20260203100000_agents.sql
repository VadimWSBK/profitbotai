-- Agents: topic-specific agents for workflows and widgets (trained on specific topics)
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Agent',
  description text default '',
  system_prompt text default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agents is 'Agents trained on specific topics; usable in workflows (actions) and widgets instead of per-widget training';

create index if not exists idx_agents_created_by on public.agents(created_by);
create index if not exists idx_agents_updated_at on public.agents(updated_at desc);

drop trigger if exists set_agents_updated_at on public.agents;
create trigger set_agents_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

alter table public.agents enable row level security;

-- Admins: full CRUD on agents
create policy "Admins can manage agents" on public.agents
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Knowledge base per agent: chunked content + embeddings for RAG (same as widget_documents)
create table if not exists public.agent_documents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.agent_documents is 'Chunked documents and embeddings for agent RAG; used when agent is selected in workflows or widgets';

create index if not exists idx_agent_documents_agent_id on public.agent_documents(agent_id);
create index if not exists idx_agent_documents_created_at on public.agent_documents(created_at desc);

create index if not exists idx_agent_documents_embedding_cosine
  on public.agent_documents
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.agent_documents enable row level security;

-- Access follows agent: admins can manage
create policy "Admins can manage agent_documents" on public.agent_documents
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  );
