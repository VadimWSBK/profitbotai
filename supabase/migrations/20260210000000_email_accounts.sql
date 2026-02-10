-- Email accounts for cold outreach. Stores SMTP/IMAP credentials and per-account sending settings.
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text not null,
  display_name text not null default '',
  reply_to text,
  provider_type text not null default 'smtp' check (provider_type in ('google', 'microsoft', 'smtp')),
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  smtp_config jsonb not null default '{}'::jsonb,
  imap_config jsonb not null default '{}'::jsonb,
  daily_send_limit integer not null default 30,
  warmup_enabled boolean not null default false,
  daily_warmup_limit integer not null default 10,
  signature_html text not null default '',
  last_error text,
  last_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_accounts is 'Cold outreach email accounts with SMTP/IMAP credentials and per-account sending settings';

create index if not exists idx_email_accounts_user_id on public.email_accounts(user_id);
create index if not exists idx_email_accounts_status on public.email_accounts(status);

drop trigger if exists set_email_accounts_updated_at on public.email_accounts;
create trigger set_email_accounts_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

alter table public.email_accounts enable row level security;

create policy "Users can manage own email accounts"
  on public.email_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Global email outreach settings per user (one row, upserted).
create table if not exists public.email_outreach_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  default_daily_send_limit integer not null default 30,
  min_delay_minutes integer not null default 3,
  random_delay_minutes integer not null default 5,
  bounce_threshold_pct numeric not null default 5.0,
  spam_complaint_threshold_pct numeric not null default 2.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

comment on table public.email_outreach_settings is 'Global email outreach settings per user: throttling, limits, safety thresholds';

create index if not exists idx_email_outreach_settings_user_id on public.email_outreach_settings(user_id);

drop trigger if exists set_email_outreach_settings_updated_at on public.email_outreach_settings;
create trigger set_email_outreach_settings_updated_at
  before update on public.email_outreach_settings
  for each row execute function public.set_updated_at();

alter table public.email_outreach_settings enable row level security;

create policy "Users can manage own email outreach settings"
  on public.email_outreach_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
