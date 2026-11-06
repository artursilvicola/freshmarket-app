-- Kontrola po imporcie zdjęć (TYLKO ODCZYT; dopiero PO migracjach). Oczekiwane: ready 18, opublikowane 18,
-- prywatne_oczekujace 0, wycofane 0, w_trakcie 0, niezgodne_wersje 0, obiekty publiczne 18, prywatne 0.
-- niezgodne_wersje = opublikowane wersje inne niż 1200×800 JPEG do 200 KB. Bajty pliku, EXIF i anonimowy GET sprawdza się osobno (00-CZYTAJ, krok 3).
select (select count(*) from public.marketing_photos where status = 'ready') as ready,
       (select count(*) from public.marketing_photos where status = 'ready' and approved_version_id is not null) as ready_z_wersja,
       (select count(*) from public.marketing_photos where status = 'pending') as pending,
       (select count(*) from public.marketing_photo_versions where published_at is not null and unpublished_at is null) as opublikowane,
       (select count(*) from public.marketing_photo_versions where published_at is null and unpublished_at is null) as prywatne_oczekujace,
       (select count(*) from public.marketing_photo_versions where unpublished_at is not null) as wycofane,
       (select count(*) from public.marketing_photo_versions where unpublishing_at is not null) as w_trakcie,
       (select count(*) from public.marketing_photo_versions where published_at is not null and unpublished_at is null
         and (width <> 1200 or height <> 800 or mime <> 'image/jpeg' or bytes > 204800)) as niezgodne_wersje,
       (select max(bytes) from public.marketing_photo_versions) as max_bajtow,
       (select count(*) from storage.objects where bucket_id = 'marketing-photos') as obiekty_publiczne,
       (select count(*) from storage.objects where bucket_id = 'marketing-photos-pending') as obiekty_prywatne;
