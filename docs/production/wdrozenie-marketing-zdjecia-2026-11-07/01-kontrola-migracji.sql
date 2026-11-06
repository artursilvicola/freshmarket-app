-- Kontrola PRZED / PO migracjach biblioteki zdjęć (tylko odczyt). Uruchamiać w SQL Editor projektu PRODUKCYJNEGO
-- przed pierwszą migracją (oczekiwane: nic nie istnieje) i po każdej (kolumna „oczekiwane_po_6”).
-- A. obiekty bazy
select 'tabela marketing_photos'            as co, to_regclass('public.marketing_photos') is not null::text            as jest, 'true'  as oczekiwane_po_6 union all
select 'tabela marketing_photo_versions',       to_regclass('public.marketing_photo_versions') is not null::text,        'true'  union all
select 'widok marketing_photo_usage',           to_regclass('public.marketing_photo_usage') is not null::text,           'true'  union all
select 'kolumna campaigns.photo_id',            exists(select 1 from information_schema.columns where table_name='marketing_campaigns' and column_name='photo_id')::text, 'true' union all
select 'kolumna campaigns.layout_version',      exists(select 1 from information_schema.columns where table_name='marketing_campaigns' and column_name='layout_version')::text, 'true' union all
select 'kolumna campaigns.frozen_photo',        exists(select 1 from information_schema.columns where table_name='marketing_campaigns' and column_name='frozen_photo')::text, 'true' union all
select 'kolumna photos.approved_version_id',    exists(select 1 from information_schema.columns where table_name='marketing_photos' and column_name='approved_version_id')::text, 'true' union all
select 'kolumna versions.published_at',         exists(select 1 from information_schema.columns where table_name='marketing_photo_versions' and column_name='published_at')::text, 'true' union all
select 'kolumna versions.unpublishing_at',      exists(select 1 from information_schema.columns where table_name='marketing_photo_versions' and column_name='unpublishing_at')::text, 'true' union all
select 'kolumna versions.unpublished_at',       exists(select 1 from information_schema.columns where table_name='marketing_photo_versions' and column_name='unpublished_at')::text, 'true' union all
select 'RPC claim_unpublish',                   (select count(*)::text from pg_proc where proname='marketing_photo_version_claim_unpublish'), '1' union all
select 'RPC release_unpublish (ma NIE być)',    (select count(*)::text from pg_proc where proname='marketing_photo_version_release_unpublish'), '0' union all
select 'funkcja version_usable',                (select count(*)::text from pg_proc where proname='marketing_photo_version_usable'), '1' union all
select 'trigger niezmienności wersji',          (select count(*)::text from pg_trigger where tgname='trg_marketing_photo_versions_immutable'), '1' union all
select 'trigger strażnika kampanii',            (select count(*)::text from pg_trigger where tgname='trg_marketing_campaigns_photo_version_guard'), '1' union all
select 'trigger strażnika zatwierdzenia',       (select count(*)::text from pg_trigger where tgname='trg_marketing_photos_approved_version_guard'), '1' union all
select 'bucket marketing-photos (public)',      (select coalesce(public::text,'brak') from storage.buckets where id='marketing-photos'), 'true' union all
select 'bucket marketing-photos-pending (private)', (select coalesce(public::text,'brak') from storage.buckets where id='marketing-photos-pending'), 'false' union all
select 'polityki storage marketing_photos%',    (select count(*)::text from pg_policy where polrelid='storage.objects'::regclass and polname like 'marketing_photos%'), '1 (tylko public_read)' union all
select 'service_role DELETE na versions (ma NIE być)', (select has_table_privilege('service_role','public.marketing_photo_versions','delete')::text), 'false' union all
select 'service_role UPDATE na photos',         (select has_table_privilege('service_role','public.marketing_photos','update')::text), 'true';

-- B. dane marketingu BEZ zmian (zapisać liczby PRZED i porównać PO)
select (select count(*) from public.marketing_campaigns)   as kampanie,
       (select count(*) from public.marketing_messages)    as wiadomosci,
       (select count(*) from public.marketing_suppressions) as wypisy,
       (select count(*) from public.marketing_campaigns where layout_version = 1) as kampanie_uklad_1,   -- po migracji = wszystkie istniejące
       (select count(*) from public.marketing_campaigns where photo_id is not null) as kampanie_ze_zdjeciem; -- po migracji 0

-- C. po imporcie zdjęć (krok 3): oczekiwane 18 ready / 18 opublikowanych / 0 pending / 0 prywatnych obiektów
select p.status, count(*) as zdjec, count(p.approved_version_id) as z_zatwierdzona_wersja
  from public.marketing_photos p group by p.status;
select count(*) filter (where published_at is not null and unpublished_at is null) as opublikowane,
       count(*) filter (where published_at is null and unpublished_at is null)     as prywatne_oczekujace,
       count(*) filter (where unpublished_at is not null)                          as wycofane,
       count(*) filter (where unpublishing_at is not null)                          as w_trakcie_wycofywania,
       max(bytes) as max_bajtow, min(width) as min_szer, max(width) as max_szer
  from public.marketing_photo_versions;
select bucket_id, count(*) as obiektow from storage.objects where bucket_id in ('marketing-photos','marketing-photos-pending') group by bucket_id;
