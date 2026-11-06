-- Kontrola po imporcie zdjęć (TYLKO ODCZYT; dopiero PO migracjach). Oczekiwane: ready 18, opublikowane 18,
-- prywatne_oczekujace 0, wycofane 0, w_trakcie 0, obiekty publiczne 18, prywatne 0.
select (select count(*) from public.marketing_photos where status = 'ready') as ready,
       (select count(*) from public.marketing_photos where status = 'ready' and approved_version_id is not null) as ready_z_wersja,
       (select count(*) from public.marketing_photos where status = 'pending') as pending,
       (select count(*) from public.marketing_photo_versions where published_at is not null and unpublished_at is null) as opublikowane,
       (select count(*) from public.marketing_photo_versions where published_at is null and unpublished_at is null) as prywatne_oczekujace,
       (select count(*) from public.marketing_photo_versions where unpublished_at is not null) as wycofane,
       (select count(*) from public.marketing_photo_versions where unpublishing_at is not null) as w_trakcie,
       (select max(bytes) from public.marketing_photo_versions) as max_bajtow,
       (select count(*) from storage.objects where bucket_id = 'marketing-photos') as obiekty_publiczne,
       (select count(*) from storage.objects where bucket_id = 'marketing-photos-pending') as obiekty_prywatne;
