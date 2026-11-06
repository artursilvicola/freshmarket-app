-- ============================================================================
-- KONTA PRÓBNE do próby poczty Marketing → Aktywacja PreConnect (06.11.2026) — wersja 2
-- (review Codexa P1: pełna kontrola tożsamości PRZED zapisem; konflikt = przerwanie całej transakcji)
-- Uruchamia ARTUR w Supabase SQL Editor na projekcie PRODUKCYJNYM sklyfuvzjikkqerxtulo,
-- po migracji 01 i po deployu kodu. Dwie firmy dostawców + dwóch operatorów:
--   PL: spiker.artur@gmail.com     (firma „Próba marketingu PL (Artur)”,  operator pl)
--   EN: artur.silvicola@gmail.com  (firma „Marketing trial EN (Artur)”,   operator en)
-- Kontrola 06.11 (tylko odczyt): żaden z adresów nie istnieje w auth.users / profiles / marketing_suppressions.
--
-- Zasady:
--   * NAJPIERW kontrola tożsamości (bez zapisu). Każdy konflikt → RAISE EXCEPTION → cała transakcja
--     wycofana, nic nie zmienione:
--       - UUID firmy zajęty przez firmę o INNEJ nazwie,
--       - UUID użytkownika zajęty przez konto z INNYM adresem,
--       - adres zajęty przez konto o INNYM UUID,
--       - profil pod naszym UUID z innym adresem, inną rolą niż supplier albo inną firmą,
--       - tożsamość (auth.identities) pod naszym UUID z innym adresem / providerem.
--   * Ponowienie dozwolone TYLKO gdy istniejące wiersze są już naszymi kontami próbnymi
--     (ten sam UUID + ten sam adres + ta sama firma) — wtedy skrypt tylko domyka brakujące elementy.
--   * hasło losowe i nieznane (crypt(gen_random_uuid()) — logowanie przez „nie pamiętam hasła” /
--     magic link, żadnego sekretu w repo). Działanie logowania Supabase sprawdzić OSOBNO po utworzeniu
--     (PGlite z atrapą auth.identities tego nie potwierdza — uwaga Codexa).
--   * nazwy firm NIE zaczynają się od „ZZZ TEST” (silnik wykluczyłby je jako konto testowe);
--     account_status = active, preconnect_enabled = true; BEZ kredytów i pakietów.
-- Po próbie: 04-po-probie.sql (zawieszenie tylko potwierdzonych kont tej próby).
-- ============================================================================
begin;

do $$
declare
  c1 constant uuid := 'c0ffee00-0000-4000-8000-000000000001';
  c2 constant uuid := 'c0ffee00-0000-4000-8000-000000000002';
  u1 constant uuid := 'd0ffee00-0000-4000-8000-000000000001';
  u2 constant uuid := 'd0ffee00-0000-4000-8000-000000000002';
  n1 constant text := 'Próba marketingu PL (Artur)';
  n2 constant text := 'Marketing trial EN (Artur)';
  e1 constant text := 'spiker.artur@gmail.com';
  e2 constant text := 'artur.silvicola@gmail.com';
  r record;
