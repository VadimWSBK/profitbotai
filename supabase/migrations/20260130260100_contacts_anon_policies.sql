-- Allow chat API (anon) to create contacts when a new conversation starts and update as we learn more.
create policy "Anonymous can select contacts"
  on public.contacts for select using (true);

create policy "Anonymous can insert contacts for existing conversations"
  on public.contacts for insert
  with check (
    exists (
      select 1 from public.widget_conversations c
      where c.id = conversation_id and c.widget_id = contacts.widget_id
    )
  );

create policy "Anonymous can update contacts for existing conversations"
  on public.contacts for update
  using (
    exists (select 1 from public.widget_conversations where id = conversation_id)
  )
  with check (
    exists (select 1 from public.widget_conversations where id = conversation_id)
  );
