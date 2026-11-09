-- ============================================================================
-- Aktywność — kontrola PRZED wdrożeniem (krok P). Tylko odczyt. SQL Editor projektu
-- sklyfuvzjikkqerxtulo (sprawdź adres). Nic nie zmienia.
-- Oczekiwane: rola postgres; pg_cron zainstalowany; obiektów modułu jeszcze nie ma;
-- brak zadania retencji; podstawowe tabele, z których czyta raport, istnieją.
-- ============================================================================
select current_user                                                         as rola,
       (select extversion from pg_extension where extname = 'pg_cron')       as pg_cron,
       to_regclass('public.app_visits')                                     as app_visits,
       to_regclass('public.app_activity_settings')                          as app_activity_settings,
       to_regprocedure('public.record_app_visit()')                         as record_app_visit,
       (select count(*) from pg_catalog.pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'cron' and c.relname = 'job')                    as tabela_cron_job,
       to_regclass('public.legacy_send_messages')                           as legacy_send_messages,
       to_regclass('public.legacy_send_app_reads')                          as legacy_send_app_reads,
       to_regclass('public.marketing_messages')                             as marketing_messages,
       to_regclass('public.marketing_email_events')                         as marketing_email_events,
       to_regprocedure('public.is_admin()')                                 as is_admin;

-- zadanie retencji nie powinno jeszcze istnieć (0); wymaga pg_cron — jeśli kolumna pg_cron
-- wyżej jest pusta, pomiń to zapytanie i zatrzymaj wdrożenie (02 nie zadziała)
select count(*) as zadania_retencji from cron.job where jobname = 'fm-app-activity-retention';
