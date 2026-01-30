-- Widgets: store widget settings (name, display mode, full config JSON, n8n webhook)
create table if not exists public.widgets (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Chat Widget',
  display_mode text not null default 'popup' check (display_mode in ('popup', 'standalone', 'embedded')),
  config jsonb not null default '{}',
  n8n_webhook_url text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Analytics / events: track opens, messages, sessions per widget
create table if not exists public.widget_events (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  event_type text not null,
  session_id text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists idx_widget_events_widget_id on public.widget_events(widget_id);
create index if not exists idx_widget_events_created_at on public.widget_events(created_at);
create index if not exists idx_widget_events_event_type on public.widget_events(event_type);

-- updated_at trigger for widgets
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_widgets_updated_at on public.widgets;
create trigger set_widgets_updated_at
  before update on public.widgets
  for each row execute function public.set_updated_at();

-- Enable RLS (Row Level Security)
alter table public.widgets enable row level security;
alter table public.widget_events enable row level security;

-- Allow all operations for now; tighten when you add auth
drop policy if exists "Allow all on widgets" on public.widgets;
create policy "Allow all on widgets" on public.widgets for all using (true) with check (true);

drop policy if exists "Allow all on widget_events" on public.widget_events;
create policy "Allow all on widget_events" on public.widget_events for all using (true) with check (true);
