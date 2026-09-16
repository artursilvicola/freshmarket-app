-- ============================================================================
-- 055_security_hotfix_test.sql — testy SQL hotfixu bezpieczeństwa (054 + 055)
-- Uruchomienie (TYLKO baza testowa, nigdy produkcja):
--   DATABASE_URL=… node scripts/fm-queue-sql-test.mjs --shim --test 053,055 --reapply 054,055
-- Cała transakcja kończy się ROLLBACK — nic nie zostaje w bazie.
-- Wymaga: migracje 001–055, trigger handle_new_user na auth.users.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('admin', gen_random_uuid()), ('sup1', gen_random_uuid()), ('sup2', gen_random_uuid()),
  ('sup3', gen_random_uuid()), ('sup4', gen_random_uuid()), ('noprof', gen_random_uuid()),
  ('buyer1', gen_random_uuid()), ('buyer2', gen_random_uuid()), ('buyer3', gen_random_uuid()),
  ('co1', gen_random_uuid()), ('co2', gen_random_uuid()), ('co3', gen_random_uuid()), ('co4', gen_random_uuid());
GRANT ALL ON t_ids TO anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT v FROM t_ids t WHERE t.k = id.k); END $$;
CREATE OR REPLACE FUNCTION pg_temp.login(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(k), 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', pg_temp.id(k)::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_passed boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_passed := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_code || '%' THEN
      RAISE EXCEPTION 'TEST FAIL: oczekiwano bledu [%], dostano [%] dla: %', p_code, SQLERRM, p_sql;
    END IF;
  END;
  IF v_passed THEN RAISE EXCEPTION 'TEST FAIL: oczekiwano bledu [%], a instrukcja PRZESZLA: %', p_code, p_sql; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'TEST FAIL: %', p_msg; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.contact(rid integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN RETURN (SELECT coalesce(buyer_name,'-') || '|' || coalesce(buyer_email,'-') || '|' || coalesce(buyer_phone,'-') FROM public.retailer_contacts WHERE retailer_id = rid); END $$;

-- ── T0 obiekty ───────────────────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fm_my_schedule','fm_set_company_targets','fm_inputs_are_locked','fm_backup_inputs','admin_set_retailer_contact','fm_is_privileged_session','fm_inputs_write_check','fm_is_server_session','fm_inputs_lock_for_write')) = 9, 'T0 funkcje 055 istnieja');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'company_target_retailers' AND policyname IN ('ctr_supplier_own', 'ctr_admin_all')) = 0 AND (SELECT count(*) FROM pg_policies WHERE tablename = 'company_target_retailers' AND cmd <> 'SELECT') = 0, 'T0 company_target_retailers: same polityki SELECT (zapis tylko przez RPC, takze admin)');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_profiles_guard_protected','trg_companies_guard_protected','trg_ctr_phase_lock','trg_fm_resps_phase_lock','trg_retailers_route_buyer_contacts','trg_retailers_clear_buyer_contacts','trg_fm_settings_route_schedule')) = 7, 'T0 triggery 055 istnieja');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'fm_prefs' AND policyname = 'fm_prefs_select_role_based') = 0, 'T0 polityka 002 fm_prefs_select_role_based usunieta');
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.columns WHERE table_name = 'fm_settings' AND column_name = 'selection_deadline') = 1, 'T0 fm_settings.selection_deadline');

-- ── fixtures ────────────────────────────────────────────────────────────────
-- powiadomienie mailowe po odpowiedzi kupca (pg_net; trigger istnieje tylko na produkcji) nie jest przedmiotem testu
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fm_trigger_fm_resps_email' AND tgrelid = 'public.fm_resps'::regclass) THEN
    EXECUTE 'ALTER TABLE public.fm_resps DISABLE TRIGGER fm_trigger_fm_resps_email';
  END IF;
END $$;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(),
       CASE k WHEN 'admin' THEN '{"provider":"email","role":"admin"}'::jsonb ELSE '{"provider":"email"}'::jsonb END,
       '{}'::jsonb
FROM t_ids WHERE k IN ('admin','sup1','sup2','sup3','sup4','noprof','buyer1','buyer2','buyer3');
UPDATE public.profiles SET role = 'admin' WHERE id = pg_temp.id('admin');
DELETE FROM public.profiles WHERE id = pg_temp.id('noprof');   -- konto Auth bez profilu (jak sieroty z audytu)
INSERT INTO public.companies (id, name, fm_b2b_enabled, account_status, fm_b2b_tier, fm_b2b_packages) VALUES
  (pg_temp.id('co1'), 'TEST Firma 1', true, 'active', 'business', 1),
  (pg_temp.id('co2'), 'TEST Firma 2', true, 'active', 'premium', 2),
  (pg_temp.id('co3'), 'TEST Firma 3', true, 'active', 'business', 1),
  (pg_temp.id('co4'), 'TEST Firma 4 (zawieszona)', true, 'suspended', 'business', 1);
