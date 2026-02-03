-- Tags: jsonb array of strings per contact (e.g. 'shopify', 'lead'). Multiple tags per contact.
alter table public.contacts
  add column if not exists tags jsonb not null default '[]'::jsonb;

create index if not exists idx_contacts_tags on public.contacts using gin (tags);

-- Backfill: add 'shopify' tag to contacts that have Shopify orders (merge with existing tags, dedupe)
update public.contacts
set tags = (
  select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(tags, '[]'::jsonb) || '["shopify"]'::jsonb) as elem
)
where jsonb_array_length(shopify_orders) > 0
  and (tags is null or not (tags @> '["shopify"]'::jsonb));

-- RPC: return distinct tag values from contacts (RLS applies)
create or replace function public.get_distinct_contact_tags()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct jsonb_array_elements_text(tags) as tag
  from public.contacts
  where tags is not null and jsonb_array_length(tags) > 0
  order by 1;
$$;

grant execute on function public.get_distinct_contact_tags() to authenticated;
grant execute on function public.get_distinct_contact_tags() to service_role;
