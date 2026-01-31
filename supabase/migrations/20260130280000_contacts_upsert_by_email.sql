-- Allow webhook to upsert contacts by email (create if new, update if exists)
-- Make conversation_id and widget_id nullable for webhook-originated contacts
-- Add unique constraint on email for upsert conflict target

alter table public.contacts alter column conversation_id drop not null;
alter table public.contacts alter column widget_id drop not null;

create unique index if not exists contacts_email_unique on public.contacts(email) where email is not null;

-- RLS: allow anon to insert webhook contacts (null conv/widget) or conversation-linked contacts
drop policy if exists "Anonymous can insert contacts for existing conversations" on public.contacts;
create policy "Anonymous can insert contacts"
  on public.contacts for insert
  with check (
    (widget_id is null and conversation_id is null)
    or exists (
      select 1 from public.widget_conversations c
      where c.id = conversation_id and c.widget_id = contacts.widget_id
    )
  );

drop policy if exists "Anonymous can update contacts for existing conversations" on public.contacts;
create policy "Anonymous can update contacts"
  on public.contacts for update
  using (true)
  with check (true);

-- Widget owners can manage contacts (including webhook-originated with null widget_id)
drop policy if exists "Widget owners can manage contacts" on public.contacts;
create policy "Widget owners can manage contacts"
  on public.contacts for all using (
    contacts.widget_id is null
    or exists (
      select 1 from public.widgets w
      where w.id = contacts.widget_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  )
  with check (
    contacts.widget_id is null
    or exists (
      select 1 from public.widgets w
      where w.id = contacts.widget_id
        and (w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  );