UPDATE public.profiles SET company_id = pg_temp.id('co1'), role = 'supplier' WHERE id = pg_temp.id('sup1');
UPDATE public.profiles SET company_id = pg_temp.id('co2'), role = 'supplier' WHERE id = pg_temp.id('sup2');
UPDATE public.profiles SET company_id = pg_temp.id('co3'), role = 'supplier', active = false WHERE id = pg_temp.id('sup3');
UPDATE public.profiles SET company_id = pg_temp.id('co4'), role = 'supplier' WHERE id = pg_temp.id('sup4');
INSERT INTO public.retailers (id, name, fm26_active, fm26_chain_id, buyer_name, buyer_email, buyer_phone) VALUES
  (990101, 'TEST Siec A', true, 'test-a', 'Anna Test', 'anna@siec-a.test', '+48 600 000 001'),
  (990102, 'TEST Siec B', true, 'test-b', NULL, NULL, NULL),
  (990103, 'TEST Siec C (bez FM)', false, 'test-c', NULL, NULL, NULL);
UPDATE public.profiles SET role = 'buyer', retailer_id = 990101, fm26_active = true WHERE id = pg_temp.id('buyer1');
UPDATE public.profiles SET role = 'buyer', retailer_id = 990102, fm26_active = true WHERE id = pg_temp.id('buyer2');
UPDATE public.profiles SET role = 'buyer', retailer_id = 990103, fm26_active = true WHERE id = pg_temp.id('buyer3');
INSERT INTO public.fm_settings (algo_phase, event_date) SELECT 'preferences_open', '2026-09-24'
  WHERE NOT EXISTS (SELECT 1 FROM public.fm_settings);
UPDATE public.fm_settings SET algo_phase = 'preferences_open', schedule = NULL, selection_deadline = NULL;
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES
  (pg_temp.id('co2'), 990101, 1000, 'chain:test-a');

-- ── T1 kontakty kupców ───────────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT buyer_email FROM public.retailers WHERE id = 990101) IS NULL, 'T1 trigger po insert wyczyscil retailers.buyer_email');
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Anna Test|anna@siec-a.test|+48 600 000 001', 'T1 kontakt przeniesiony do retailer_contacts');
-- most zgodnosci: zmiana JEDNEGO pola nie kasuje pozostalych (review P1)
UPDATE public.retailers SET buyer_phone = '+48 600 000 002' WHERE id = 990101;
SELECT pg_temp.ok((SELECT buyer_phone FROM public.retailers WHERE id = 990101) IS NULL, 'T1 update telefonu: kolumna w retailers pusta');
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Anna Test|anna@siec-a.test|+48 600 000 002', 'T1 update tylko telefonu zachowuje nazwisko i e-mail');
UPDATE public.retailers SET buyer_email = 'anna2@siec-a.test' WHERE id = 990101;
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Anna Test|anna2@siec-a.test|+48 600 000 002', 'T1 update tylko e-maila zachowuje reszte');
UPDATE public.retailers SET buyer_name = 'Anna Nowak' WHERE id = 990101;
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Anna Nowak|anna2@siec-a.test|+48 600 000 002', 'T1 update tylko nazwiska zachowuje reszte');
UPDATE public.retailers SET name = 'TEST Siec A2', buyer_name = '', buyer_email = '', buyer_phone = '' WHERE id = 990101;  -- jak toRetailerDbRow bez kontaktu
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Anna Nowak|anna2@siec-a.test|+48 600 000 002', 'T1 update nazwy sieci z pustymi buyer_* nie kasuje kontaktu');
UPDATE public.retailers SET buyer_name = 'Beata Test', buyer_email = 'beata@siec-a.test', buyer_phone = '+48 700' WHERE id = 990101;
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Beata Test|beata@siec-a.test|+48 700', 'T1 pelny zapis zastepuje wszystkie pola');
-- jawny zapis/kasowanie przez admina
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT public.admin_set_retailer_contact(990101, 'Beata Test', NULL, '+48 700');
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Beata Test|-|+48 700', 'T1 admin RPC: swiadome wyczyszczenie e-maila');
SELECT public.admin_set_retailer_contact(990102, 'Cezary Test', 'c@siec-b.test', '');
SELECT pg_temp.ok(pg_temp.contact(990102) = 'Cezary Test|c@siec-b.test|-', 'T1 admin RPC: nowy kontakt dla sieci B');
SELECT public.admin_set_retailer_contact(990102, '', NULL, '');
SELECT pg_temp.ok(pg_temp.contact(990102) IS NULL, 'T1 admin RPC: same puste = usuniecie kontaktu');
SELECT pg_temp.expect_error('SELECT public.admin_set_retailer_contact(999999, ''x'', NULL, NULL)', 'nie ma sieci');
RESET ROLE;
-- widocznosc
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.retailers WHERE id IN (990101, 990102, 990103)) = 3, 'T1 dostawca nadal widzi liste sieci');
SELECT pg_temp.ok((SELECT count(*) FROM public.retailer_contacts) = 0, 'T1 dostawca nie widzi zadnych kontaktow kupcow');
SELECT pg_temp.ok((SELECT count(*) FROM public.profiles WHERE role = 'buyer') = 0, 'T1 dostawca nie widzi profili kupcow');
SELECT pg_temp.expect_error('INSERT INTO public.retailer_contacts (retailer_id, buyer_email) VALUES (990102, ''x@x.test'')', 'row-level security');
SELECT pg_temp.expect_error('SELECT public.admin_set_retailer_contact(990101, ''h'', ''h@x.test'', NULL)', 'administrator');
SELECT pg_temp.expect_error('SELECT public.retailer_contacts_merge(990101, ''h'', ''h@x.test'', NULL)', 'permission denied');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.retailer_contacts) = 0, 'T1 kupiec nie widzi kontaktow');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.contact(990101) = 'Beata Test|-|+48 700', 'T1 admin widzi kontakty');
RESET ROLE;

