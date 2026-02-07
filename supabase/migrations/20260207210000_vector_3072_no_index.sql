-- Switch all vector embeddings to 3072 dimensions to match n8n gemini-embedding-001 default output.
-- Note: No index created (HNSW max 2000 dims, IVFFlat max 2000 dims). Sequential scan is fine for small datasets.
-- Existing embeddings are dropped; re-embed agent rules and re-upload documents after applying.

-- widget_documents
alter table public.widget_documents drop column if exists embedding;
alter table public.widget_documents add column embedding vector(3072);
drop index if exists idx_widget_documents_embedding_cosine;

-- agent_documents
alter table public.agent_documents drop column if exists embedding;
alter table public.agent_documents add column embedding vector(3072);
drop index if exists idx_agent_documents_embedding_cosine;

-- agent_rules
alter table public.agent_rules drop column if exists embedding;
alter table public.agent_rules add column embedding vector(3072);
drop index if exists idx_agent_rules_embedding_cosine;

-- match_documents (n8n Supabase Vector Store) - accepts 3072-dim embeddings from n8n
create or replace function public.match_documents(
  filter jsonb,
  match_count int,
  query_embedding vector(3072)
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select w.id, w.content, w.metadata, (1 - (w.embedding <=> query_embedding)::float) as similarity
  from public.widget_documents w
  where w.embedding is not null
    and (filter is null or filter = '{}'::jsonb or w.metadata @> filter)
  order by w.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 20));
end;
$$;

-- match_agent_rules_documents (n8n) - accepts 3072-dim embeddings from n8n
create or replace function public.match_agent_rules_documents(
  filter jsonb,
  match_count int,
  query_embedding vector(3072)
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql security definer set search_path = public
as $$
declare p_agent_id uuid;
begin
  p_agent_id := (filter->>'agent_id')::uuid;
  if p_agent_id is null then return; end if;
  return query
  select r.id, r.content, jsonb_build_object('tags', r.tags, 'agent_id', r.agent_id),
         (1 - (r.embedding <=> query_embedding)::float)
  from public.agent_rules r
  where r.agent_id = p_agent_id and r.enabled and r.embedding is not null
  order by r.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 20));
end;
$$;

-- match_agent_rules (direct LLM / app RAG) - accepts 3072-dim embeddings
create or replace function public.match_agent_rules(
  p_agent_id uuid,
  p_query_embedding vector(3072),
  p_match_count int default 5
)
returns table (id uuid, content text, tags text[], similarity float)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select r.id, r.content, r.tags, 1 - (r.embedding <=> p_query_embedding)::float as similarity
  from public.agent_rules r
  where r.agent_id = p_agent_id and r.enabled and r.embedding is not null
  order by r.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
end;
$$;

comment on function public.match_documents(jsonb, int, vector) is 'Vector similarity search on widget_documents (3072 dims - matches n8n gemini-embedding-001 default, no index due to pgvector 2000-dim limit)';
comment on function public.match_agent_rules_documents(jsonb, int, vector) is 'Vector similarity search on agent_rules (3072 dims - matches n8n gemini-embedding-001 default, no index due to pgvector 2000-dim limit)';
