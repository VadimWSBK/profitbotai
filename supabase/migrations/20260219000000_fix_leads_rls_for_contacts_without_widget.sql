-- Fix: Leads RLS was rejecting when contact has widget_id = null (e.g. Chatwoot,
-- webhook contacts). Mirror the contacts and contact_emails policy: allow
-- access when contact has no widget, or when user owns the widget / is admin.

drop policy if exists "Widget owners and admins can manage leads" on public.leads;

create policy "Widget owners and admins can manage leads"
  on public.leads for all
  using (
    exists (
      select 1 from public.contacts c
      left join public.widgets w on w.id = c.widget_id
      where c.id = leads.contact_id
        and (c.widget_id is null or w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  )
  with check (
    exists (
      select 1 from public.contacts c
      left join public.widgets w on w.id = c.widget_id
      where c.id = leads.contact_id
        and (c.widget_id is null or w.created_by = auth.uid() or exists (
          select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'
        ))
    )
  );
