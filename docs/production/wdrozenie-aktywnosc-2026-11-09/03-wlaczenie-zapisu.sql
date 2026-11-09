-- ============================================================================
-- Aktywność — ŚWIADOME włączenie zapisu wejść. Uruchamiać dopiero po:
--   1) migracji 20261109120000_app_activity.sql,
--   2) 02-harmonogram-retencji.sql,
--   3) sprawdzeniu, że adres SQL Editora zawiera WŁAŚCIWY projekt
--      (produkcja: sklyfuvzjikkqerxtulo; test: rruszzdffclfhbtfeznb).
-- Bez tego kroku record_app_visit() nic nie zapisuje, nawet przy włączonych flagach VITE.
--
-- WYŁĄCZENIE (także wycofanie i krok 0 przy ponowieniu): osobny plik 04-wylaczenie-zapisu.sql
-- (nie zależy od pg_cron). Wyłączenie samych flag VITE NIE zatrzymuje zapisu przez bezpośrednie RPC.
-- ============================================================================
update public.app_activity_settings
   set enabled = true, enabled_changed_at = now()
 where id;

-- kontrola: stan przełącznika, harmonogram retencji, liczba zapisanych wizyt
select s.enabled, s.enabled_changed_at, s.collecting_since,
       (select count(*) from cron.job where jobname = 'fm-app-activity-retention' and active) as retention_jobs,
       (select count(*) from public.app_visits) as visits
  from public.app_activity_settings s;
