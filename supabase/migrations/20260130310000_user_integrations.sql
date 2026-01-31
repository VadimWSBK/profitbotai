-- Store third-party integrations per user (Resend, etc.)
create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  integration_type text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, integration_type)
);

comment on table public.user_integrations is 'Third-party integrations (Resend email, etc.) per user';

create index if not exists idx_user_integrations_user_id on public.user_integrations(user_id);

drop trigger if exists set_user_integrations_updated_at on public.user_integrations;
create trigger set_user_integrations_updated_at
  before update on public.user_integrations
  for each row execute function public.set_updated_at();

alter table public.user_integrations enable row level security;

create policy "Users can manage own integrations" on public.user_integrations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
