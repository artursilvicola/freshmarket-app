-- ============================================================================
-- Aktywność — kontrola po wdrożeniu (krok 5). Tylko odczyt. SQL Editor właściwego projektu.
-- Wykonuj po kolei razem z czynnościami w przeglądarce opisanymi w 00-CZYTAJ.md § 7a.
-- W każdym bloku podmień adres testowego kupca / dostawcy (jedno miejsce: CTE `k`).
-- ============================================================================

-- A. Po pierwszym wejściu testowego kupca: dokładnie 1 wizyta, hit_count = 1.
-- B. Po odświeżeniu strony (w ciągu 30 min): nadal 1 wizyta, hit_count = 2.
-- C. Po podglądzie konta tego kupca przez administratora: nadal 1 wizyta, hit_count bez zmian.
with k as (select id from public.profiles where lower(email) = lower('KUPIEC-TESTOWY@example.com'))
select v.id, v.role, v.started_at, v.last_seen_at, v.hit_count
  from public.app_visits v join k on k.id = v.profile_id
 where v.started_at > now() - interval '2 hours'
 order by v.id;

-- C (uzupełnienie). Konta administratorów nie mają żadnych wizyt.
select count(*) as wizyty_adminow
  from public.app_visits v join public.profiles p on p.id = v.profile_id
 where p.role::text = 'admin';

-- E. Stan modułu: zapis włączony, jedno aktywne zadanie retencji, początek zbierania.
select s.enabled, s.enabled_changed_at, s.collecting_since,
       (select count(*) from cron.job where jobname = 'fm-app-activity-retention' and active) as retention_jobs
  from public.app_activity_settings s;

-- D. (NA KOŃCU — kończy się oczekiwanym błędem, po którym SQL Editor przerywa wykonanie)
--    Dostawca nie ma dostępu do raportu: ten sam test co w przeglądarce, wykonany jako rola
--    authenticated z identyfikatorem dostawcy. Oczekiwany błąd: „admin_activity_report: tylko administrator”.
--    (transakcja wycofywana — nic się nie zmienia)
begin;
select set_config('request.jwt.claims',
       json_build_object('sub', (select id from public.profiles where lower(email) = lower('DOSTAWCA-TESTOWY@example.com')), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.admin_activity_report(now() - interval '7 days', now());
rollback;
