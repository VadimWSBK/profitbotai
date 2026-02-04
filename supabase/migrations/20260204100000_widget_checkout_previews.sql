-- Structured checkout preview data for DIY checkout messages (data-driven UI, no markdown tables).
create table if not exists public.widget_checkout_previews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.widget_conversations(id) on delete cascade,
  message_id uuid references public.widget_conversation_messages(id) on delete set null,
  widget_id uuid not null references public.widgets(id) on delete cascade,
  line_items_ui jsonb not null default '[]',
  summary jsonb not null default '{}',
  checkout_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_widget_checkout_previews_conversation_id on public.widget_checkout_previews(conversation_id);
create index if not exists idx_widget_checkout_previews_message_id on public.widget_checkout_previews(message_id);

alter table public.widget_checkout_previews enable row level security;

-- Only service role writes; embed reads via SECURITY DEFINER RPC that joins messages.
-- No policies: service role bypasses RLS; anon cannot read/write this table directly.

-- Extend get_conversation_messages_for_embed to return checkout preview when present.
create or replace function public.get_conversation_messages_for_embed(p_conv_id uuid)
returns table(
  id uuid,
  role text,
  content text,
  created_at timestamptz,
  avatar_url text,
  line_items_ui jsonb,
  summary jsonb,
  checkout_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    m.id,
    m.role,
    m.content,
    m.created_at,
    case when m.role = 'human_agent' and m.created_by is not null
      then public.get_agent_avatar(m.created_by)
      else null
    end as avatar_url,
    p.line_items_ui,
    p.summary,
    p.checkout_url
  from public.widget_conversation_messages m
  left join public.widget_checkout_previews p on p.message_id = m.id
  where m.conversation_id = p_conv_id
  order by m.created_at asc;
end;
$$;
