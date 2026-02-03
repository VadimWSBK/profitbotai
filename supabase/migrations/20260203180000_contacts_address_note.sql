-- Split address into components and add note for contacts.
alter table public.contacts
  add column if not exists street_address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postcode text,
  add column if not exists country text,
  add column if not exists note text;
