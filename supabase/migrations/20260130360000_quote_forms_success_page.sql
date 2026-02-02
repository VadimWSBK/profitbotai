-- Customizable success page text for quote forms
alter table public.quote_forms
  add column if not exists success_title text,
  add column if not exists success_message text;

comment on column public.quote_forms.success_title is 'Heading shown after quote is generated (e.g. Your quote is ready for download)';
comment on column public.quote_forms.success_message is 'Body text shown below heading (e.g. We have also sent a copy to your email.)';
