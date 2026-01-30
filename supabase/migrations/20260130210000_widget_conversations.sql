-- Conversations: one per visitor (session) per widget. Enables AI to refer to past messages.
create table if not exists public.widget_conversations (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  session_id text not null,
  is_ai_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(widget_id, session_id)
);

-- Messages: each message in a conversation. role: user (visitor), assistant (AI), human_agent (operator).
create table if not exists public.widget_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.widget_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'human_agent')),
  content text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_widget_conversations_widget_id on public.widget_conversations(widget_id);
create index if not exists idx_widget_conversations_updated_at on public.widget_conversations(updated_at);
create index if not exists idx_widget_conversation_messages_conversation_id on public.widget_conversation_messages(conversation_id);
create index if not exists idx_widget_conversation_messages_created_at on public.widget_conversation_messages(created_at);

-- updated_at trigger for conversations
drop trigger if exists set_widget_conversations_updated_at on public.widget_conversations;
create trigger set_widget_conversations_updated_at
  before update on public.widget_conversations
  for each row execute function public.set_updated_at();

-- RLS
alter table public.widget_conversations enable row level security;
alter table public.widget_conversation_messages enable row level security;

-- Only widget owners (via widgets.created_by) can read/update conversations and messages
create policy "Widget owners can manage conversations"
  on public.widget_conversations for all using (
    exists (
      select 1 from public.widgets
      where widgets.id = widget_conversations.widget_id
        and (widgets.created_by = auth.uid() or exists (
          select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.widgets
      where widgets.id = widget_conversations.widget_id
        and (widgets.created_by = auth.uid() or exists (
          select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin'
        ))
    )
  );

create policy "Widget owners can manage conversation messages"
  on public.widget_conversation_messages for all using (
    exists (
      select 1 from public.widget_conversations c
      join public.widgets w on w.id = c.widget_id
      where c.id = conversation_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.widget_conversations c
      join public.widgets w on w.id = c.widget_id
      where c.id = conversation_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin'
        ))
    )
  );

-- Service role / anonymous: allow insert into conversations and messages when coming from widget (API will use service role for chat)
-- Chat API uses getSupabaseAdmin() so it bypasses RLS. Embed only calls POST /api/widgets/[id]/chat.
-- So we need a policy that allows the backend (via service role) to insert. Service role bypasses RLS.
-- For the embed to create conversations we don't expose direct Supabase; the API creates them. So no anon policy needed.

-- Enable Realtime for live message feed on dashboard
alter publication supabase_realtime add table public.widget_conversation_messages;
alter publication supabase_realtime add table public.widget_conversations;
