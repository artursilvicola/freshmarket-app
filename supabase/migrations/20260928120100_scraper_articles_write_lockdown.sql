-- ============================================================================
-- 20260928120100 — tabele artykułów scrapera: zapis TYLKO service_role
-- [audyt Codexa 28.09, P1; review pakietu 28.09 — v2; review podsumowania dnia — v3]
--
-- Tabele articles, article_facts, article_prices (scraper, supabase_migration_v2.sql)
-- miały polityki FOR ALL USING (true) bez TO (= PUBLIC) i pełne ACL (arwdDxtm) dla
-- anon/authenticated → zapis z publicznego klucza anon. Scraper (Python, GitHub
-- Actions) i funkcje Netlify piszą kluczem service_role — WARUNEK: rola tych kluczy
-- potwierdzona (workflow verify-supabase-key-role + healthcheck.effective_key.ok)
-- PRZED wykonaniem tej migracji.
--
-- Co robi, per tabela:
--   1. istniejące polityki SELECT zostają bez zmian (dowolne role i predykaty);
--   2. usuwa każdą politykę zapisu (INSERT/UPDATE/DELETE/ALL) nieograniczoną do service_role;
--   3. dla każdej usuniętej polityki ALL, która dawała odczyt rolom klienckim (PUBLIC/anon/
--      authenticated), tworzy politykę SELECT z TYMI SAMYMI rolami i TYM SAMYM predykatem
--      (restored_read_<tabela>_<n>) — nigdy nie zamienia dowolnej polityki ALL na USING (true)
--      dla PUBLIC (v3: uwaga Codexa — polityka ALL TO authenticated USING (id=1) była
--      poszerzana do publicznego odczytu wszystkich wierszy);
--   4. tworzy service_role_write_<tabela> (FOR ALL TO service_role);
--   5. REVOKE ALL (w tym MAINTAIN) od PUBLIC, anon, authenticated; potem GRANT SELECT
--      wyłącznie tym rolom klienckim, które po zmianie mają jakąkolwiek politykę SELECT
--      (PUBLIC = anon + authenticated); GRANT ALL dla service_role.
-- Tryb ścisły (domyślny): brak którejkolwiek z 3 tabel = BŁĄD; w pustej bazie testowej
-- shim `supabase/tests/000_supabase_shim.sql` ustawia `app.allow_missing = 'on'`. Idempotentne.
-- ============================================================================
begin;
do $$
declare
  t text;
  pol record;
  v_client_roles name[];      -- role klienckie danej polityki (PUBLIC → anon+authenticated)
  v_read_roles name[];        -- role klienckie, które po zmianie mają politykę SELECT
  v_to text;                  -- lista ról do klauzuli TO odtwarzanej polityki
  v_name text;
  v_n integer;
  v_done integer := 0;
