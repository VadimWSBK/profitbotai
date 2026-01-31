-- Quote template/settings per user. Used to generate PDF quotes and link to contacts.
create table if not exists public.quote_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company jsonb not null default '{}'::jsonb,
  bank_details jsonb not null default '{}'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  deposit_percent numeric not null default 40,
  tax_percent numeric not null default 10,
  valid_days integer not null default 30,
  logo_url text,
  barcode_url text,
  barcode_title text default 'Call Us or Visit Website',
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create index if not exists idx_quote_settings_user_id on public.quote_settings(user_id);

drop trigger if exists set_quote_settings_updated_at on public.quote_settings;
create trigger set_quote_settings_updated_at
  before update on public.quote_settings
  for each row execute function public.set_updated_at();

alter table public.quote_settings enable row level security;

create policy "Users can manage own quote settings"
  on public.quote_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
