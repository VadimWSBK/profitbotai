-- Contacts: allow multiple phone numbers per contact. Change phone from text to jsonb array of strings.
-- First element is treated as primary phone for backward compatibility.

-- Add new column, migrate data, swap
alter table public.contacts add column if not exists phones jsonb not null default '[]'::jsonb;

update public.contacts
set phones = case
  when phone is null or trim(phone) = '' then '[]'::jsonb
  else to_jsonb(ARRAY[trim(phone)])::jsonb
end
where true;

alter table public.contacts drop column if exists phone;
alter table public.contacts rename column phones to phone;

comment on column public.contacts.phone is 'JSONB array of phone numbers (e.g. ["+1234567890","+0987654321"]). First = primary.';

-- Index for "find contact by phone" lookups
create index if not exists idx_contacts_phone_contains on public.contacts using gin(phone jsonb_path_ops);