begin
  foreach t in array array['articles', 'article_facts', 'article_prices'] loop
    if to_regclass('public.' || t) is null then
      if coalesce(current_setting('app.allow_missing', true), '') = 'on' then
        raise notice 'articles_lockdown: brak tabeli public.% (pusta baza) — pomijam', t;
        continue;
      end if;
      raise exception 'articles_lockdown: brak tabeli public.% — przerwano (app.allow_missing=on tylko w bazie testowej)', t;
    end if;

    execute format('alter table public.%I enable row level security', t);
    v_read_roles := '{}'::name[];

    -- 1. istniejące polityki SELECT: zostają; ich role kliencke dostaną GRANT SELECT
    for pol in
      select policyname, roles from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    loop
      select coalesce(array_agg(r), '{}') into v_client_roles
      from unnest(case when pol.roles = '{public}'::name[] then '{anon,authenticated}'::name[] else pol.roles end) r
      where r in ('anon', 'authenticated');
      v_read_roles := v_read_roles || v_client_roles;
    end loop;

    -- 2./3. polityki zapisu nieograniczone do service_role: usuń; odczyt z ALL odtwórz 1:1
    v_n := 0;
    for pol in
      select policyname, cmd, roles, qual from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        and not (roles = '{service_role}'::name[])
      order by policyname
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      raise notice 'articles_lockdown: usunięta polityka % (% dla %) na %', pol.policyname, pol.cmd, pol.roles, t;

      if pol.cmd = 'ALL' then
        select coalesce(array_agg(r), '{}') into v_client_roles
        from unnest(case when pol.roles = '{public}'::name[] then '{anon,authenticated}'::name[] else pol.roles end) r
        where r in ('anon', 'authenticated');
        if array_length(v_client_roles, 1) > 0 and exists (
          -- identyczna polityka SELECT (te same role, ten sam predykat) już istnieje → nie dublować
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and cmd = 'SELECT'
            and roles = pol.roles and coalesce(qual, 'true') = coalesce(pol.qual, 'true')
        ) then
          raise notice 'articles_lockdown: odczyt z % pokrywa istniejąca polityka SELECT o tych samych rolach i predykacie — bez duplikatu', pol.policyname;
          v_read_roles := v_read_roles || v_client_roles;
        elsif array_length(v_client_roles, 1) > 0 then
          v_n := v_n + 1;
          v_name := 'restored_read_' || t || '_' || v_n;
          while exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = v_name) loop
            v_n := v_n + 1; v_name := 'restored_read_' || t || '_' || v_n;
          end loop;
          v_to := case when pol.roles = '{public}'::name[] then 'public'
                       else (select string_agg(quote_ident(r), ', ') from unnest(v_client_roles) r) end;
          execute format('create policy %I on public.%I for select to %s using (%s)',
                         v_name, t, v_to, coalesce(pol.qual, 'true'));
          v_read_roles := v_read_roles || v_client_roles;
          raise notice 'articles_lockdown: odczyt z usuniętej polityki % odtworzony 1:1 jako % (TO %, USING %)',
            pol.policyname, v_name, v_to, coalesce(pol.qual, 'true');
        end if;
      end if;
    end loop;

    -- 4. zapis wyłącznie dla service_role
    execute format('drop policy if exists %I on public.%I', 'service_role_write_' || t, t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', 'service_role_write_' || t, t);

    -- 5. ACL: wszystko (w tym MAINTAIN) precz od ról klienckich i PUBLIC; SELECT tylko rolom z polityką SELECT
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    select coalesce(array_agg(distinct r), '{}') into v_read_roles from unnest(v_read_roles) r;
    if array_length(v_read_roles, 1) > 0 then
      execute format('grant select on public.%I to %s', t, (select string_agg(quote_ident(r), ', ') from unnest(v_read_roles) r));
      raise notice 'articles_lockdown: % — GRANT SELECT dla %', t, v_read_roles;
    else
      raise notice 'articles_lockdown: % nie miała odczytu dla ról klienckich — SELECT NIE nadany', t;
    end if;
    execute format('grant all on public.%I to service_role', t);
    v_done := v_done + 1;
  end loop;
  raise notice 'articles_lockdown: utwardzono % z 3 tabel', v_done;
end $$;
commit;

-- Kontrola po (tylko odczyt):
--   select tablename, policyname, cmd, roles, qual from pg_policies
--    where schemaname='public' and tablename in ('articles','article_facts','article_prices') order by 1,2;
--   select t, r, string_agg(p, ',' order by p) as ma from (
--     select t, r, p from unnest(array['articles','article_facts','article_prices']) t,
--                        unnest(array['anon','authenticated','service_role']) r,
--                        unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
--     where has_table_privilege(r, 'public.' || t, p)) x group by 1,2 order by 1,2;
-- Oczekiwane: polityki zapisu tylko {service_role}; anon/authenticated: co najwyżej SELECT (tylko gdy mają
-- politykę SELECT); service_role: wszystko. Predykaty odtworzonych polityk = predykaty usuniętych ALL.
