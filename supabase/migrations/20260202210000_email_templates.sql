-- Email templates: reusable subject/body for workflow "Send email" action.
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled template',
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_templates_user_id on public.email_templates(user_id);

drop trigger if exists set_email_templates_updated_at on public.email_templates;
create trigger set_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

alter table public.email_templates enable row level security;

create policy "Users can manage own email templates"
  on public.email_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
