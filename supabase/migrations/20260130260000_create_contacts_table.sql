-- Contacts: one per conversation (chat visitor). Updated as we learn more (name, email, address).
-- Links to widget_conversations. Stores PDF quote links for lookup when user asks for a quote.
-- Chat API (service role) creates/updates contacts; widget owners can manage via dashboard.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.widget_conversations(id) on delete cascade,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  name text,
  email text,
  phone text,
  address text,
  pdf_quotes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conversation_id)
);

create index if not exists idx_contacts_conversation_id on public.contacts(conversation_id);
create index if not exists idx_contacts_widget_id on public.contacts(widget_id);
create index if not exists idx_contacts_email on public.contacts(email) where email is not null;
create index if not exists idx_contacts_pdf_quotes on public.contacts using gin(pdf_quotes);

-- updated_at trigger
drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- RLS: widget owners can manage contacts for their widgets
alter table public.contacts enable row level security;

create policy "Widget owners can manage contacts"
  on public.contacts for all using (
    exists (
      select 1 from public.widgets w
      where w.id = contacts.widget_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.widgets w
      where w.id = contacts.widget_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  );
