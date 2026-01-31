-- RPC: append PDF URL to all contacts with the given email. For Shopify + Chat flows where we have email.
create or replace function public.append_pdf_quote_by_email(p_email text, p_pdf_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contacts
  set pdf_quotes = pdf_quotes || jsonb_build_array(jsonb_build_object('url', p_pdf_url, 'created_at', now()))
  where email = p_email;
end;
$$;

grant execute on function public.append_pdf_quote_by_email(text, text) to anon;
