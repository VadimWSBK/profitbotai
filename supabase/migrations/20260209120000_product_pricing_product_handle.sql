-- Add product_handle for roof-kit product types. Null = legacy sealant-only.
alter table public.product_pricing
  add column if not exists product_handle text;

comment on column public.product_pricing.product_handle is 'Roof-kit product type: waterproof-sealant, protective-top-coat, sealer, geo-textile, rapid-cure-spray, brush-roller. Null = waterproof-sealant (backward compat).';

create index if not exists idx_product_pricing_handle on public.product_pricing(created_by, product_handle);
