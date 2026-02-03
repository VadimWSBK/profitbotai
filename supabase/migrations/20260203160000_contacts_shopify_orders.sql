-- Store Shopify order summaries per contact (synced from Shopify integration).
alter table public.contacts
  add column if not exists shopify_orders jsonb not null default '[]'::jsonb;

create index if not exists idx_contacts_shopify_orders on public.contacts using gin (shopify_orders);
