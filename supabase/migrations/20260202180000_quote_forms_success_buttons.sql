-- Configurable success page buttons: array of { label, url }
alter table public.quote_forms
  add column if not exists success_buttons jsonb not null default '[]'::jsonb;

comment on column public.quote_forms.success_buttons is 'Buttons shown on success page: [{ "label": "Download PDF", "url": "https://..." }, ...]';
