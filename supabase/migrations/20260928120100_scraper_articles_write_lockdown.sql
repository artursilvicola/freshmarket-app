-- ============================================================================
-- 20260928120100 — tabele artykułów scrapera: zapis TYLKO service_role
-- [audyt Codexa 28.09, P1; review pakietu 28.09 — v2]
--
-- Tabele articles, article_facts, article_prices (scraper, supabase_migration_v2.sql)
-- miały polityki FOR ALL USING (true) bez TO (= PUBLIC) i pełne ACL (arwdDxtm) dla
-- anon/authenticated → zapis z publicznego klucza anon. Scraper (Python, GitHub
-- Actions) i funkcje Netlify piszą kluczem service_role — WARUNEK: rola tych kluczy
-- potwierdzona (workflow verify-supabase-key-role + healthcheck.effective_key) PRZED
-- wykonaniem tej migracji.
--
-- Co robi, per tabela:
--   1. zapamiętuje, czy ISTNIEJE publiczny odczyt (polityka SELECT lub ALL dla PUBLIC/anon)
--      — i tylko taki zakres odtwarza; nie dodaje odczytu tabeli, która go nie miała;
--   2. usuwa każdą politykę zapisu (INSERT/UPDATE/DELETE/ALL) nieograniczoną do service_role;
--   3. tworzy service_role_write_<tabela> (FOR ALL TO service_role);
--   4. jeśli publiczny odczyt istniał tylko przez usuniętą politykę ALL → tworzy
--      anon_read_<tabela> (FOR SELECT USING (true)); istniejące polityki SELECT zostają;
--   5. REVOKE ALL (w tym MAINTAIN) od PUBLIC, anon, authenticated; potem GRANT SELECT
--      dla anon/authenticated TYLKO gdy publiczny odczyt istniał; GRANT ALL dla service_role.
-- Tryb ścisły (domyślny): brak którejkolwiek z 3 tabel = BŁĄD; w pustej bazie testowej
-- runner ustawia `set app.allow_missing = 'on'`. Idempotentne.
-- ============================================================================
begin;
do $$
declare
  t text;
  pol record;
  had_public_read boolean;
  has_select_policy boolean;
  v_done integer := 0;
begin
  foreach t in array array['articles', 'article_facts', 'article_prices'] loop
    if to_regclass('public.' || t) is null then
      if coalesce(current_setting('app.allow_missing', true), '') = 'on' then
        raise notice 'articles_lockdown: brak tabeli public.% (pusta baza) — pomijam', t;
        continue;
      end if;
      raise exception 'articles_lockdown: brak tabeli public.% — przerwano (ustaw app.allow_missing=on tylko w bazie testowej)', t;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- 1. jaki publiczny odczyt był dozwolony PRZED zmianą (SELECT lub ALL dla PUBLIC/anon/authenticated)
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('SELECT', 'ALL')
        and (roles = '{public}'::name[] or 'anon' = any(roles) or 'authenticated' = any(roles))
    ) into had_public_read;

    -- 2. polityki zapisu nieograniczone do service_role
    for pol in
      select policyname, cmd, roles from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        and not (roles = '{service_role}'::name[])
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      raise notice 'articles_lockdown: usunięta polityka % (% dla %) na %', pol.policyname, pol.cmd, pol.roles, t;
    end loop;

    -- 3. zapis wyłącznie dla service_role
    execute format('drop policy if exists %I on public.%I', 'service_role_write_' || t, t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', 'service_role_write_' || t, t);

    -- 4. odczyt: odtwórz TYLKO to, co było (bez polityki service_role, która ma cmd=ALL)
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    ) into has_select_policy;
    if had_public_read and not has_select_policy then
      execute format('create policy %I on public.%I for select using (true)', 'anon_read_' || t, t);
      raise notice 'articles_lockdown: publiczny odczyt % wynikał z polityki ALL — odtworzony jako anon_read_%', t, t;
    end if;

    -- 5. ACL: wszystko (w tym MAINTAIN) precz od ról klienckich i PUBLIC; SELECT tylko gdy był publiczny odczyt
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    if had_public_read then
      execute format('grant select on public.%I to anon, authenticated', t);
    else
      raise notice 'articles_lockdown: % nie miała publicznego odczytu — SELECT NIE nadany', t;
    end if;
    execute format('grant all on public.%I to service_role', t);
    v_done := v_done + 1;
  end loop;
  raise notice 'articles_lockdown: utwardzono % z 3 tabel', v_done;
end $$;
commit;

-- Kontrola po (tylko odczyt):
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname='public' and tablename in ('articles','article_facts','article_prices') order by 1,2;
--   select t, r, string_agg(p, ',' order by p) as ma from (
--     select t, r, p from unnest(array['articles','article_facts','article_prices']) t,
--                        unnest(array['anon','authenticated','service_role']) r,
--                        unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
--     where has_table_privilege(r, 'public.' || t, p)) x group by 1,2 order by 1,2;
-- Oczekiwane: polityki zapisu tylko {service_role}; anon/authenticated: wyłącznie SELECT; service_role: wszystko.
