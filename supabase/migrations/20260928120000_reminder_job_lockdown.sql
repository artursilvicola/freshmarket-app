-- ============================================================================
-- 20260928120000 — stary cron przypomnień: brak EXECUTE dla ról klienckich
-- [audyt Codexa 28.09, P1] — WDRAŻALNE OSOBNO, nie zależy od kluczy scrapera.
--
-- public.fm_14d_reminder_job() żyje tylko w bazie (drugi system: Edge Function
-- send-email + pg_cron; harmonogram `fm-14d-reminder` wyłączony 10.06). Funkcja jest
-- SECURITY DEFINER (właściciel postgres) z EXECUTE przez PUBLIC i bezpośrednio dla
-- anon/authenticated/service_role — ręczne wywołanie mogło wysłać maile i zmienić
-- reminder_sent. Odbieramy EXECUTE od PUBLIC, anon i authenticated (dziedziczenie
-- z PUBLIC też znika). Właściciel, postgres (pg_cron) i service_role zachowują dostęp.
-- Harmonogramu nie ruszamy — migracja niczego nie reaktywuje.
--
-- Tryb ścisły (domyślny, SQL Editor): brak funkcji = BŁĄD, żeby warunkowe pominięcie nie
-- udawało wdrożenia. W pustej bazie testowej runner ustawia `set app.allow_missing = 'on'`.
-- ============================================================================
begin;
do $$
declare
  f record;
  v_n integer := 0;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fm_14d_reminder_job'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to postgres, service_role', f.sig);
    v_n := v_n + 1;
    raise notice 'reminder_job_lockdown: EXECUTE odebrane PUBLIC/anon/authenticated dla %', f.sig;
  end loop;
  if v_n = 0 then
    if coalesce(current_setting('app.allow_missing', true), '') = 'on' then
      raise notice 'reminder_job_lockdown: brak public.fm_14d_reminder_job (pusta baza) — pomijam';
    else
      raise exception 'reminder_job_lockdown: brak public.fm_14d_reminder_job — migracja nie ma czego zamknąć (ustaw app.allow_missing=on tylko w bazie testowej)';
    end if;
  end if;
end $$;
commit;

-- Kontrola po (tylko odczyt):
--   select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fm_14d_reminder_job';
-- Oczekiwane: anon=f, authenticated=f, service_role=t.
