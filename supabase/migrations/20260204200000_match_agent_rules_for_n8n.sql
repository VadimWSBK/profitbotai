-- RPC for n8n Supabase Vector Store: query agent_rules with same signature as match_documents.
-- n8n calls: match_agent_rules_documents(filter, match_count, query_embedding)
-- filter must contain agent_id (uuid) to restrict to one agent.

create or replace function public.match_agent_rules_documents(
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
declare
  p_agent_id uuid;
begin
  p_agent_id := (filter->>'agent_id')::uuid;
  if p_agent_id is null then
    return;
  end if;
  return query
  select
    r.id,
    r.content,
    jsonb_build_object('tags', r.tags, 'agent_id', r.agent_id) as metadata,
    (1 - (r.embedding <=> query_embedding)::float) as similarity
  from public.agent_rules r
  where r.agent_id = p_agent_id
    and r.enabled
    and r.embedding is not null
  order by r.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 20));
end;
$$;

comment on function public.match_agent_rules_documents(jsonb, int, vector) is 'Vector similarity search on agent_rules for n8n; set filter to {"agent_id": "uuid"} in Metadata Filter';