begin
  -- ── 1. KONTROLA TOŻSAMOŚCI (bez zapisu) ─────────────────────────────────────
  for r in select * from (values (c1, n1), (c2, n2)) as t(id, name) loop
    if exists (select 1 from public.companies c where c.id = r.id and c.name <> r.name) then
      raise exception 'KONFLIKT: UUID firmy % jest zajęty przez inną firmę („%”) — przerwano bez zmian', r.id,
        (select name from public.companies where id = r.id);
    end if;
  end loop;
  for r in select * from (values (u1, e1, c1), (u2, e2, c2)) as t(id, email, company_id) loop
    if exists (select 1 from auth.users u where u.id = r.id and lower(coalesce(u.email, '')) <> r.email) then
      raise exception 'KONFLIKT: UUID użytkownika % jest zajęty przez konto z innym adresem — przerwano bez zmian', r.id;
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = r.email and u.id <> r.id) then
      raise exception 'KONFLIKT: adres % należy już do innego konta (%) — przerwano bez zmian', r.email,
        (select id from auth.users where lower(email) = r.email and id <> r.id limit 1);
    end if;
    if exists (select 1 from public.profiles p where p.id = r.id
                 and (lower(coalesce(p.email, r.email)) <> r.email or p.role::text <> 'supplier'
                      or (p.company_id is not null and p.company_id <> r.company_id))) then
      raise exception 'KONFLIKT: profil % istnieje z innym adresem/rolą/firmą — przerwano bez zmian', r.id;
    end if;
    if exists (select 1 from public.profiles p where lower(p.email) = r.email and p.id <> r.id) then
      raise exception 'KONFLIKT: profil z adresem % istnieje pod innym UUID — przerwano bez zmian', r.email;
    end if;
    if exists (select 1 from auth.identities i where i.user_id = r.id
                 and (i.provider <> 'email' or lower(coalesce(i.identity_data->>'email', r.email)) <> r.email)) then
      raise exception 'KONFLIKT: tożsamość auth.identities pod % nie pasuje do konta próbnego — przerwano bez zmian', r.id;
    end if;
  end loop;

  -- ── 2. ZAPIS (tylko gdy kontrola przeszła; istniejące wiersze = już nasze konta próbne) ──
  insert into public.companies (id, name, nip, country, city, categories, products, description, account_status, preconnect_enabled)
  values
    (c1, n1, null, 'PL', 'Warszawa',  array['owoce'],   'jabłka (konto próbne)',   'Konto próbne zespołu Fresh Market do testu poczty marketingowej. Nie jest prawdziwym dostawcą.', 'active', true),
    (c2, n2, null, 'NL', 'Rotterdam', array['warzywa'], 'tomatoes (trial account)', 'Fresh Market team trial account for the marketing e-mail test. Not a real supplier.', 'active', true)
  on conflict (id) do update set account_status = 'active', preconnect_enabled = true
    where public.companies.name = excluded.name;  -- tylko potwierdzona firma próbna

  for r in select * from (values
      (u1, e1, 'Artur Stasiak (próba PL)', 'pl', c1),
      (u2, e2, 'Artur Stasiak (trial EN)', 'en', c2)
    ) as t(id, email, name, locale, company_id)
  loop
    if not exists (select 1 from auth.users where id = r.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
              crypt(gen_random_uuid()::text, gen_salt('bf')), now(), null,
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    end if;
    if not exists (select 1 from auth.identities where user_id = r.id) then
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), r.id, jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
              'email', r.id::text, null, now(), now());
    end if;
    -- trigger handle_new_user mógł utworzyć profil — ustaw rolę, firmę, język, adres (po kontroli: to nasz profil)
    insert into public.profiles (id, role, name, email, company_id, locale, active)
    values (r.id, 'supplier', r.name, r.email, r.company_id, r.locale, true)
    on conflict (id) do update set role = 'supplier', name = excluded.name, email = excluded.email,
      company_id = excluded.company_id, locale = excluded.locale, active = true
      where lower(coalesce(public.profiles.email, excluded.email)) = excluded.email;
  end loop;

  -- ── 3. KONTROLA KOŃCOWA (musi być dokładnie 2 kompletne konta) ────────────────
  if (select count(*) from auth.users u join public.profiles p on p.id = u.id join public.companies c on c.id = p.company_id
       where u.id in (u1, u2) and lower(u.email) in (e1, e2) and p.role::text = 'supplier' and p.active
         and c.id in (c1, c2) and c.account_status = 'active' and c.preconnect_enabled) <> 2 then
    raise exception 'KONTROLA KOŃCOWA: nie ma dokładnie 2 kompletnych kont próbnych — przerwano, zmiany wycofane';
  end if;
end $$;

-- kontrola po utworzeniu (oczekiwane 2 wiersze: supplier / active=true / locale pl|en / firma active + preconnect)
select u.email, p.role::text as rola, p.locale, p.active, c.name as firma, c.account_status, c.preconnect_enabled
  from auth.users u join public.profiles p on p.id = u.id left join public.companies c on c.id = p.company_id
 where lower(u.email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
 order by u.email;

commit;
