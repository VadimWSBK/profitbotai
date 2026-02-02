-- Add status to workflows: draft (default) or live
alter table public.workflows
  add column if not exists status text not null default 'draft'
  check (status in ('draft', 'live'));
