-- Logo and QR code display size (width in points) in generated quote PDFs.
alter table public.quote_settings
  add column if not exists logo_size integer default 120,
  add column if not exists qr_size integer default 80;

comment on column public.quote_settings.logo_size is 'Logo width in points in the quote PDF (default 120)';
comment on column public.quote_settings.qr_size is 'QR code width in points in the quote PDF (default 80)';
