-- Add description and colors columns to product_pricing
-- description: product description fetched from Shopify (body_html stripped to text)
-- colors: JSON array of color strings (e.g. ["Surfmist", "Dune", "Cove"])
alter table public.product_pricing
  add column if not exists description text,
  add column if not exists colors jsonb;

-- Change coverage_sqm semantics: now stores sqm per litre (rate) instead of total coverage.
-- Existing data: coverage was total sqm for the bucket. Convert to per-litre rate.
-- e.g. 15L bucket with 30 sqm total -> 2 sqm/L
update public.product_pricing
  set coverage_sqm = case
    when size_litres > 0 then coverage_sqm / size_litres
    else coverage_sqm
  end;

comment on column public.product_pricing.coverage_sqm is 'Coverage rate in square metres per litre (sqm/L)';
comment on column public.product_pricing.description is 'Product description text (from Shopify body_html or manual entry)';
comment on column public.product_pricing.colors is 'JSON array of available color names for this product';
