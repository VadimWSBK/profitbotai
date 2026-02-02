-- Workflows: per-widget automation (trigger = message in chat, actions = generate quote, send email, etc.)
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  name text not null default 'Untitled workflow',
  nodes jsonb not null default '[]',
  edges jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workflows_widget_id on public.workflows(widget_id);

create trigger set_workflows_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

alter table public.workflows enable row level security;

-- Same as widgets: admins full CRUD; users can manage workflows for widgets they own (created_by)
create policy "Admins can manage workflows" on public.workflows
  for all using (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  );

create policy "Users can manage own widget workflows" on public.workflows
  for all using (
    exists (
      select 1 from public.widgets w
      where w.id = workflows.widget_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.widgets w
      where w.id = workflows.widget_id and w.created_by = auth.uid()
    )
  );
