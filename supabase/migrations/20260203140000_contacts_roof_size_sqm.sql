-- Add roof size (square metres) to contacts. Bot extracts from conversation and stores/updates it for quotes.
alter table public.contacts
  add column if not exists roof_size_sqm numeric;

comment on column public.contacts.roof_size_sqm is 'Roof or project area in square metres; extracted from conversation or set by bot for quote generation.';
