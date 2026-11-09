-- ============================================================================
-- Aktywność — kontrola PO migracji, harmonogramie i deployu kodu, PRZED włączeniem zapisu
-- (krok K). Tylko odczyt (blok D wycofywany). SQL Editor projektu sklyfuvzjikkqerxtulo.
-- Oczekiwane: enabled = false, collecting_since puste, 0 wizyt, jedno aktywne zadanie
-- retencji (postgres/postgres), funkcja zapisu zwraca „disabled” także przy bezpośrednim RPC.
-- ============================================================================
select s.enabled, s.enabled_changed_at, s.collecting_since,
       (select count(*) from public.app_visits)                                            as wizyty,
       (select count(*) from cron.job where jobname = 'fm-app-activity-retention' and active) as zadania_retencji,
       (select string_agg(username || '/' || database, ',') from cron.job where jobname = 'fm-app-activity-retention') as rola_baza_zadania
  from public.app_activity_settings s;

-- Bezpośrednie RPC przy wyłączonym zapisie sprawdza się z panelu admina (sesja admina, POST
-- /rest/v1/rpc/record_app_visit): funkcja najpierw czyta wyłącznik, więc oczekiwane {"reason":"disabled"}.
-- (SQL Editor pokazuje wynik tylko ostatniego polecenia — dlatego tu jedno zapytanie.)
