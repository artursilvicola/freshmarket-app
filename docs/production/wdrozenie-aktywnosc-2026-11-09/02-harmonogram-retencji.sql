-- ============================================================================
-- Aktywność — harmonogram retencji w bazie (pg_cron), uruchamiany PO migracji
-- 20261109120000_app_activity.sql. Jeden Run w SQL Editor właściwego projektu.
--
-- Usuwa codziennie o 03:17 UTC wizyty starsze niż 12 miesięcy (public.purge_app_visits).
-- Niezależny od rodzaju deployu Netlify i od ruchu w aplikacji. Zadanie działa jako
-- właściciel bazy; funkcja nie jest dostępna dla anon/authenticated/service_role.
-- Idempotentny: ponowny Run podmienia zadanie o tej samej nazwie.
-- Wymaga rozszerzenia pg_cron (Supabase: Database → Extensions). Bez niego przerywa.
-- ============================================================================
do $$
begin
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

-- kontrola: jedno zadanie, aktywne, z właściwym poleceniem
select jobid, jobname, schedule, command, active
  from cron.job where jobname = 'fm-app-activity-retention';
