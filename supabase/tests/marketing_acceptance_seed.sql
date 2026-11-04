-- ============================================================================
-- [feat/marketing-activation] SEED ODBIOROWY — WYŁĄCZNIE BAZA TESTOWA
--
-- Fikcyjne firmy, operatorzy, pakiety i wysyłki do odbioru ekranu
-- Marketing → Aktywacja PreConnect. Wszystkie adresy w domenie example.test
-- (RFC 2606 — niedostarczalne), nazwy z przedrostkiem „TEST ”.
--
-- Uruchamiany przez scripts/marketing-test-env.mjs PO migracjach, seed.sql
-- i e2e_create_test_accounts.sql. Skrypt odmawia pracy z produkcyjnym projektem.
-- Idempotentny (stałe UUID + on conflict).
-- ============================================================================
begin;

-- ── firmy (różne segmenty) ───────────────────────────────────────────────────
insert into public.companies (id, name, nip, country, city, categories, products, description, account_status, preconnect_enabled, legacy_supplier_id)
values
  ('a0000000-0000-4000-8000-000000000001', 'TEST Sad Kowalski',        'PL0000000001', 'PL', 'Grójec',   array['owoce'],           'jabłka Gala, gruszki Konferencja', 'Fikcyjny sad — start z kredytami, nic nie wysyłał.', 'active', true,  'sup-t1'),
  ('a0000000-0000-4000-8000-000000000002', 'TEST Warzywa Nowak',       'PL0000000002', 'PL', 'Kalisz',   array['warzywa'],         'pomidory malinowe, ogórki gruntowe', 'Fikcyjny producent — powrót, wysyłał bez odczytów.', 'active', true,  'sup-t2'),
  ('a0000000-0000-4000-8000-000000000003', 'TEST Huerta Garcia',       null,           'ES', 'Almería',  array['owoce','warzywa'], 'naranjas, limones, pimientos', 'Fikcyjny eksporter ES — kredyty + rezerwacje, operator EN.', 'active', true,  'sup-t3'),
  ('a0000000-0000-4000-8000-000000000004', 'TEST Wszystko w toku',     'PL0000000004', 'PL', 'Łódź',     array['owoce'],           'truskawki', 'Fikcyjna — wszystkie kredyty zarezerwowane (tylko czeka).', 'active', true,  'sup-t4'),
  ('a0000000-0000-4000-8000-000000000005', 'TEST Bez kredytów',        'PL0000000005', 'PL', 'Radom',    array['warzywa'],         'kapusta', 'Fikcyjna — prezent wygasł, zero ważnych kredytów.', 'active', true,  'sup-t5'),
  ('a0000000-0000-4000-8000-000000000006', 'TEST Oczekująca',          'PL0000000006', 'PL', 'Płock',    array['owoce'],           'śliwki', 'Fikcyjna — konto czeka na zatwierdzenie.', 'pending_review', false, 'sup-t6'),
  ('a0000000-0000-4000-8000-000000000007', 'TEST Dwóch operatorów',    'PL0000000007', 'PL', 'Toruń',    array['kwiaty'],          'tulipany', 'Fikcyjna — dwa aktywne profile dostawcy (do wyjaśnienia).', 'active', true,  'sup-t7'),
  ('a0000000-0000-4000-8000-000000000008', 'TEST Wypisana',            'PL0000000008', 'PL', 'Opole',    array['owoce'],           'wiśnie', 'Fikcyjna — adres operatora w suppresji.', 'active', true,  'sup-t8'),
  ('a0000000-0000-4000-8000-000000000009', 'ZZZ TEST Dostawca seed',   'PL0000000009', 'PL', 'Test',     array['owoce'],           'test', 'Konto testowe — wykluczone z marketingu po nazwie.', 'active', true,  'sup-t9')
on conflict (id) do update set name = excluded.name, categories = excluded.categories, products = excluded.products,
  account_status = excluded.account_status, preconnect_enabled = excluded.preconnect_enabled, legacy_supplier_id = excluded.legacy_supplier_id;

-- ── operatorzy (auth.users + profiles) ──────────────────────────────────────
-- Hasło wspólne dla kont testowych: TestOperator2026!  (tylko baza testowa)
do $$
declare
  r record;
