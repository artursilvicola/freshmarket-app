-- ===================================================================
-- Fresh Market — niezależne testy (uruchom w Supabase SQL Editor)
-- Każde zapytanie zwraca wynik; idealne stany opisane w komentarzach.
-- ===================================================================

-- TEST 1: Czy istnieją obie tabele legacy_*
select count(*)::text || ' (oczekiwane: 2)' as test_1_legacy_tables_count
from information_schema.tables
where table_schema='public' and table_name like 'legacy_%';

-- TEST 2: Czy każda oferta ma supplier_legacy_id (referencja do dostawcy)
select count(*)::text || ' (oczekiwane: 0)' as test_2_offers_without_supplier
from legacy_offers
where supplier_legacy_id is null or supplier_legacy_id = '';

-- TEST 3: Czy każda wysyłka ma retailer_id (referencja do sieci)
select count(*)::text || ' (oczekiwane: 0)' as test_3_sends_without_retailer
from legacy_sends where retailer_id is null;

-- TEST 4: Statystyki statusów wysyłek
select 'TEST 4 statusy:' as info, status, count(*) as cnt
from legacy_sends
group by status
order by cnt desc;

-- TEST 5: Wysyłki sierotki (offer_legacy_id wskazuje na nieistniejącą ofertę)
select count(*)::text || ' (oczekiwane: 0)' as test_5_orphan_sends
from legacy_sends s
where not exists (select 1 from legacy_offers o where o.legacy_id = s.offer_legacy_id);

-- TEST 6: Statystyki RLS - ile ofert zobaczy buyer każdego retailera
select 'TEST 6 widoczność:' as info, s.retailer_id,
       count(distinct s.offer_legacy_id) as visible_offers,
       count(*) as total_sends
from legacy_sends s
where s.status in ('sent','opened','read','read_manual','unread_expired')
group by s.retailer_id
order by s.retailer_id;

-- TEST 7: Profiles bez przypisanej roli
select count(*)::text || ' (oczekiwane: 0)' as test_7_profiles_without_role
from profiles where role is null;

-- TEST 8: Buyerzy bez retailer_id (nie zobaczą żadnych ofert)
select 'TEST 8 buyers bez retailer:' as info,
       u.email, p.role::text, p.retailer_id
from profiles p
join auth.users u on u.id = p.id
where p.role='buyer' and p.retailer_id is null;

-- TEST 9: Suppliery bez company_id
select 'TEST 9 suppliers bez company:' as info,
       u.email, p.role::text, p.company_id
from profiles p
join auth.users u on u.id = p.id
where p.role='supplier' and p.company_id is null;

-- TEST 10: Aktywne polityki RLS dla legacy_*
select 'TEST 10 polityki:' as info, tablename, policyname, cmd
from pg_policies
where tablename in ('legacy_offers','legacy_sends')
order by tablename, policyname;

-- TEST 11: Bucket'y Storage skonfigurowane poprawnie
select 'TEST 11 bucketsy:' as info, id, name, public, file_size_limit
from storage.buckets
where id in ('offer-photos','company-logos','certs');

-- TEST 12: Czy są zdjęcia w storage offer-photos (rozmiar)
select 'TEST 12 storage offer-photos:' as info,
       count(*) as files,
       coalesce(round(sum((metadata->>'size')::bigint)::numeric / 1024 / 1024, 2), 0) as size_mb
from storage.objects where bucket_id = 'offer-photos';

-- TEST 13: Czy są loga firm
select 'TEST 13 storage company-logos:' as info,
       count(*) as files,
       coalesce(round(sum((metadata->>'size')::bigint)::numeric / 1024, 2), 0) as size_kb
from storage.objects where bucket_id = 'company-logos';

-- TEST 14: Konta testowe i ich aktualne role
select 'TEST 14 testowe konta:' as info,
       u.email, p.role::text, p.name, p.retailer_id, p.company_id is not null as ma_firme
from profiles p
join auth.users u on u.id = p.id
where u.email like '%test%' or u.email = 'artur@kjow.pl' or u.email = 'spiker.artur@gmail.com'
order by p.role, u.created_at desc;

-- TEST 15: Liczba ofert per supplier
select 'TEST 15 oferty per supplier:' as info,
       supplier_legacy_id, count(*) as cnt
from legacy_offers
group by supplier_legacy_id
order by cnt desc;

-- TEST 16: Liczba wysyłek per status (powinno być wiele 'sent')
select 'TEST 16 sumarycznie:' as info,
       (select count(*) from legacy_offers) as total_offers,
       (select count(*) from legacy_sends) as total_sends,
       (select count(*) from legacy_sends where status = 'sent') as sent,
       (select count(*) from legacy_sends where status in ('read','read_manual')) as read,
       (select count(*) from retailers) as total_retailers,
       (select count(*) from companies) as total_companies,
       (select count(*) from profiles) as total_users;
