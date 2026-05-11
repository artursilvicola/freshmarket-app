-- 026 - PreConnect RLS fallback for suppliers created without legacy_supplier_id.
-- Existing legacy suppliers keep their sup-* key. New UUID-only companies can
-- use companies.id as their PreConnect supplier key.

update public.companies
set legacy_supplier_id = id::text
where legacy_supplier_id is null;

create or replace function public.app_supplier_legacy_id() returns text as $$
  select coalesce(c.legacy_supplier_id, c.id::text)
  from public.companies c
  join public.profiles p on p.company_id = c.id
  where p.id = auth.uid()
  limit 1;
$$ language sql security definer stable;
