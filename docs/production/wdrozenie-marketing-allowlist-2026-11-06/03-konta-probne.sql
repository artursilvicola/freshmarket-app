-- ============================================================================
-- KONTA PRÓBNE do próby poczty Marketing → Aktywacja PreConnect (06.11.2026)
-- Uruchamia ARTUR w Supabase SQL Editor na projekcie PRODUKCYJNYM sklyfuvzjikkqerxtulo,
-- po migracji 01 i po deployu kodu. Dwie firmy dostawców + dwóch operatorów:
--   PL: spiker.artur@gmail.com     (firma „Próba marketingu PL (Artur)”,  operator pl)
--   EN: artur.silvicola@gmail.com  (firma „Marketing trial EN (Artur)”,   operator en)
-- Kontrola 06.11 (tylko odczyt): żaden z adresów nie istnieje w auth.users / profiles / marketing_suppressions.
-- Zabezpieczenia:
--   * jeśli adres JUŻ istnieje w auth.users — skrypt go NIE nadpisuje (raise notice, pomija),
--   * stałe UUID (idempotentny, on conflict do nothing / update tylko własnych pól),
--   * hasło losowe i nieznane (crypt(gen_random_uuid()) — logowanie przez „nie pamiętam hasła” / magic link,
--     żadnego sekretu w repo),
--   * nazwy firm NIE zaczynają się od „ZZZ TEST” (silnik wykluczyłby je jako konto testowe),
--   * account_status = active, preconnect_enabled = true, kraj PL / NL — żeby firmy kwalifikowały się
--     do grupy „Do wybranych firm”; BEZ kredytów i BEZ pakietów (marketing ich nie rozlicza).
-- Po próbie: 04-po-probie.sql (zawieszenie firm i operatorów; adresy mogą zostać w wypisach).
-- ============================================================================
begin;

insert into public.companies (id, name, nip, country, city, categories, products, description, account_status, preconnect_enabled)
values
  ('c0ffee00-0000-4000-8000-000000000001', 'Próba marketingu PL (Artur)', null, 'PL', 'Warszawa', array['owoce'], 'jabłka (konto próbne)', 'Konto próbne zespołu Fresh Market do testu poczty marketingowej. Nie jest prawdziwym dostawcą.', 'active', true),
  ('c0ffee00-0000-4000-8000-000000000002', 'Marketing trial EN (Artur)',  null, 'NL', 'Rotterdam', array['warzywa'], 'tomatoes (trial account)', 'Fresh Market team trial account for the marketing e-mail test. Not a real supplier.', 'active', true)
on conflict (id) do update set name = excluded.name, country = excluded.country, categories = excluded.categories,
  products = excluded.products, description = excluded.description, account_status = 'active', preconnect_enabled = true;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('d0ffee00-0000-4000-8000-000000000001'::uuid, 'spiker.artur@gmail.com',    'Artur Stasiak (próba PL)', 'pl', 'c0ffee00-0000-4000-8000-000000000001'::uuid),
    ('d0ffee00-0000-4000-8000-000000000002'::uuid, 'artur.silvicola@gmail.com', 'Artur Stasiak (trial EN)', 'en', 'c0ffee00-0000-4000-8000-000000000002'::uuid)
  ) as t(id, email, name, locale, company_id)
  loop
    if exists (select 1 from auth.users where lower(email) = r.email and id <> r.id) then
      raise notice 'POMINIĘTO: adres % należy już do innego konta — nic nie nadpisano', r.email;
      continue;
    end if;
    if not exists (select 1 from auth.users where id = r.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
              crypt(gen_random_uuid()::text, gen_salt('bf')), now(), null,
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), r.id, jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
              'email', r.id::text, null, now(), now());
    end if;
    -- trigger handle_new_user mógł utworzyć profil — ustaw rolę, firmę, język, adres
    insert into public.profiles (id, role, name, email, company_id, locale, active)
    values (r.id, 'supplier', r.name, r.email, r.company_id, r.locale, true)
    on conflict (id) do update set role = 'supplier', name = excluded.name, email = excluded.email,
      company_id = excluded.company_id, locale = excluded.locale, active = true;
  end loop;
end $$;

-- kontrola po utworzeniu (oczekiwane 2 wiersze: supplier / active=true / locale pl|en / firma active + preconnect)
select u.email, p.role::text as rola, p.locale, p.active, c.name as firma, c.account_status, c.preconnect_enabled
  from auth.users u join public.profiles p on p.id = u.id left join public.companies c on c.id = p.company_id
 where lower(u.email) in ('spiker.artur@gmail.com', 'artur.silvicola@gmail.com')
 order by u.email;

commit;