begin
  for r in select * from (values
    ('b0000000-0000-4000-8000-000000000001'::uuid, 'operator.kowalski@example.test', 'Jan Kowalski (TEST)',   'pl', 'a0000000-0000-4000-8000-000000000001'::uuid),
    ('b0000000-0000-4000-8000-000000000002'::uuid, 'operator.nowak@example.test',    'Anna Nowak (TEST)',     'pl', 'a0000000-0000-4000-8000-000000000002'::uuid),
    ('b0000000-0000-4000-8000-000000000003'::uuid, 'operator.garcia@example.test',   'María García (TEST)',   'en', 'a0000000-0000-4000-8000-000000000003'::uuid),
    ('b0000000-0000-4000-8000-000000000004'::uuid, 'operator.wtoku@example.test',    'Piotr W Toku (TEST)',   'pl', 'a0000000-0000-4000-8000-000000000004'::uuid),
    ('b0000000-0000-4000-8000-000000000005'::uuid, 'operator.bez@example.test',      'Ewa Bez (TEST)',        'pl', 'a0000000-0000-4000-8000-000000000005'::uuid),
    ('b0000000-0000-4000-8000-000000000006'::uuid, 'operator.oczek@example.test',    'Olga Oczek (TEST)',     'pl', 'a0000000-0000-4000-8000-000000000006'::uuid),
    ('b0000000-0000-4000-8000-000000000007'::uuid, 'operator.dwa.a@example.test',    'Adam Dwa (TEST)',       'pl', 'a0000000-0000-4000-8000-000000000007'::uuid),
    ('b0000000-0000-4000-8000-000000000017'::uuid, 'operator.dwa.b@example.test',    'Beata Dwa (TEST)',      'pl', 'a0000000-0000-4000-8000-000000000007'::uuid),
    ('b0000000-0000-4000-8000-000000000008'::uuid, 'operator.wypisana@example.test', 'Zofia Wypis (TEST)',    'pl', 'a0000000-0000-4000-8000-000000000008'::uuid),
    ('b0000000-0000-4000-8000-000000000009'::uuid, 'operator.zzz@example.test',      'ZZZ Operator (TEST)',   'pl', 'a0000000-0000-4000-8000-000000000009'::uuid)
  ) as t(id, email, name, locale, company_id)
  loop
    if not exists (select 1 from auth.users where id = r.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
              crypt('TestOperator2026!', gen_salt('bf')), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), r.id, jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
              'email', r.id::text, now(), now(), now());
    end if;
    -- trigger handle_new_user mógł utworzyć profil — ustaw rolę, firmę, język, adres
    insert into public.profiles (id, role, name, email, company_id, locale, active)
    values (r.id, 'supplier', r.name, r.email, r.company_id, r.locale, true)
    on conflict (id) do update set role = 'supplier', name = excluded.name, email = excluded.email,
      company_id = excluded.company_id, locale = excluded.locale, active = true;
  end loop;
end $$;

-- ── pakiety (saldo = jak company_capacity) ──────────────────────────────────
-- Przyznania muszą spełniać packages_grant_fields_check (powód, partia, czas, autor) — jak prawdziwe
-- przyznania z panelu; zakupy bez pól przyznania. Jedna partia seedowa, idempotentna po kluczu.
delete from public.packages where company_id in (select id from public.companies where name like 'TEST %' or name = 'ZZZ TEST Dostawca seed');
do $$
declare
  v_admin uuid := coalesce((select id from public.profiles where email = 'codex.admin@freshmarket.test' limit 1), 'c0000000-0000-4000-8000-000000000001'::uuid);
  v_batch uuid;
