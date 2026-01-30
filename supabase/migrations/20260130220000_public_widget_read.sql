-- Allow anonymous/public read of widgets for embed (Shopify, etc.).
-- Widget config is displayed to visitors anyway; write ops still require admin.
create policy "Public can read widgets" on public.widgets
  for select using (true);
