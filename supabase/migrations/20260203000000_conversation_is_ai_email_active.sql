-- Allow per-conversation toggle for AI email (e.g. auto-replies). Default on.
alter table public.widget_conversations
  add column if not exists is_ai_email_active boolean not null default true;

comment on column public.widget_conversations.is_ai_email_active is
  'When true, AI may send automated email replies for this conversation (when implemented). When false, only human-sent emails from Messages.';