begin
  insert into public.package_grant_batches (idempotency_key, created_by, qty, reason, message, note, expires_at, company_ids, company_count)
  values ('seed-marketing-acceptance', v_admin, 5, 'registration', 'Seed odbiorowy (baza testowa)', 'marketing_acceptance_seed.sql', (current_date + 45)::date,
          array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000009']::uuid[], 8)
  on conflict (idempotency_key) do update set note = excluded.note
  returning id into v_batch;
  insert into public.packages (company_id, plan, qty_total, qty_used, source, expires_at, purchased_at, grant_reason, grant_batch_id, granted_at, granted_by)
  values
    ('a0000000-0000-4000-8000-000000000001', 'grant_5', 5, 0, 'grant', (current_date + 20)::date, now(), 'registration', v_batch, now(), v_admin),  -- wygasa za 20 dni → ostrzeżenie
    ('a0000000-0000-4000-8000-000000000002', 'grant_5', 5, 2, 'grant', (current_date + 60)::date, now(), 'registration', v_batch, now(), v_admin),
    ('a0000000-0000-4000-8000-000000000003', 'grant_5', 5, 1, 'grant', (current_date + 45)::date, now(), 'registration', v_batch, now(), v_admin),
    ('a0000000-0000-4000-8000-000000000004', 'grant_5', 5, 0, 'grant', (current_date + 45)::date, now(), 'registration', v_batch, now(), v_admin),
    ('a0000000-0000-4000-8000-000000000005', 'grant_5', 5, 0, 'grant', (current_date - 10)::date, now() - interval '100 days', 'registration', v_batch, now() - interval '100 days', v_admin),  -- wygasły
    ('a0000000-0000-4000-8000-000000000007', 'grant_5', 5, 0, 'grant', (current_date + 45)::date, now(), 'registration', v_batch, now(), v_admin),
    ('a0000000-0000-4000-8000-000000000008', 'grant_5', 5, 0, 'grant', (current_date + 45)::date, now(), 'registration', v_batch, now(), v_admin),
    ('a0000000-0000-4000-8000-000000000009', 'grant_5', 5, 0, 'grant', (current_date + 45)::date, now(), 'registration', v_batch, now(), v_admin);
  -- zakup (pakiet Standard) dla firmy „powrót"
  insert into public.packages (company_id, plan, qty_total, qty_used, source, expires_at, purchased_at, price_paid, currency)
  values ('a0000000-0000-4000-8000-000000000002', 'std_10', 10, 0, 'purchase', (current_date + 300)::date, now(), 0, 'EUR');
end $$;

-- ── wysyłki (rezerwacje / odczyty) ──────────────────────────────────────────
delete from public.legacy_sends where supplier_legacy_id in ('sup-t2','sup-t3','sup-t4');
insert into public.legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data, created_at, updated_at)
values
  (770001, 'sup-t2', null, 100, 'unread_expired', '{"supplierId":"sup-t2","status":"unread_expired"}', now() - interval '40 days', now() - interval '26 days'),
  (770002, 'sup-t2', null, 101, 'sent',           '{"supplierId":"sup-t2","status":"sent"}',           now() - interval '5 days',  now() - interval '5 days'),
  (770003, 'sup-t2', null, 102, 'read',           '{"supplierId":"sup-t2","status":"read","billingStatus":"charged"}', now() - interval '20 days', now() - interval '18 days'),
  (770004, 'sup-t3', null, 100, 'approved',       '{"supplierId":"sup-t3","status":"approved"}',       now() - interval '2 days',  now() - interval '2 days'),
  (770005, 'sup-t4', null, 100, 'sent',           '{"supplierId":"sup-t4","status":"sent"}',           now() - interval '3 days',  now() - interval '3 days'),
  (770006, 'sup-t4', null, 101, 'sent',           '{"supplierId":"sup-t4","status":"sent"}',           now() - interval '3 days',  now() - interval '3 days'),
  (770007, 'sup-t4', null, 102, 'pending_moderation', '{"supplierId":"sup-t4","status":"pending_moderation"}', now() - interval '1 day', now() - interval '1 day'),
  (770008, 'sup-t4', null, 103, 'sent',           '{"supplierId":"sup-t4","status":"sent"}',           now() - interval '3 days',  now() - interval '3 days'),
  (770009, 'sup-t4', null, 104, 'sent',           '{"supplierId":"sup-t4","status":"sent"}',           now() - interval '3 days',  now() - interval '3 days');

-- ── wypis (suppresja) ───────────────────────────────────────────────────────
insert into public.marketing_suppressions (email, reason, source)
values ('operator.wypisana@example.test', 'unsubscribe', 'seed-test')
on conflict (email) do nothing;

commit;
