-- Contact emails: store every email sent to a contact for conversation tracking.
-- Enables unified view (chat + email) in Messages and Resend webhook status updates.

create type public.email_direction as enum ('outbound', 'inbound');
create type public.email_status as enum ('pending', 'sent', 'delivered', 'opened', 'bounced', 'failed');

create table if not exists public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.widget_conversations(id) on delete set null,
  direction public.email_direction not null default 'outbound',
  subject text not null default '',
  body_preview text,
  to_email text not null,
  from_email text,
  provider text not null default 'resend',
  provider_message_id text,
  status public.email_status not null default 'pending',
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contact_emails_contact_id on public.contact_emails(contact_id);
create index if not exists idx_contact_emails_conversation_id on public.contact_emails(conversation_id);
create index if not exists idx_contact_emails_provider_message_id on public.contact_emails(provider_message_id) where provider_message_id is not null;
create index if not exists idx_contact_emails_created_at on public.contact_emails(created_at);

drop trigger if exists set_contact_emails_updated_at on public.contact_emails;
create trigger set_contact_emails_updated_at
  before update on public.contact_emails
  for each row execute function public.set_updated_at();

alter table public.contact_emails enable row level security;

-- Same access as contacts: via widget ownership or contact without widget
create policy "Users can manage contact emails for their contacts"
  on public.contact_emails for all using (
    exists (
      select 1 from public.contacts c
      left join public.widgets w on w.id = c.widget_id
      where c.id = contact_emails.contact_id
        and (c.widget_id is null or w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.contacts c
      left join public.widgets w on w.id = c.widget_id
      where c.id = contact_emails.contact_id
        and (c.widget_id is null or w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  );
