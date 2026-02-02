-- Workflow execution log: one row per workflow run
create table if not exists public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  trigger_type text not null, -- 'form_submit' | 'message_in_chat'
  trigger_payload jsonb not null default '{}', -- form_id, conversation_id, contact email, etc.
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_workflow_executions_workflow_id on public.workflow_executions(workflow_id);
create index if not exists idx_workflow_executions_started_at on public.workflow_executions(started_at desc);

alter table public.workflow_executions enable row level security;

create policy "Users can view executions for own workflows"
  on public.workflow_executions for select
  using (
    exists (
      select 1 from public.workflows w
      join public.widgets ww on ww.id = w.widget_id
      where w.id = workflow_executions.workflow_id and ww.created_by = auth.uid()
    )
  );

-- Inserts/updates are done server-side with service role (bypasses RLS)

-- Workflow execution steps: one row per node executed in a run
create table if not exists public.workflow_execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.workflow_executions(id) on delete cascade,
  node_id text not null, -- id from workflow node (e.g. action-abc123)
  node_label text,
  action_type text, -- 'Generate quote', 'Send email', etc.
  status text not null check (status in ('success', 'error', 'skipped')),
  error_message text,
  output jsonb, -- e.g. { signedUrl, emailSent }
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_workflow_execution_steps_execution_id on public.workflow_execution_steps(execution_id);

alter table public.workflow_execution_steps enable row level security;

create policy "Users can view steps for own workflow executions"
  on public.workflow_execution_steps for select
  using (
    exists (
      select 1 from public.workflow_executions e
      join public.workflows w on w.id = e.workflow_id
      join public.widgets ww on ww.id = w.widget_id
      where e.id = workflow_execution_steps.execution_id and ww.created_by = auth.uid()
    )
  );