-- ── T2 anon: widoki (054) i tabele ───────────────────────────────────────────
SELECT pg_temp.login(NULL);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.consent_audit', 'permission denied');
SELECT pg_temp.expect_error('DELETE FROM public.consent_audit WHERE id = ''00000000-0000-0000-0000-000000000000''', 'permission denied');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_capacity) = 0, 'T2 anon: company_capacity pusty (security_invoker + RLS companies)');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.retailer_contacts', 'permission denied');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_plan_private', 'permission denied');
SELECT pg_temp.ok((SELECT schedule FROM public.fm_settings ORDER BY updated_at DESC LIMIT 1) IS NULL, 'T2 anon: fm_settings.schedule = null');
SELECT pg_temp.ok((SELECT count(*) FROM public.retailers) = 0, 'T2 anon: retailers bez polityki = pusto');
RESET ROLE;
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('DELETE FROM public.consent_audit WHERE id = ''00000000-0000-0000-0000-000000000000''', 'permission denied');
SELECT pg_temp.ok((SELECT count(*) FROM public.consent_audit WHERE id <> pg_temp.id('sup1')) = 0, 'T2 dostawca: consent_audit co najwyzej wlasny wiersz');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_capacity WHERE id = pg_temp.id('co1')) = 1, 'T2 dostawca: company_capacity wlasnej firmy dziala');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.consent_audit) >= 0 AND (SELECT count(*) FROM public.company_capacity WHERE id IN (pg_temp.id('co1'), pg_temp.id('co2'))) = 2, 'T2 admin: legalny odczyt widokow dziala');
RESET ROLE;

-- ── T3 fm_prefs: dostawca nie czyta preferencji kupcow ───────────────────────
INSERT INTO public.fm_prefs (retailer_id, prefs) VALUES (990101, '{"x":1}'::jsonb);
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_prefs) = 0, 'T3 dostawca: fm_prefs pusto (polityka 002 usunieta)');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_prefs) = 1, 'T3 kupiec: widzi wlasne fm_prefs');
RESET ROLE;
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_prefs) = 0, 'T3 kupiec innej sieci: nie widzi cudzych fm_prefs');
RESET ROLE;

-- ── T4 triggery ochronne ─────────────────────────────────────────────────────
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
UPDATE public.companies SET fm_b2b_tier = 'premium', fm_b2b_packages = 9, account_status = 'active', pkg_plan = 'prem_10',
       approved_at = now(), fm_b2b_enabled = true, preconnect_enabled = true, city = 'Poznan', completeness = 77,
       profile_data = '{"ok":true}'::jsonb, fm_selection_confirmed_at = now(), ai_review_status = 'approved'
 WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT fm_b2b_tier FROM public.companies WHERE id = pg_temp.id('co1')) = 'business', 'T4 fm_b2b_tier bez zmian');
