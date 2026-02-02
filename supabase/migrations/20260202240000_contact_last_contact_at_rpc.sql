-- RPC: last contact time per contact = max(latest chat message, latest email).
-- Used by leadflow/contacts APIs to show "Last conversation: X ago" from real activity.
create or replace function public.get_contact_last_contact_at(p_contact_ids uuid[])
returns table(contact_id uuid, last_contact_at timestamptz)
language sql
stable
security invoker
as $$
  with contact_conv as (
    select c.id as cid, c.conversation_id
    from public.contacts c
    where c.id = any(p_contact_ids)
  ),
  last_msg as (
    select cc.cid, max(m.created_at) as ts
    from public.widget_conversation_messages m
    join contact_conv cc on cc.conversation_id = m.conversation_id
    group by cc.cid
  ),
  last_email as (
    select ce.contact_id as cid, max(ce.created_at) as ts
    from public.contact_emails ce
    where ce.contact_id = any(p_contact_ids)
    group by ce.contact_id
  )
  select cc.cid as contact_id,
    case
      when lm.ts is null and le.ts is null then null
      else greatest(
        coalesce(lm.ts, '1970-01-01'::timestamptz),
        coalesce(le.ts, '1970-01-01'::timestamptz)
      )
    end as last_contact_at
  from contact_conv cc
  left join last_msg lm on lm.cid = cc.cid
  left join last_email le on le.cid = cc.cid
$$;

comment on function public.get_contact_last_contact_at(uuid[]) is
  'Returns the latest contact time per contact (max of last chat message and last email). Used by leadflow/contacts APIs.';

grant execute on function public.get_contact_last_contact_at(uuid[]) to authenticated;
