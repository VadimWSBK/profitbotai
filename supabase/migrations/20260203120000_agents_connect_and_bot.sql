-- Add Connect and Train Bot fields to agents (moved from widgets).
-- When a widget uses an agent, chat backend, LLM, webhook triggers, and bot instructions come from the agent.

alter table public.agents
  add column if not exists chat_backend text not null default 'direct' check (chat_backend in ('n8n', 'direct')),
  add column if not exists n8n_webhook_url text default '',
  add column if not exists llm_provider text default '',
  add column if not exists llm_model text default '',
  add column if not exists llm_fallback_provider text default '',
  add column if not exists llm_fallback_model text default '',
  add column if not exists webhook_triggers jsonb not null default '[]',
  add column if not exists bot_role text default '',
  add column if not exists bot_tone text default '',
  add column if not exists bot_instructions text default '',
  add column if not exists agent_takeover_timeout_minutes integer not null default 5;

comment on column public.agents.chat_backend is 'n8n = use n8n webhook; direct = use our API + owner LLM keys';
comment on column public.agents.n8n_webhook_url is 'Webhook URL when chat_backend is n8n';
comment on column public.agents.webhook_triggers is 'When AI recognises intent, call webhook and use result in reply';
comment on column public.agents.bot_role is 'Who the bot is (e.g. helpful sales assistant)';
comment on column public.agents.bot_tone is 'How to sound (e.g. professional, friendly)';
comment on column public.agents.bot_instructions is 'Extra rules: length, language, etc.';
comment on column public.agents.agent_takeover_timeout_minutes is 'Minutes without live-agent reply before AI takes over again (direct only)';