SELECT pg_temp.ok((SELECT fm_b2b_packages FROM public.companies WHERE id = pg_temp.id('co1')) = 1, 'T4 fm_b2b_packages bez zmian');
SELECT pg_temp.ok((SELECT pkg_plan FROM public.companies WHERE id = pg_temp.id('co1')) IS NULL, 'T4 pkg_plan bez zmian');
SELECT pg_temp.ok((SELECT preconnect_enabled FROM public.companies WHERE id = pg_temp.id('co1')) = false, 'T4 preconnect_enabled bez zmian');
SELECT pg_temp.ok((SELECT city FROM public.companies WHERE id = pg_temp.id('co1')) = 'Poznan', 'T4 zapis profilu firmy (city) przeszedl');
SELECT pg_temp.ok((SELECT completeness FROM public.companies WHERE id = pg_temp.id('co1')) = 77, 'T4 completeness zapisane');
SELECT pg_temp.ok((SELECT fm_selection_confirmed_at FROM public.companies WHERE id = pg_temp.id('co1')) IS NOT NULL, 'T4 fm_selection_confirmed_at zapisane');
SELECT pg_temp.ok((SELECT ai_review_status FROM public.companies WHERE id = pg_temp.id('co1')) = 'approved', 'T4 ai_review_status (profil) zapisane');
-- produkcja ma companies_insert_authenticated (kazdy zalogowany), migracje 001–053 tylko companies_insert_admin:
-- w obu stanach nowa firma dostawcy nie moze wejsc z pakietem/statusem (RLS odrzuca ALBO trigger przywraca domyslne)
DO $$ BEGIN
  INSERT INTO public.companies (id, name, fm_b2b_enabled, fm_b2b_tier, account_status, pkg_plan) VALUES (gen_random_uuid(), 'TEST Nowa', true, 'premium', 'active', 'prem_10');
  PERFORM pg_temp.ok((SELECT fm_b2b_enabled = false AND fm_b2b_tier = 'business' AND account_status = 'pending_review' AND pkg_plan IS NULL FROM public.companies WHERE name = 'TEST Nowa'), 'T4 insert firmy przez dostawce: wartosci domyslne');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'TEST T4 insert firmy przez dostawce: odrzucony przez RLS (stan z migracji) — OK';
END $$;
UPDATE public.profiles SET name = 'Jan Test', phone = '123', position = 'Handlowiec', company_id = pg_temp.id('co2'), active = false, fm26_active = true, locale = 'en'
 WHERE id = pg_temp.id('sup1');
