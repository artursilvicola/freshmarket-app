-- ============================================================================
-- Aktywność — harmonogram retencji w bazie (pg_cron), uruchamiany PO migracji
-- 20261109120000_app_activity.sql. Jeden Run w SQL Editor właściwego projektu.
--
-- Usuwa codziennie o 03:17 UTC wizyty starsze niż 12 miesięcy (public.purge_app_visits).
-- Niezależny od rodzaju deployu Netlify i od ruchu w aplikacji. Zadanie działa jako
-- właściciel bazy; funkcja nie jest dostępna dla anon/authenticated/service_role.
-- Idempotentny: ponowny Run podmienia zadanie o tej samej nazwie.
-- Wymaga rozszerzenia pg_cron (Supabase: Database → Extensions). Bez niego przerywa.
-- Uruchamiać jako `postgres` (domyślna rola SQL Editora): zadanie pg_cron dostaje rolę i bazę
-- wywołującego. Właściwy projekt potwierdza adres SQL Editora — nazwa bazy go nie identyfikuje.
-- ============================================================================
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Uruchom jako postgres (teraz: %) — zadanie przejmuje rolę wywołującego.', current_user;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Brak rozszerzenia pg_cron — włącz je w Database → Extensions i uruchom ponownie.';
  end if;
  if to_regprocedure('public.purge_app_visits()') is null then
    raise exception 'Brak funkcji public.purge_app_visits() — najpierw migracja 20261109120000_app_activity.sql.';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'fm-app-activity-retention';
  perform cron.schedule('fm-app-activity-retention', '17 3 * * *', 'select public.purge_app_visits()');
end;
$$;

-- kontrola (jedno zapytanie — SQL Editor pokazuje wynik tylko ostatniego polecenia):
-- jedno aktywne zadanie postgres/postgres z właściwym poleceniem; zapis nadal wyłączony;
-- funkcje modułu należą do postgres; purge_app_visits i app_activity_event_rows wykonuje TYLKO postgres
select (select count(*) from cron.job where jobname = 'fm-app-activity-retention')               as zadania,
       (select string_agg(schedule || ' | ' || command || ' | ' || active || ' | ' || username || '/' || database, '; ')
          from cron.job where jobname = 'fm-app-activity-retention')                               as zadanie,
       (select enabled from public.app_activity_settings)                                          as zapis_wlaczony,
       (select string_agg(p.proname || '=' || pg_get_userbyid(p.proowner) || coalesce(p.proacl::text, ''), '; ' order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('purge_app_visits','app_activity_event_rows','app_activity_period','record_app_visit',
                             'admin_activity_report','admin_activity_events','admin_set_activity_test_account')) as funkcje;
