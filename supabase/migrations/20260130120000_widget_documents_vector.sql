-- Enable pgvector for embeddings (used by Train Bot and n8n Supabase Vector Store)
create extension if not exists vector with schema public;

-- Knowledge base per widget: chunked content + embeddings for RAG
create table if not exists public.widget_documents (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.widget_documents is 'Chunked documents and embeddings for widget RAG; n8n Supabase Vector Store can query by widget_id in metadata';
comment on column public.widget_documents.metadata is 'e.g. { "source": "pdf"|"url", "filename"?, "url"?, "widget_id": "..." }';

create index if not exists idx_widget_documents_widget_id on public.widget_documents(widget_id);
create index if not exists idx_widget_documents_created_at on public.widget_documents(created_at desc);

-- HNSW index for fast similarity search (cosine distance)
create index if not exists idx_widget_documents_embedding_cosine
  on public.widget_documents
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.widget_documents enable row level security;

drop policy if exists "Allow all on widget_documents" on public.widget_documents;
create policy "Allow all on widget_documents" on public.widget_documents for all using (true) with check (true);
