-- [fix/buyer-entry-seen] KONTROLA PO MIGRACJI 20261113120000 — tylko odczyt, jedno zapytanie.
-- Uruchom w Supabase → SQL Editor na PRODUKCJI zaraz po wgraniu migracji. Każde „ŹLE” = STOP przed scaleniem PR.
with fn as (
  select p.oid, p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args,
         coalesce(array_to_string(p.proconfig, ','), '') as cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('confirm_legacy_send_manual', 'undo_legacy_send_manual_confirm')
),
checks(lp, kontrola, wynik, oczekiwane) as (
  select 1, 'obie funkcje istnieją (po jednej wersji)', (select count(*) from fn)::text, '2'
  union all
  select 2, 'sygnatura confirm_legacy_send_manual',
         coalesce((select args from fn where proname = 'confirm_legacy_send_manual'), 'brak'),
         'p_send_id uuid, p_company_id uuid, p_read_type text, p_note text, p_now timestamp with time zone'
  union all
  select 3, 'sygnatura undo_legacy_send_manual_confirm',
         coalesce((select args from fn where proname = 'undo_legacy_send_manual_confirm'), 'brak'),
         'p_send_id uuid, p_now timestamp with time zone'
  union all
  select 4, 'obie są SECURITY DEFINER z search_path=public',
         (select count(*) from fn where prosecdef and cfg like '%search_path=public%')::text, '2'
  union all
  select 5, 'zalogowany użytkownik (authenticated) NIE może ich wołać',
         (select count(*) from fn where has_function_privilege('authenticated', oid, 'execute'))::text, '0'
  union all
  select 6, 'anonim (anon) NIE może ich wołać',
         (select count(*) from fn where has_function_privilege('anon', oid, 'execute'))::text, '0'
  union all
  select 7, 'service_role może wołać obie',
         (select count(*) from fn where has_function_privilege('service_role', oid, 'execute'))::text, '2'
  union all
  select 8, 'funkcje rozliczające nietknięte: mark_legacy_send_seen i charge_legacy_send_first_seen nadal po jednej wersji',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('mark_legacy_send_seen', 'charge_legacy_send_first_seen'))::text, '2'
)
select lp, kontrola, wynik, oczekiwane, case when wynik = oczekiwane then 'OK' else 'ŹLE' end as ocena
from checks
order by lp;
