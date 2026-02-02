-- Leadflow: opportunity-style pipeline (Kanban). Stages are per-user; leads = contacts in a stage.

-- Pipeline stages (customizable per user)
create table if not exists public.lead_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lead_stages_created_by on public.lead_stages(created_by);
create index if not exists idx_lead_stages_sort on public.lead_stages(created_by, sort_order);

drop trigger if exists set_lead_stages_updated_at on public.lead_stages;
create trigger set_lead_stages_updated_at
  before update on public.lead_stages
  for each row execute function public.set_updated_at();

alter table public.lead_stages enable row level security;

-- Users can only manage their own stages
create policy "Users can manage own lead_stages"
  on public.lead_stages for all using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Leads: one per contact; contact sits in one stage
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  stage_id uuid not null references public.lead_stages(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contact_id)
);

create index if not exists idx_leads_contact_id on public.leads(contact_id);
create index if not exists idx_leads_stage_id on public.leads(stage_id);

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Same access as contacts: widget owner or admin
create policy "Widget owners and admins can manage leads"
  on public.leads for all using (
    exists (
      select 1 from public.contacts c
      join public.widgets w on w.id = c.widget_id
      where c.id = leads.contact_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.contacts c
      join public.widgets w on w.id = c.widget_id
      where c.id = leads.contact_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  );
