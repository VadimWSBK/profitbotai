-- Store full DIY checkout result on the message so it survives refresh without relying on join.
alter table public.widget_conversation_messages
  add column if not exists checkout_preview jsonb default null;

comment on column public.widget_conversation_messages.checkout_preview is
  'Full DIY checkout result for this message: { checkoutUrl, lineItemsUI, summary, styleOverrides }. Used by embed so checkout and variant IDs survive refresh.';

-- Extend RPC to return message.checkout_preview (prefer over join when present).
drop function if exists public.get_conversation_messages_for_embed(uuid);

create or replace function public.get_conversation_messages_for_embed(p_conv_id uuid)
returns table(
  id uuid,
  role text,
  content text,
  created_at timestamptz,
  avatar_url text,
  line_items_ui jsonb,
  summary jsonb,
  checkout_url text,
  style_overrides jsonb,
  checkout_preview jsonb
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
    p.checkout_url,
    coalesce(p.style_overrides, '{}'::jsonb) as style_overrides,
    m.checkout_preview
  from public.widget_conversation_messages m
  left join public.widget_checkout_previews p on p.message_id = m.id
  where m.conversation_id = p_conv_id
  order by m.created_at asc;
end;
$$;
