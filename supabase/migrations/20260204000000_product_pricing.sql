-- Product pricing: DIY bucket products with prices, coverage, image URLs. Per user.
-- Used by agent rules, DIY checkout tool, and quote generation.
create table if not exists public.product_pricing (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  size_litres int not null,
  price numeric not null,
  currency text not null default 'AUD',
  coverage_sqm numeric not null,
  image_url text,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_pricing_created_by on public.product_pricing(created_by);
create index if not exists idx_product_pricing_size on public.product_pricing(created_by, size_litres);

drop trigger if exists set_product_pricing_updated_at on public.product_pricing;
create trigger set_product_pricing_updated_at
  before update on public.product_pricing
  for each row execute function public.set_updated_at();

alter table public.product_pricing enable row level security;

create policy "Users can manage own product_pricing"
  on public.product_pricing for all
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Admins can read all (for support)
create policy "Admins can read all product_pricing"
  on public.product_pricing for select
  using (
    exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.role = 'admin')
  );

comment on table public.product_pricing is 'DIY product buckets: size, price, coverage, image. Used for agent pricing rules and checkout link generation.';