SELECT pg_temp.ok((SELECT name = 'Jan Test' AND phone = '123' AND locale = 'en' FROM public.profiles WHERE id = pg_temp.id('sup1')), 'T4 Moj profil zapisany');
SELECT pg_temp.ok((SELECT company_id = pg_temp.id('co1') AND active = true AND fm26_active = false FROM public.profiles WHERE id = pg_temp.id('sup1')), 'T4 company_id/active/fm26_active bez zmian');
SELECT pg_temp.expect_error('UPDATE public.profiles SET role = ''admin'' WHERE id = ''' || pg_temp.id('sup1') || '''', '');  -- dowolny blad (trigger 033)
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET name = 'Anna Test 2', retailer_id = 990102, buyer_categories = '{owoce}' WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.ok((SELECT retailer_id = 990101 AND name = 'Anna Test 2' AND buyer_categories = '{}' FROM public.profiles WHERE id = pg_temp.id('buyer1')), 'T4 kupiec: retailer_id/buyer_categories bez zmian, name zapisane');
RESET ROLE;
-- konto Auth bez profilu (review P1): self-INSERT nie moze przypisac firmy/sieci ani roli kupca
SELECT pg_temp.login('noprof');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('INSERT INTO public.profiles (id, email, role) VALUES (''' || pg_temp.id('noprof') || ''', ''noprof@test.local'', ''admin'')', 'administrator');
SELECT pg_temp.expect_error('INSERT INTO public.profiles (id, email, role, admin_level) VALUES (''' || pg_temp.id('noprof') || ''', ''noprof@test.local'', ''supplier'', ''super'')', 'administrator');
INSERT INTO public.profiles (id, email, role, retailer_id, company_id, active, fm26_active, buyer_categories)
VALUES (pg_temp.id('noprof'), 'noprof@test.local', 'buyer', 990101, pg_temp.id('co2'), true, true, '{owoce}');
SELECT pg_temp.ok((SELECT role::text = 'supplier' AND retailer_id IS NULL AND company_id IS NULL AND fm26_active = false AND buyer_categories = '{}' FROM public.profiles WHERE id = pg_temp.id('noprof')), 'T4 self-INSERT profilu: zwykly dostawca bez firmy/sieci');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_prefs) = 0 AND (SELECT count(*) FROM public.company_target_retailers) = 0, 'T4 self-INSERT nie daje dostepu do danych sieci ani cudzej firmy');
RESET ROLE;
-- admin i sesje uprzywilejowane bez przeszkod
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.companies SET fm_b2b_tier = 'premium', fm_b2b_packages = 3 WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT fm_b2b_tier = 'premium' AND fm_b2b_packages = 3 FROM public.companies WHERE id = pg_temp.id('co1')), 'T4 admin zmienia pakiet');
UPDATE public.profiles SET fm26_active = false WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.ok((SELECT fm26_active FROM public.profiles WHERE id = pg_temp.id('buyer1')) = false, 'T4 admin zmienia fm26_active');
UPDATE public.profiles SET fm26_active = true WHERE id = pg_temp.id('buyer1');
RESET ROLE;
SELECT pg_temp.ok(public.fm_is_privileged_session(), 'T4 sesja postgres (security definer / SQL Editor / pg_cron) = uprzywilejowana');
DELETE FROM public.profiles WHERE id = pg_temp.id('noprof');

-- ── T5 plan: fm_plan_private + fm_my_schedule ────────────────────────────────
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.fm_settings SET schedule = jsonb_build_object(
  'res', jsonb_build_object(pg_temp.id('co1')::text, '{"m":["test-a"],"r":{"test-a":5}}'::jsonb,
                            pg_temp.id('co2')::text, '{"m":["test-a","test-b"],"r":{"test-a":4,"test-b":3}}'::jsonb,
                            pg_temp.id('co3')::text, '{"m":["test-b"],"r":{"test-b":2}}'::jsonb,
                            pg_temp.id('co4')::text, '{"m":["test-a"],"r":{"test-a":1}}'::jsonb),
  'nums', jsonb_build_object(pg_temp.id('co1')::text, '{"test-a":1}'::jsonb, pg_temp.id('co2')::text, '{"test-a":2,"test-b":1}'::jsonb,
                             pg_temp.id('co3')::text, '{"test-b":2}'::jsonb, pg_temp.id('co4')::text, '{"test-a":3}'::jsonb),
  'cs', '{}'::jsonb, 'cq', '{}'::jsonb, 'warnings', '[]'::jsonb);
SELECT pg_temp.ok((SELECT schedule FROM public.fm_settings ORDER BY updated_at DESC LIMIT 1) IS NULL, 'T5 fm_settings.schedule nadal null (trigger)');
SELECT pg_temp.ok((SELECT schedule->'res' ? pg_temp.id('co2')::text FROM public.fm_plan_private WHERE id = 1), 'T5 plan trafil do fm_plan_private');
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text AND public.fm_my_schedule() ? 'warnings', 'T5 admin: pelny plan z RPC');
RESET ROLE;
-- przed publikacja: nikt poza adminem
SELECT pg_temp.login('sup2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 dostawca przed publikacja: null');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_plan_private) = 0, 'T5 dostawca: fm_plan_private niewidoczne');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 kupiec przed publikacja: null');
RESET ROLE;
UPDATE public.fm_settings SET algo_phase = 'published';
-- dostawca A (co1) i B (co2): klucz po kluczu
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.fm_my_schedule()->'res') k) = ARRAY[pg_temp.id('co1')::text], 'T5 dostawca A: dokladnie jeden klucz res = co1');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums') = jsonb_build_object(pg_temp.id('co1')::text, '{"test-a":1}'::jsonb), 'T5 dostawca A: nums dokladnie wlasne');
RESET ROLE;
SELECT pg_temp.login('sup2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.fm_my_schedule()->'res') k) = ARRAY[pg_temp.id('co2')::text], 'T5 dostawca B: dokladnie jeden klucz res = co2');
SELECT pg_temp.ok((public.fm_my_schedule()->'res'->(pg_temp.id('co2')::text)->'m') = '["test-a","test-b"]'::jsonb, 'T5 dostawca B: wlasne spotkania w calosci');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums') = jsonb_build_object(pg_temp.id('co2')::text, '{"test-a":2,"test-b":1}'::jsonb), 'T5 dostawca B: nums dokladnie wlasne');
SELECT pg_temp.ok(NOT (public.fm_my_schedule() ? 'warnings') AND NOT (public.fm_my_schedule() ? 'cs'), 'T5 dostawca: bez cs/cq/warnings');
RESET ROLE;
-- konta bez prawa udzialu (review P1): nieaktywny profil, zawieszona firma
SELECT pg_temp.login('sup3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 nieaktywny profil dostawcy: null mimo publikacji');
RESET ROLE;
SELECT pg_temp.login('sup4');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 zawieszona firma: null mimo publikacji');
RESET ROLE;
UPDATE public.companies SET fm_b2b_enabled = false WHERE id = pg_temp.id('co1');
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 firma bez fm_b2b_enabled: null');
RESET ROLE;
UPDATE public.companies SET fm_b2b_enabled = true WHERE id = pg_temp.id('co1');
-- kupiec X (test-a) i Y (test-b): klucz po kluczu, numer po numerze
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.fm_my_schedule()->'res') k)
                  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.id('co1')::text, pg_temp.id('co2')::text, pg_temp.id('co4')::text]) x), 'T5 kupiec X: dokladnie firmy z test-a (co1, co2, co4)');
SELECT pg_temp.ok((public.fm_my_schedule()->'res'->(pg_temp.id('co2')::text)) = '{"m":["test-a"]}'::jsonb, 'T5 kupiec X: co2 tylko m=[test-a], bez test-b i bez r');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums') = jsonb_build_object(pg_temp.id('co1')::text, '{"test-a":1}'::jsonb, pg_temp.id('co2')::text, '{"test-a":2}'::jsonb, pg_temp.id('co4')::text, '{"test-a":3}'::jsonb), 'T5 kupiec X: nums dokladnie wlasnego chainu');
RESET ROLE;
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.fm_my_schedule()->'res') k)
                  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.id('co2')::text, pg_temp.id('co3')::text]) x), 'T5 kupiec Y: dokladnie firmy z test-b (co2, co3)');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums') = jsonb_build_object(pg_temp.id('co2')::text, '{"test-b":1}'::jsonb, pg_temp.id('co3')::text, '{"test-b":2}'::jsonb), 'T5 kupiec Y: nums dokladnie wlasnego chainu');
RESET ROLE;
SELECT pg_temp.login('buyer3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 kupiec sieci bez fm26_active: null');
RESET ROLE;
-- dwoch kupcow tej samej sieci z rozna flaga udzialu (review P2/5): bez wlasnej flagi brak planu
UPDATE public.profiles SET fm26_active = false WHERE id = pg_temp.id('buyer2');
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 kupiec bez wlasnej flagi fm26_active: null (siec aktywna, faza published)');
RESET ROLE;
UPDATE public.profiles SET fm26_active = true WHERE id = pg_temp.id('buyer2');
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text, 'T5 ten sam kupiec z flaga fm26_active: plan wraca');
RESET ROLE;
UPDATE public.profiles SET active = false WHERE id = pg_temp.id('buyer2');
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.fm_my_schedule() IS NULL, 'T5 nieaktywny profil kupca: null');
RESET ROLE;
UPDATE public.profiles SET active = true WHERE id = pg_temp.id('buyer2');
UPDATE public.fm_settings SET algo_phase = 'preferences_open';

-- ── T6 atomowy zapis wyborow + blokada fazy/terminu + kopia ──────────────────
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'),
  '[{"retailer_id":990101,"priority":1000,"note":"chain:test-a"},{"retailer_id":990102,"priority":100,"note":"chain:test-b"},{"retailer_id":990102,"priority":1000}]'::jsonb)) = 2,
  'T6 RPC: zapis 2 sieci (duplikat scalony)');
SELECT pg_temp.ok((SELECT priority FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1') AND retailer_id = 990102) = 1000, 'T6 RPC: duplikat -> max priority');
SELECT pg_temp.ok((SELECT count(*) FROM pg_locks WHERE relation = 'public.companies'::regclass AND mode = 'RowShareLock' AND pid = pg_backend_pid()) >= 1, 'T6 RPC trzyma blokade wiersza firmy (FOR UPDATE) do konca transakcji');
-- stary bundle (DELETE + INSERT wprost, review P1): DELETE nie trafia w wiersze (RLS), INSERT odrzucony — nic nie ginie
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 stary klient: bezposredni DELETE bez efektu (RLS)');
SELECT pg_temp.expect_error('INSERT INTO public.company_target_retailers (company_id, retailer_id, priority) VALUES (''' || pg_temp.id('co1') || ''', 990103, 100)', 'row-level security');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 stary klient: lista nietknieta');
RESET ROLE;
-- stary bundle w sesji ADMINA (podglad konta dostawcy, review P1/3): tak samo bez efektu; admin zapisuje tylko przez RPC
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 admin czyta wybory firmy');
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 stary klient admina: bezposredni DELETE bez efektu (RLS)');
SELECT pg_temp.expect_error('INSERT INTO public.company_target_retailers (company_id, retailer_id, priority) VALUES (''' || pg_temp.id('co1') || ''', 990103, 100)', 'row-level security');
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[{"retailer_id":990101,"priority":1000,"note":"chain:test-a"},{"retailer_id":990102,"priority":100,"note":"chain:test-b"}]'::jsonb)) = 2, 'T6 admin zapisuje wybory firmy przez RPC');
RESET ROLE;
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co2') || ''', ''[]''::jsonb)', 'brak uprawnie');
RESET ROLE;  -- wiersze cudzej firmy sprawdzamy jako postgres (RLS ukrywa je przed sup1)
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co2')) = 1, 'T6 RPC: cudza firma nietknieta');
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[{"retailer_id":990101,"priority":1000},{"retailer_id":123456789,"priority":1000}]''::jsonb)', 'nieznana sie');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 RPC: bledna lista = stara lista zostaje w calosci (atomowo)');
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''{"a":1}''::jsonb)', 'tablic');
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[{"retailer_id":"990101","priority":"1000"}]'::jsonb)) = 1, 'T6 RPC: nowa lista zastepuje stara');
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[]'::jsonb)) = 0, 'T6 RPC: pusta lista = brak wyborow');
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[{"retailer_id":990101,"priority":1000,"note":"chain:test-a"},{"retailer_id":990102,"priority":100}]'::jsonb)) = 2, 'T6 RPC: ponowny zapis 2 sieci');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[]''::jsonb)', 'brak uprawnie');
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990101, pg_temp.id('co1'), 'green', 'green', '{}'::jsonb);
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_resps WHERE retailer_id = 990101) = 1, 'T6 faza otwarta: kupiec odpowiada');
-- odpowiedz kupca trzyma blokade FOR SHARE na fm_settings do konca transakcji (zamkniecie fazy czeka na odpowiedzi w toku)
SELECT pg_temp.ok((SELECT count(*) FROM pg_locks WHERE relation = 'public.fm_settings'::regclass AND mode = 'RowShareLock' AND pid = pg_backend_pid()) >= 1, 'T6 odpowiedz kupca: RowShareLock na fm_settings');
SELECT pg_temp.ok((SELECT count(*) FROM pg_locks WHERE relation = 'public.retailers'::regclass AND mode = 'RowShareLock' AND pid = pg_backend_pid()) >= 1, 'T6 odpowiedz kupca: RowShareLock na retailers (wlasna siec)');
RESET ROLE;
-- prawo udzialu (review P1/3): nieaktywny profil, zawieszona firma, firma poza FM, nieaktywny admin, kupiec bez udzialu
SELECT pg_temp.login('sup3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co3') || ''', ''[{"retailer_id":990101,"priority":1000}]''::jsonb)', 'fm_inputs_forbidden');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co3')) = 0, 'T6 nieaktywny profil dostawcy: nic nie zapisane');
SELECT pg_temp.login('sup4');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co4') || ''', ''[{"retailer_id":990101,"priority":1000}]''::jsonb)', 'fm_inputs_forbidden');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co4')) = 0, 'T6 zawieszona firma: nic nie zapisane');
UPDATE public.companies SET fm_b2b_enabled = false WHERE id = pg_temp.id('co1');
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[]''::jsonb)', 'fm_inputs_forbidden');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 firma poza FM: dotychczasowe wybory NIE sa kasowane, tylko zapis zablokowany');
UPDATE public.companies SET fm_b2b_enabled = true WHERE id = pg_temp.id('co1');
UPDATE public.profiles SET active = false WHERE id = pg_temp.id('admin');
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[]''::jsonb)', 'fm_inputs_forbidden');
RESET ROLE;
UPDATE public.profiles SET active = true WHERE id = pg_temp.id('admin');
UPDATE public.profiles SET active = false WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('UPDATE public.fm_resps SET zone = ''red'' WHERE retailer_id = 990101', 'fm_inputs_forbidden');
SELECT pg_temp.expect_error('INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990101, ''' || pg_temp.id('co2') || ''', ''green'', ''green'', ''{}''::jsonb)', 'fm_inputs_forbidden');
RESET ROLE;
UPDATE public.profiles SET active = true, fm26_active = false WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('UPDATE public.fm_resps SET zone = ''red'' WHERE retailer_id = 990101', 'fm_inputs_forbidden');
RESET ROLE;
UPDATE public.profiles SET fm26_active = true WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.ok((SELECT zone FROM public.fm_resps WHERE retailer_id = 990101) = 'green' AND (SELECT count(*) FROM public.fm_resps WHERE retailer_id = 990101) = 1, 'T6 odpowiedz kupca nietknieta po odmowach');
-- zamkniecie fazy
UPDATE public.fm_settings SET algo_phase = 'matching';
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[]''::jsonb)', 'fm_inputs_locked');
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1');  -- stary klient: 0 wierszy (RLS), bez bledu
SELECT pg_temp.expect_error('INSERT INTO public.company_target_retailers (company_id, retailer_id, priority) VALUES (''' || pg_temp.id('co1') || ''', 990103, 1000)', 'fm_inputs_locked');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 wybory nietkniete po zablokowaniu (RPC i bezposrednio)');
UPDATE public.companies SET fm_selection_confirmed_at = now() WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT fm_selection_confirmed_at FROM public.companies WHERE id = pg_temp.id('co1')) IS NOT NULL, 'T6 potwierdzenie wyboru nadal dziala');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('UPDATE public.fm_resps SET zone = ''red'' WHERE retailer_id = 990101', 'fm_inputs_locked');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.fm_resps SET zone = 'orange', status = 'orange' WHERE retailer_id = 990101;
SELECT pg_temp.ok((SELECT zone FROM public.fm_resps WHERE retailer_id = 990101) = 'orange', 'T6 admin poprawia po zamknieciu');
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[{"retailer_id":990101,"priority":1000,"note":"chain:test-a"},{"retailer_id":990102,"priority":100}]'::jsonb)) = 2, 'T6 admin zapisuje przez RPC po zamknieciu');
RESET ROLE;
-- termin serwerowy (review: blokada wg zegara bazy, nie UI)
UPDATE public.fm_settings SET algo_phase = 'preferences_open', selection_deadline = now() - interval '1 minute';
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_set_company_targets(''' || pg_temp.id('co1') || ''', ''[]''::jsonb)', 'fm_inputs_locked');
RESET ROLE;
UPDATE public.fm_settings SET selection_deadline = now() + interval '1 hour';
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(jsonb_array_length(public.fm_set_company_targets(pg_temp.id('co1'), '[{"retailer_id":990101,"priority":1000,"note":"chain:test-a"},{"retailer_id":990102,"priority":100}]'::jsonb)) = 2, 'T6 termin w przyszlosci: zapis dziala');
RESET ROLE;
UPDATE public.fm_settings SET selection_deadline = NULL;
-- kopia zapasowa
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.fm_backup_inputs('test-055')->>'company_target_retailers')::int = (SELECT count(*) FROM public.company_target_retailers), 'T6 fm_backup_inputs liczy wybory');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_inputs_snapshots WHERE label = 'test-055') >= 6, 'T6 snapshot: >=6 tabel');
RESET ROLE;
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_backup_inputs(''x'')', 'administrator');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_inputs_snapshots) = 0, 'T6 dostawca nie widzi snapshotow');
RESET ROLE;

-- ── T7 storage: tylko wlasny folder (pomijane bez schematu storage) ──────────
DO $$
DECLARE co1 text := pg_temp.id('co1')::text; co2 text := pg_temp.id('co2')::text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RAISE NOTICE 'TEST T7 pominiety: brak storage.objects'; RETURN; END IF;
  -- goly Postgres (shim): RLS na storage.objects trzeba wlaczyc; na Supabase jest juz wlaczone (ALTER moze byc niedozwolony — ignorujemy)
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T7: ALTER TABLE storage.objects pominiety (%)', SQLERRM;
  END;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'TEST FAIL: T7 storage.objects bez RLS — test polityk storage nie ma sensu';
  END IF;
  INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true), ('offer-photos', 'offer-photos', true)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('company-logos', co2 || '/logo.png', pg_temp.id('sup2'));
  PERFORM pg_temp.login('sup1');
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('company-logos', co1 || '/logo.png', pg_temp.id('sup1'));
  PERFORM pg_temp.expect_error('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''company-logos'', ''' || co2 || '/hack.png'', ''' || pg_temp.id('sup1') || ''')', 'row-level security');
  DELETE FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co2 || '/logo.png';
  UPDATE storage.objects SET name = co2 || '/renamed.png' WHERE bucket_id = 'company-logos' AND name = co2 || '/logo.png';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co2 || '/logo.png') = 1, 'T7 cudze logo nie do skasowania ani zmiany (0 wierszy)');
  PERFORM pg_temp.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co1 || '/logo.png') = 1, 'T7 wlasne logo wgrane');
END $$;

-- ── T8 legacy_sends bez adresow ──────────────────────────────────────────────
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.legacy_sends WHERE data ? 'resendBuyerEmails'), 'T8 legacy_sends.data bez resendBuyerEmails');

SELECT '✅ OK — wszystkie testy 055_security_hotfix_test (T0–T8) przeszly' AS wynik;
ROLLBACK;
