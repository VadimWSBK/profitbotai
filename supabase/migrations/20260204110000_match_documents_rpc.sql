-- match_documents RPC for n8n Supabase Vector Store (and LangChain)
-- n8n/LangChain call: match_documents(filter, match_count, query_embedding)
-- Searches public.widget_documents by cosine similarity; optional metadata filter via jsonb @>

create or replace function public.match_documents(
  filter jsonb,
  match_count int,
  query_embedding vector(1536)
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    w.id,
    w.content,
    w.metadata,
    (1 - (w.embedding <=> query_embedding)::float) as similarity
  from public.widget_documents w
  where w.embedding is not null
    and (filter is null or filter = '{}'::jsonb or w.metadata @> filter)
  order by w.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 20));
end;
$$;

comment on function public.match_documents(jsonb, int, vector) is 'Vector similarity search on widget_documents for n8n Supabase Vector Store; filter by metadata (e.g. widget_id)';
