-- ============================================================================
-- 20260928120000 — utwardzenie dwóch starszych mechanizmów we wspólnej bazie
-- [audyt Codexa 28.09: AUDYT_CODEX_2026-09-28_STARSZE_OSTRZEZENIA_SUPABASE.md]
--
-- Oba obiekty powstały POZA tym repozytorium (scraper: supabase_migration_v2.sql;
-- stary system przypomnień: tylko w bazie), dlatego migracja jest WARUNKOWA:
-- działa tylko, gdy obiekt istnieje, i jest idempotentna. W pustej bazie testowej
-- nic nie robi; runner scripts/legacy-hardening-sql-test.mjs tworzy atrapy o
-- pierwotnym (dziurawym) kształcie i sprawdza efekt.
--
-- 1. Tabele artykułów scrapera (articles, article_facts, article_prices):
--    polityki „service_full_*” / „Service full access …” były FOR ALL USING (true)
--    bez TO → obowiązywały dla PUBLIC (anon, authenticated). Zapis dostawał każdy
--    z publicznym kluczem anon. Nowe polityki zapisu: TYLKO service_role
--    (scraper Python i funkcje Netlify piszą kluczem serwisowym). Odczyt
--    publiczny (anon_read_*) zostaje bez zmian. Dodatkowo odbieramy bezpośrednie
--    GRANT-y zapisu od anon/authenticated/PUBLIC (RLS to druga warstwa, nie jedyna).
--
-- 2. public.fm_14d_reminder_job(): SECURITY DEFINER, EXECUTE dla PUBLIC/anon/
--    authenticated, bez kontroli roli — ręczne wywołanie mogło wysłać maile
--    przez Edge Function i zmienić reminder_sent. Odbieramy EXECUTE od PUBLIC,
--    anon i authenticated (właściciel/postgres/pg_cron nadal mogą). Harmonogram
--    pg_cron pozostaje wyłączony (cron.unschedule z 10.06) — tej migracji
--    to nie dotyczy.
-- ============================================================================

begin;

-- ── 1. tabele artykułów: zapis tylko dla service_role ───────────────────────
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['articles', 'article_facts', 'article_prices'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'legacy_hardening: brak tabeli public.%, pomijam', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- usuń KAŻDĄ politykę zapisu (INSERT/UPDATE/DELETE/ALL) nieograniczoną do service_role
    for pol in
      select policyname, cmd, roles
      from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        and not (roles = '{service_role}'::name[])
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      raise notice 'legacy_hardening: usunięta polityka % (%) na % (role %)', pol.policyname, pol.cmd, t, pol.roles;
    end loop;

    -- jedna polityka zapisu wyłącznie dla service_role
    execute format('drop policy if exists %I on public.%I', 'service_role_write_' || t, t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', 'service_role_write_' || t, t);

    -- odczyt publiczny zostaje: jeśli nie ma żadnej polityki SELECT, przywróć anon_read_* jak w scraperze
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd in ('SELECT', 'ALL')) then
      execute format('create policy %I on public.%I for select using (true)', 'anon_read_' || t, t);
    end if;

    -- druga warstwa: bezpośrednie uprawnienia zapisu tylko dla service_role
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── 2. stary cron przypomnień: brak EXECUTE dla ról klienckich ─────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fm_14d_reminder_job'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to postgres', f.sig);
    raise notice 'legacy_hardening: EXECUTE odebrane PUBLIC/anon/authenticated dla %', f.sig;
  end loop;
  if not found then
    raise notice 'legacy_hardening: brak funkcji public.fm_14d_reminder_job, pomijam';
  end if;
end $$;

commit;

-- Kontrola po zastosowaniu (SQL Editor, tylko odczyt):
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname='public' and tablename in ('articles','article_facts','article_prices') order by 1,2;
--   select grantee, table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
--    where table_name in ('articles','article_facts','article_prices') and grantee in ('anon','authenticated','service_role','PUBLIC') group by 1,2 order by 2,1;
--   select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fm_14d_reminder_job';
-- Oczekiwane: polityki zapisu tylko {service_role}; anon/authenticated tylko SELECT; funkcja: anon=f, authenticated=f.
