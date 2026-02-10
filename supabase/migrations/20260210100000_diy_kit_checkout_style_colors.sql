-- Add checkout style colors to calculator_config (DIY Kit Builder)
alter table public.calculator_config
  add column if not exists checkout_button_color text,
  add column if not exists qty_badge_background_color text;

-- Add style_overrides to widget_checkout_previews (stores colors when preview is saved)
alter table public.widget_checkout_previews
  add column if not exists style_overrides jsonb not null default '{}';

-- Extend get_conversation_messages_for_embed to return style_overrides
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
  style_overrides jsonb
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
    coalesce(p.style_overrides, '{}'::jsonb) as style_overrides
  from public.widget_conversation_messages m
  left join public.widget_checkout_previews p on p.message_id = m.id
  where m.conversation_id = p_conv_id
  order by m.created_at asc;
end;
$$;
