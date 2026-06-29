-- Fresh Market B2B — dry-run czyszczenia danych testowych przed pilotem
--
-- Uruchom w Supabase SQL Editor. Ten plik NICZEGO NIE USUWA.
-- Cel: policzyć i wypisać kandydatów do ręcznego usunięcia, zanim powstanie
-- osobny execute script. Nie kasujemy automatycznie rekordów z historią
-- finansową: packages / payu_orders / proformas.

-- 1. Konta techniczne Codex/E2E
select
  'auth_codex_users' as bucket,
  count(*) as rows
from auth.users
where email like 'codex.%@freshmarket.test';

select
  u.id,
  u.email,
  p.role,
  p.name,
  p.company_id,
  p.retailer_id,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where u.email like 'codex.%@freshmarket.test'
order by u.email;

-- 2. Dostawcy/firma wyglądające testowo, ale bez usuwania rekordów z finansami
with candidate_companies as (
  select c.*
  from public.companies c
  where
    c.name ilike 'Test Dostawca%'
    or c.name ilike '% test%'
    or c.name ilike 'test %'
    or c.nip in ('PL0000000000', '0000000000', 'TR0000000001')
),
company_usage as (
  select
    c.id,
    c.name,
    c.nip,
    c.created_at,
    count(distinct p.id) filter (where p.id is not null) as profiles_count,
    count(distinct lo.id) filter (where lo.id is not null) as legacy_offers_count,
    count(distinct ls.id) filter (where ls.id is not null) as legacy_sends_count,
    count(distinct pkg.id) filter (where pkg.id is not null) as packages_count,
    count(distinct po.id) filter (where po.id is not null) as payu_orders_count,
    count(distinct pf.id) filter (where pf.id is not null) as proformas_count
  from candidate_companies c
  left join public.profiles p on p.company_id = c.id
  left join public.legacy_offers lo on lo.supplier_legacy_id = c.legacy_supplier_id
  left join public.legacy_sends ls on ls.supplier_legacy_id = c.legacy_supplier_id
  left join public.packages pkg on pkg.company_id = c.id
  left join public.payu_orders po on po.company_id = c.id
  left join public.proformas pf on pf.company_id = c.id
  group by c.id, c.name, c.nip, c.created_at
)
select
  *,
  case
    when packages_count > 0 or payu_orders_count > 0 or proformas_count > 0
      then 'MANUAL_REVIEW_FINANCIAL_HISTORY'
    else 'SAFE_CANDIDATE_AFTER_REVIEW'
  end as cleanup_status
from company_usage
order by created_at desc nulls last, name;

-- 3. Legacy oferty/wysyłki ewidentnie testowe po treści
select
  'legacy_offers_test_like' as bucket,
  count(*) as rows
from public.legacy_offers
where
  coalesce(data->>'title', '') ilike '%test%'
  or coalesce(data->>'product', '') ilike '%test%'
  or coalesce(data->>'internalTitle', '') ilike '%test%';

select
  legacy_id,
  supplier_legacy_id,
  status,
  data->>'title' as title,
  data->>'product' as product,
  created_at
from public.legacy_offers
where
  coalesce(data->>'title', '') ilike '%test%'
  or coalesce(data->>'product', '') ilike '%test%'
  or coalesce(data->>'internalTitle', '') ilike '%test%'
order by created_at desc nulls last
limit 100;

select
  'legacy_sends_test_like' as bucket,
  count(*) as rows
from public.legacy_sends ls
left join public.legacy_offers lo on lo.legacy_id = ls.offer_legacy_id
where
  coalesce(ls.data->>'title', '') ilike '%test%'
  or coalesce(lo.data->>'title', '') ilike '%test%'
  or coalesce(lo.data->>'product', '') ilike '%test%';

select
  ls.legacy_id,
  ls.supplier_legacy_id,
  ls.offer_legacy_id,
  ls.retailer_id,
  ls.status,
  coalesce(ls.data->>'title', lo.data->>'title', lo.data->>'product') as title,
  ls.created_at
from public.legacy_sends ls
left join public.legacy_offers lo on lo.legacy_id = ls.offer_legacy_id
where
  coalesce(ls.data->>'title', '') ilike '%test%'
  or coalesce(lo.data->>'title', '') ilike '%test%'
  or coalesce(lo.data->>'product', '') ilike '%test%'
order by ls.created_at desc nulls last
limit 100;

-- 4. Historyczne demo/backfill firmy — tylko do decyzji ręcznej.
select
  c.id,
  c.name,
  c.legacy_supplier_id,
  count(distinct pkg.id) as packages_count,
  count(distinct po.id) as payu_orders_count,
  count(distinct pf.id) as proformas_count
from public.companies c
left join public.packages pkg on pkg.company_id = c.id
left join public.payu_orders po on po.company_id = c.id
left join public.proformas pf on pf.company_id = c.id
where c.name ilike any (array['unica%', 'pik global%', 'fresh inside%'])
group by c.id, c.name, c.legacy_supplier_id
order by c.name;
