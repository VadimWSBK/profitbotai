-- One row per product; variants (size × color, each with variant ID and image) stored in jsonb.
-- Make per-variant columns nullable so a row can represent a product with variants in jsonb only.
alter table public.product_pricing
  alter column size_litres drop not null,
  alter column price drop not null,
  alter column currency drop not null,
  alter column coverage_sqm drop not null;

alter table public.product_pricing
  add column if not exists variants jsonb not null default '[]';

comment on column public.product_pricing.variants is 'Array of variant objects: { shopifyVariantId, sizeLitres, color?, price, currency, coverageSqm, imageUrl? }. One entry per size×color.';
