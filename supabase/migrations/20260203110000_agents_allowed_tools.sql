-- Per-agent allowed tools: which tools this agent can use when autonomy is enabled
alter table public.agents
  add column if not exists allowed_tools jsonb not null default '["search_contacts", "get_current_contact", "generate_quote", "send_email"]'::jsonb;

comment on column public.agents.allowed_tools is 'Array of tool ids this agent can use: search_contacts, get_current_contact, create_contact, update_contact, delete_contact, generate_quote, send_email, send_message';
