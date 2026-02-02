-- Quote forms: embeddable multi-step forms that collect contact/address and generate a quote PDF.
create table if not exists public.quote_forms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Quote form',
  title text not null default 'Get Your Quote',
  steps jsonb not null default '[]'::jsonb,
  colors jsonb not null default '{"primary":"#D4AF37"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quote_forms_user_id on public.quote_forms(user_id);

drop trigger if exists set_quote_forms_updated_at on public.quote_forms;
create trigger set_quote_forms_updated_at
  before update on public.quote_forms
  for each row execute function public.set_updated_at();

alter table public.quote_forms enable row level security;

create policy "Users can manage own quote forms"
  on public.quote_forms for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow anonymous read for embed (public form page loads form config by id)
create policy "Anyone can read quote forms"
  on public.quote_forms for select
  using (true);
