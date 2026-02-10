-- Idempotency: store Chatwoot message id for incoming messages so we skip duplicate webhooks
alter table public.chatwoot_conversation_messages
  add column if not exists chatwoot_message_id bigint unique;

comment on column public.chatwoot_conversation_messages.chatwoot_message_id is 'Chatwoot message id (payload id) for user messages; used to dedupe duplicate webhook deliveries.';
