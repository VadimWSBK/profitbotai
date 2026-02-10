-- Track when the checkout link was clicked (for analytics and conversion funnel).
alter table public.widget_checkout_previews
  add column if not exists checkout_clicked_at timestamptz,
  add column if not exists order_id text;

comment on column public.widget_checkout_previews.checkout_clicked_at is 'When the user clicked GO TO CHECKOUT (set by redirect endpoint).';
comment on column public.widget_checkout_previews.order_id is 'Shopify order id when this checkout converted (set by webhook or manual update).';
