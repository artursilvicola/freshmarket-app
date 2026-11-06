-- Kontrola PRZED / PO migracjach biblioteki zdjęć i rejestru zgód (TYLKO ODCZYT). SQL Editor projektu PRODUKCYJNEGO sklyfuvzjikkqerxtulo.
-- Ten sam plik działa przed i po migracjach (brakujące obiekty dają NULL/0 zamiast błędu). Wynik: jedna tabela.
-- Kolumna `po_migracji` = oczekiwana wartość po 8 migracjach; `przed` opisane w kolumnie `przed_migracja`.
with k(co, jest, przed_migracja, po_migracji) as (
  values
  ('postgres >= 15 (security_invoker)', (current_setting('server_version_num')::int >= 150000)::text, 'true', 'true'),
  ('claim wiadomości 5 argumentów (z 06.11)', (select count(*)::text from pg_proc where proname='marketing_claim_messages' and pronargs=5), '1', '1'),
  ('tabela marketing_photos', (to_regclass('public.marketing_photos') is not null)::text, 'false', 'true'),
  ('tabela marketing_photo_versions', (to_regclass('public.marketing_photo_versions') is not null)::text, 'false', 'true'),
  ('widok marketing_photo_usage', (to_regclass('public.marketing_photo_usage') is not null)::text, 'false', 'true'),
  ('kolumny kampanii (photo_id, photo_version_id, layout_version, frozen_photo)', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='marketing_campaigns' and column_name in ('photo_id','photo_version_id','layout_version','frozen_photo')), '0', '4'),
  ('kolumna photos.approved_version_id', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='marketing_photos' and column_name='approved_version_id'), '0', '1'),
  ('kolumny wersji (published_at, unpublishing_at, unpublished_at)', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='marketing_photo_versions' and column_name in ('published_at','unpublishing_at','unpublished_at')), '0', '3'),
  ('RPC claim_unpublish', (select count(*)::text from pg_proc where proname='marketing_photo_version_claim_unpublish'), '0', '1'),
  ('RPC release_unpublish (ma NIE być)', (select count(*)::text from pg_proc where proname='marketing_photo_version_release_unpublish'), '0', '0'),
  ('funkcja version_usable', (select count(*)::text from pg_proc where proname='marketing_photo_version_usable'), '0', '1'),
  ('trigger niezmienności wersji', (select count(*)::text from pg_trigger where tgname='trg_marketing_photo_versions_immutable'), '0', '1'),
  ('trigger strażnika kampanii', (select count(*)::text from pg_trigger where tgname='trg_marketing_campaigns_photo_version_guard'), '0', '1'),
  ('trigger strażnika zatwierdzenia', (select count(*)::text from pg_trigger where tgname='trg_marketing_photos_approved_version_guard'), '0', '1'),
  ('bucket marketing-photos publiczny', coalesce((select public::text from storage.buckets where id='marketing-photos'), 'brak'), 'brak', 'true'),
  ('bucket marketing-photos-pending publiczny', coalesce((select public::text from storage.buckets where id='marketing-photos-pending'), 'brak'), 'brak', 'false'),
  ('polityki storage marketing_photos*', (select count(*)::text from pg_policy where polrelid='storage.objects'::regclass and polname like 'marketing_photos%'), '0', '1'),
  ('tabela marketing_suppression_lifts', (to_regclass('public.marketing_suppression_lifts') is not null)::text, 'false', 'true'),
  ('RPC lift_suppression', (select count(*)::text from pg_proc where proname='marketing_lift_suppression'), '0', '1'),
  ('trigger ochrony wypisów', (select count(*)::text from pg_trigger where tgname='trg_marketing_suppressions_no_silent_delete'), '0', '1'),
  ('trigger czasu zgody', (select count(*)::text from pg_trigger where tgname='trg_marketing_suppression_lifts_stamp'), '0', '1'),
  ('strażnik wypisów w wersji końcowej', (select count(*)::text from pg_proc where proname='marketing_suppressions_no_silent_delete' and prosrc like '%to_jsonb(old)%'), '0', '1'),
  ('trigger wersji dopuszcza zerowanie autora', (select count(*)::text from pg_proc where proname='marketing_photo_versions_immutable' and prosrc like '%new.created_by is not null%'), '0', '1'),
  ('service_role EXECUTE zniesienia wypisu (ma NIE być)', case when to_regprocedure('public.marketing_lift_suppression(text,text,text,text)') is null then 'brak' else has_function_privilege('service_role','public.marketing_lift_suppression(text,text,text,text)','execute')::text end, 'brak', 'false'),
  ('service_role DELETE na wersjach (ma NIE być)', case when to_regclass('public.marketing_photo_versions') is null then 'brak' else has_table_privilege('service_role','public.marketing_photo_versions','delete')::text end, 'brak', 'false'),
  ('kampanie razem (bez zmian)', (select count(*)::text from public.marketing_campaigns), 'zapisz', 'jak przed'),
  ('wiadomości razem (bez zmian)', (select count(*)::text from public.marketing_messages), 'zapisz', 'jak przed'),
  ('wypisy razem (bez zmian)', (select count(*)::text from public.marketing_suppressions), 'zapisz', 'jak przed')
)
select co, jest, przed_migracja, po_migracji from k;
