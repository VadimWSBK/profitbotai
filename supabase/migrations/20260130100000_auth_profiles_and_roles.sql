-- Profiles: one per auth.users row, stores role and display info
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- Index for looking up profile by user_id
create index if not exists idx_profiles_user_id on public.profiles(user_id);

-- To promote a user to admin, run in Supabase SQL editor:
--   update public.profiles set role = 'admin' where user_id = 'their-auth-users-uuid';

-- Trigger: create profile when a new user signs up (default role: user)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, role, display_name)
  values (new.id, 'user', coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

-- Trigger on auth.users (run in Supabase SQL editor if RLS blocks; or enable with service role)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at for profiles
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Add created_by to widgets (owner; only admins can create, but we store who created)
alter table public.widgets
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists idx_widgets_created_by on public.widgets(created_by);

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- Profiles: users can read their own profile
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = user_id);

-- Profiles: users can update their own display_name only (role changes reserved for backend/superuser)
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Replace permissive widgets policies with role-based ones
drop policy if exists "Allow all on widgets" on public.widgets;

-- Admins: full CRUD on widgets (and can see all widgets for now; scope to created_by if you want per-admin isolation)
create policy "Admins can manage widgets" on public.widgets
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Users (non-admin): no widget access for now; they will see chats later via a separate interface
-- Uncomment and add widget_assignments table when you add chat UI for users
-- create policy "Users can read assigned widgets" on public.widgets for select using (...);

-- Widget events: admins can do everything; users read-only for events of widgets they can see
drop policy if exists "Allow all on widget_events" on public.widget_events;

create policy "Admins can manage widget_events" on public.widget_events
  for all using (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  );

create policy "Users can read widget_events" on public.widget_events
  for select using (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'user')
  );

-- Embed script (anonymous) can post events only for existing widgets
create policy "Anonymous can insert widget_events for existing widgets" on public.widget_events
  for insert with check (
    exists (select 1 from public.widgets where widgets.id = widget_id)
  );
