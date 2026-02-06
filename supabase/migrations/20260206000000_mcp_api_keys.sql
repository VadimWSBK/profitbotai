-- MCP API Keys: tenant-scoped API keys for MCP server access
-- Each workspace can generate an API key that allows OpenClaw to act as a user for that workspace
create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key text not null unique,
  name text, -- Optional name/description for the key
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mcp_api_keys is 'API keys for MCP server access, scoped to workspaces. Allows OpenClaw to act as a user for a specific tenant.';

create index if not exists idx_mcp_api_keys_workspace_id on public.mcp_api_keys(workspace_id);
create index if not exists idx_mcp_api_keys_api_key on public.mcp_api_keys(api_key);
create index if not exists idx_mcp_api_keys_user_id on public.mcp_api_keys(user_id);

drop trigger if exists set_mcp_api_keys_updated_at on public.mcp_api_keys;
create trigger set_mcp_api_keys_updated_at
  before update on public.mcp_api_keys
  for each row execute function public.set_updated_at();

alter table public.mcp_api_keys enable row level security;

-- Users can read MCP keys for their workspace
create policy "Users can read MCP keys for their workspace" on public.mcp_api_keys
  for select using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
      and p.workspace_id = mcp_api_keys.workspace_id
    )
  );

-- Users can create MCP keys for their workspace (must be workspace member)
create policy "Users can create MCP keys for their workspace" on public.mcp_api_keys
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
      and p.workspace_id = mcp_api_keys.workspace_id
    )
    and user_id = auth.uid()
  );

-- Users can update MCP keys for their workspace (only name and last_used_at)
create policy "Users can update MCP keys for their workspace" on public.mcp_api_keys
  for update using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
      and p.workspace_id = mcp_api_keys.workspace_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
      and p.workspace_id = mcp_api_keys.workspace_id
    )
  );

-- Users can delete MCP keys for their workspace
create policy "Users can delete MCP keys for their workspace" on public.mcp_api_keys
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
      and p.workspace_id = mcp_api_keys.workspace_id
    )
  );

-- Function to generate a secure API key
create or replace function public.generate_mcp_api_key()
returns text as $$
declare
  v_key text;
begin
  -- Generate a secure random key: pb_mcp_ + 32 random hex characters
  v_key := 'pb_mcp_' || encode(gen_random_bytes(16), 'hex');
  return v_key;
end;
$$ language plpgsql;

-- Function to validate and get MCP key info (for MCP server authentication)
create or replace function public.validate_mcp_api_key(p_api_key text)
returns table (
  workspace_id uuid,
  user_id uuid,
  api_key_id uuid
) as $$
begin
  return query
  select 
    m.workspace_id,
    m.user_id,
    m.id as api_key_id
  from public.mcp_api_keys m
  where m.api_key = p_api_key;
  
  -- Update last_used_at
  update public.mcp_api_keys
  set last_used_at = now()
  where api_key = p_api_key;
end;
$$ language plpgsql security definer;
