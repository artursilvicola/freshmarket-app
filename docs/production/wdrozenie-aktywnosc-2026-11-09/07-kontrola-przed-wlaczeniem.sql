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

-- Bezpośrednie RPC jako kupiec testowy przy wyłączonym zapisie: oczekiwane {"reason":"disabled","recorded":false}
-- (transakcja wycofywana — nic się nie zmienia; podmień adres w jednym miejscu)
begin;
select set_config('request.jwt.claims',
       json_build_object('sub', (select id from public.profiles where lower(email) = lower('KUPIEC-TESTOWY@example.com')), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.record_app_visit() as wynik;
rollback;
