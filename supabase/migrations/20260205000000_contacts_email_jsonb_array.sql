-- Contacts: allow multiple emails per contact. Change email from unique text to jsonb array of strings.
-- First element is treated as primary email for backward compatibility.

-- Drop unique constraint (unique index creates implicit constraint) and old index
alter table public.contacts drop constraint if exists contacts_email_unique;
drop index if exists public.contacts_email_unique;
drop index if exists public.idx_contacts_email;

-- Add new column, migrate data, swap
alter table public.contacts add column if not exists emails jsonb not null default '[]'::jsonb;

update public.contacts
set emails = case
  when email is null or trim(email) = '' then '[]'::jsonb
  else to_jsonb(ARRAY[trim(email)])::jsonb
end
where true;

alter table public.contacts drop column if exists email;
alter table public.contacts rename column emails to email;

comment on column public.contacts.email is 'JSONB array of email addresses (e.g. ["a@x.com","b@y.com"]). First = primary.';

-- Index for "find contact by email" lookups (e.g. append_pdf_quote_by_email)
create index if not exists idx_contacts_email_contains on public.contacts using gin(email jsonb_path_ops);

-- RPC: append PDF URL to all contacts that have this email in their array
create or replace function public.append_pdf_quote_by_email(p_email text, p_pdf_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contacts
  set pdf_quotes = pdf_quotes || jsonb_build_array(jsonb_build_object('url', p_pdf_url, 'created_at', now()))
  where email @> to_jsonb(ARRAY[nullif(trim(lower(p_email)), '')])::jsonb;
end;
$$;

-- RPC: upsert contact by email (find by any email in array; update or insert)
create or replace function public.upsert_contact_by_email(
  p_email text,
  p_name text default null,
  p_phone text default null,
  p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_normalized text;
begin
  v_normalized := nullif(trim(lower(p_email)), '');
  if v_normalized is null then
    return jsonb_build_object('success', false, 'error', 'email required');
  end if;

  update public.contacts
  set
    name = coalesce(p_name, name),
    phone = coalesce(p_phone, phone),
    address = coalesce(p_address, address),
    updated_at = now()
  where email @> to_jsonb(ARRAY[v_normalized])::jsonb
  returning id into v_id;

  if found then
    return jsonb_build_object('success', true, 'action', 'updated', 'id', v_id);
  end if;

  insert into public.contacts (email, name, phone, address)
  values (to_jsonb(ARRAY[v_normalized])::jsonb, p_name, p_phone, p_address)
  returning id into v_id;

  return jsonb_build_object('success', true, 'action', 'created', 'id', v_id);
end;
$$;
