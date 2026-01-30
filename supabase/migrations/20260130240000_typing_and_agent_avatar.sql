-- Agent typing indicator and avatar for human_agent messages

-- Typing: when agent is typing, set these. Embed polls and shows typing dots.
alter table public.widget_conversations
  add column if not exists agent_typing_until timestamptz,
  add column if not exists agent_typing_by uuid references auth.users(id) on delete set null;

-- Which agent sent each human_agent message (for avatar)
alter table public.widget_conversation_messages
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Agent avatar URL in profiles
alter table public.profiles
  add column if not exists avatar_url text;

-- SECURITY DEFINER: fetch avatar for a user. Used by embed to show agent avatar.
create or replace function public.get_agent_avatar(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar text;
  v_meta jsonb;
begin
  if p_user_id is null then return null; end if;
  select avatar_url into v_avatar from public.profiles where user_id = p_user_id;
  if v_avatar is not null and v_avatar != '' then
    return v_avatar;
  end if;
  select raw_user_meta_data into v_meta from auth.users where id = p_user_id;
  return v_meta->>'avatar_url';
end;
$$;

-- Fetch messages for embed with avatar_url for human_agent rows.
create or replace function public.get_conversation_messages_for_embed(p_conv_id uuid)
returns table(id uuid, role text, content text, created_at timestamptz, avatar_url text)
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
    end as avatar_url
  from public.widget_conversation_messages m
  where m.conversation_id = p_conv_id
  order by m.created_at asc;
end;
$$;
