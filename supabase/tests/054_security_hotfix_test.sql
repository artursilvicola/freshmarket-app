-- ============================================================================
-- 054_security_hotfix_test.sql — testy SQL hotfixu bezpieczeństwa (054)
-- Uruchomienie (TYLKO baza testowa, nigdy produkcja):
--   DATABASE_URL=… node scripts/fm-queue-sql-test.mjs --only-test  (patrz --test 054)
--   albo psql -f supabase/tests/054_security_hotfix_test.sql
-- Cała transakcja kończy się ROLLBACK — nic nie zostaje w bazie.
-- Wymaga: migracje 001–054, trigger handle_new_user na auth.users.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('admin', gen_random_uuid()), ('sup1', gen_random_uuid()), ('sup2', gen_random_uuid()),
  ('buyer1', gen_random_uuid()), ('buyer2', gen_random_uuid()),
  ('co1', gen_random_uuid()), ('co2', gen_random_uuid());
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

-- ── fixtures ────────────────────────────────────────────────────────────────
-- powiadomienie mailowe po odpowiedzi kupca (pg_net) nie jest przedmiotem testu
ALTER TABLE public.fm_resps DISABLE TRIGGER fm_trigger_fm_resps_email;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(),
       CASE k WHEN 'admin' THEN '{"provider":"email","role":"admin"}'::jsonb ELSE '{"provider":"email"}'::jsonb END,
       '{}'::jsonb
FROM t_ids WHERE k IN ('admin','sup1','sup2','buyer1','buyer2');
UPDATE public.profiles SET role = 'admin' WHERE id = pg_temp.id('admin');
INSERT INTO public.companies (id, name, fm_b2b_enabled, account_status, fm_b2b_tier, fm_b2b_packages) VALUES
  (pg_temp.id('co1'), 'TEST Firma 1', true, 'active', 'business', 1),
  (pg_temp.id('co2'), 'TEST Firma 2', true, 'active', 'premium', 2);
UPDATE public.profiles SET company_id = pg_temp.id('co1'), role = 'supplier' WHERE id = pg_temp.id('sup1');
UPDATE public.profiles SET company_id = pg_temp.id('co2'), role = 'supplier' WHERE id = pg_temp.id('sup2');
INSERT INTO public.retailers (id, name, fm26_active, fm26_chain_id, buyer_name, buyer_email, buyer_phone) VALUES
  (990101, 'TEST Siec A', true, 'test-a', 'Anna Test', 'anna@siec-a.test', '+48 600 000 001'),
  (990102, 'TEST Siec B', true, 'test-b', NULL, NULL, NULL);
UPDATE public.profiles SET role = 'buyer', retailer_id = 990101 WHERE id = pg_temp.id('buyer1');
UPDATE public.profiles SET role = 'buyer', retailer_id = 990102 WHERE id = pg_temp.id('buyer2');
INSERT INTO public.fm_settings (algo_phase, event_date) SELECT 'preferences_open', '2026-09-24'
  WHERE NOT EXISTS (SELECT 1 FROM public.fm_settings);
UPDATE public.fm_settings SET algo_phase = 'preferences_open', schedule = NULL;
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES
  (pg_temp.id('co1'), 990101, 1000, 'chain:test-a'), (pg_temp.id('co2'), 990101, 1000, 'chain:test-a');

-- ── T1 kontakty kupców: retailers puste, retailer_contacts tylko admin ───────
SELECT pg_temp.ok((SELECT buyer_email FROM public.retailers WHERE id = 990101) IS NULL, 'T1 trigger po insert wyczyscil retailers.buyer_email');
SELECT pg_temp.ok((SELECT buyer_email FROM public.retailer_contacts WHERE retailer_id = 990101) = 'anna@siec-a.test', 'T1 kontakt przeniesiony do retailer_contacts');
UPDATE public.retailers SET buyer_phone = '+48 600 000 002' WHERE id = 990101;   -- jak toRetailerDbRow z panelu
SELECT pg_temp.ok((SELECT buyer_phone FROM public.retailers WHERE id = 990101) IS NULL, 'T1 update: kolumna w retailers nadal pusta');
SELECT pg_temp.ok((SELECT buyer_phone FROM public.retailer_contacts WHERE retailer_id = 990101) = '+48 600 000 002', 'T1 update: kontakt zaktualizowany');
UPDATE public.retailers SET name = 'TEST Siec A2' WHERE id = 990101;             -- update bez buyer_* nie kasuje kontaktu
SELECT pg_temp.ok((SELECT buyer_email FROM public.retailer_contacts WHERE retailer_id = 990101) = 'anna@siec-a.test', 'T1 update bez kontaktu nie kasuje retailer_contacts');

SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.retailers WHERE id IN (990101, 990102)) = 2, 'T1 dostawca nadal widzi liste sieci');
SELECT pg_temp.ok((SELECT count(*) FROM public.retailer_contacts) = 0, 'T1 dostawca nie widzi zadnych kontaktow kupcow');
SELECT pg_temp.ok((SELECT count(*) FROM public.profiles WHERE role = 'buyer') = 0, 'T1 dostawca nie widzi profili kupcow');
SELECT pg_temp.expect_error('INSERT INTO public.retailer_contacts (retailer_id, buyer_email) VALUES (990102, ''x@x.test'')', 'row-level security');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.retailer_contacts) = 0, 'T1 kupiec nie widzi kontaktow innych sieci (ani wlasnej tabeli kontaktow)');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT buyer_email FROM public.retailer_contacts WHERE retailer_id = 990101) = 'anna@siec-a.test', 'T1 admin widzi kontakty');
RESET ROLE;

-- ── T2 anon: widoki i tabele ─────────────────────────────────────────────────
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

-- ── T4 triggery ochronne: dostawca nie podniesie sobie pakietu ani statusu ────
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
-- nowa firma zalozona przez zalogowanego dostawce: kolumny administracyjne = domyslne
INSERT INTO public.companies (id, name, fm_b2b_enabled, fm_b2b_tier, account_status, pkg_plan) VALUES (gen_random_uuid(), 'TEST Nowa', true, 'premium', 'active', 'prem_10');
SELECT pg_temp.ok((SELECT fm_b2b_enabled = false AND fm_b2b_tier = 'business' AND account_status = 'pending_review' AND pkg_plan IS NULL FROM public.companies WHERE name = 'TEST Nowa'), 'T4 insert firmy przez dostawce: wartosci domyslne');
-- wlasny profil: dane osoby przechodza, przypisania nie
UPDATE public.profiles SET name = 'Jan Test', phone = '123', position = 'Handlowiec', company_id = pg_temp.id('co2'), active = false, fm26_active = true, locale = 'en'
 WHERE id = pg_temp.id('sup1');
SELECT pg_temp.ok((SELECT name = 'Jan Test' AND phone = '123' AND locale = 'en' FROM public.profiles WHERE id = pg_temp.id('sup1')), 'T4 Moj profil zapisany');
SELECT pg_temp.ok((SELECT company_id = pg_temp.id('co1') AND active = true AND fm26_active = false FROM public.profiles WHERE id = pg_temp.id('sup1')), 'T4 company_id/active/fm26_active bez zmian');
SELECT pg_temp.expect_error('UPDATE public.profiles SET role = ''admin'' WHERE id = ''' || pg_temp.id('sup1') || '''', '');  -- dowolny blad (trigger 033)
RESET ROLE;
-- kupiec: nie przepnie sie do innej sieci
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET name = 'Anna Test 2', retailer_id = 990102, buyer_categories = '{owoce}' WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.ok((SELECT retailer_id = 990101 AND name = 'Anna Test 2' AND buyer_categories = '{}' FROM public.profiles WHERE id = pg_temp.id('buyer1')), 'T4 kupiec: retailer_id/buyer_categories bez zmian, name zapisane');
RESET ROLE;
-- admin zmienia bez przeszkod
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.companies SET fm_b2b_tier = 'premium', fm_b2b_packages = 3 WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT fm_b2b_tier = 'premium' AND fm_b2b_packages = 3 FROM public.companies WHERE id = pg_temp.id('co1')), 'T4 admin zmienia pakiet');
UPDATE public.profiles SET fm26_active = true WHERE id = pg_temp.id('buyer1');
SELECT pg_temp.ok((SELECT fm26_active FROM public.profiles WHERE id = pg_temp.id('buyer1')), 'T4 admin zmienia fm26_active');
RESET ROLE;
-- security definer RPC (purchase_package) i SQL Editor nie sa blokowane
SELECT pg_temp.ok(public.fm_is_privileged_session(), 'T4 sesja postgres = uprzywilejowana');

-- ── T5 plan: fm_plan_private + fm_my_schedule ────────────────────────────────
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.fm_settings SET schedule = jsonb_build_object(
  'res', jsonb_build_object(pg_temp.id('co1')::text, '{"m":["test-a"],"r":{"test-a":5}}'::jsonb,
                            pg_temp.id('co2')::text, '{"m":["test-a","test-b"],"r":{"test-a":4,"test-b":3}}'::jsonb),
  'nums', jsonb_build_object(pg_temp.id('co1')::text, '{"test-a":1}'::jsonb, pg_temp.id('co2')::text, '{"test-a":2,"test-b":1}'::jsonb),
  'cs', '{}'::jsonb, 'cq', '{}'::jsonb, 'warnings', '[]'::jsonb);
SELECT pg_temp.ok((SELECT schedule FROM public.fm_settings ORDER BY updated_at DESC LIMIT 1) IS NULL, 'T5 fm_settings.schedule nadal null (trigger)');
SELECT pg_temp.ok((SELECT schedule->'res' ? pg_temp.id('co2')::text FROM public.fm_plan_private WHERE id = 1), 'T5 plan trafil do fm_plan_private');
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text AND public.fm_my_schedule() ? 'warnings', 'T5 admin: pelny plan z RPC');
RESET ROLE;
-- przed publikacja: dostawca i kupiec nic nie dostaja
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
SELECT pg_temp.login('sup2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text AND NOT ((public.fm_my_schedule()->'res') ? pg_temp.id('co1')::text), 'T5 dostawca po publikacji: tylko wlasny wpis');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums'->(pg_temp.id('co2')::text)->>'test-b') = '1', 'T5 dostawca: wlasne numery');
SELECT pg_temp.ok(NOT (public.fm_my_schedule() ? 'warnings'), 'T5 dostawca: bez cs/cq/warnings');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co1')::text AND (public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text, 'T5 kupiec test-a: obie firmy maja spotkanie');
SELECT pg_temp.ok((public.fm_my_schedule()->'res'->(pg_temp.id('co2')::text)->'m') = '["test-a"]'::jsonb, 'T5 kupiec: m tylko z wlasnym chainem (test-b ukryty)');
SELECT pg_temp.ok(NOT ((public.fm_my_schedule()->'res'->(pg_temp.id('co2')::text)) ? 'r'), 'T5 kupiec: bez ocen r');
SELECT pg_temp.ok((public.fm_my_schedule()->'nums'->(pg_temp.id('co2')::text)) = '{"test-a":2}'::jsonb, 'T5 kupiec: numery tylko wlasnego chainu');
RESET ROLE;
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.fm_my_schedule()->'res') ? pg_temp.id('co2')::text AND NOT ((public.fm_my_schedule()->'res') ? pg_temp.id('co1')::text), 'T5 kupiec test-b: tylko co2');
RESET ROLE;
UPDATE public.fm_settings SET algo_phase = 'preferences_open';

-- ── T6 blokada wyborow poza faza preferences_open ────────────────────────────
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES (pg_temp.id('co1'), 990102, 100, 'chain:test-b');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 faza otwarta: dostawca zapisuje wybory');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990101, pg_temp.id('co1'), 'green', 'green', '{}'::jsonb);
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_resps WHERE retailer_id = 990101) = 1, 'T6 faza otwarta: kupiec odpowiada');
RESET ROLE;
UPDATE public.fm_settings SET algo_phase = 'matching';
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('DELETE FROM public.company_target_retailers WHERE company_id = ''' || pg_temp.id('co1') || '''', 'fm_inputs_locked');
SELECT pg_temp.expect_error('INSERT INTO public.company_target_retailers (company_id, retailer_id, priority) VALUES (''' || pg_temp.id('co1') || ''', 990101, 1000)', 'fm_inputs_locked');
SELECT pg_temp.ok((SELECT count(*) FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1')) = 2, 'T6 wybory nietkniete po zablokowaniu');
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
-- kopia zapasowa
SELECT pg_temp.ok((public.fm_backup_inputs('test-054')->>'company_target_retailers')::int = (SELECT count(*) FROM public.company_target_retailers), 'T6 fm_backup_inputs liczy wybory');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_inputs_snapshots WHERE label = 'test-054') >= 5, 'T6 snapshot: >=5 tabel');
RESET ROLE;
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT public.fm_backup_inputs(''x'')', 'administrator');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_inputs_snapshots) = 0, 'T6 dostawca nie widzi snapshotow');
RESET ROLE;
UPDATE public.fm_settings SET algo_phase = 'preferences_open';

-- ── T7 storage: tylko wlasny folder (pomijane na golym Postgresie bez schematu storage) ──
DO $$
DECLARE co1 text := pg_temp.id('co1')::text; co2 text := pg_temp.id('co2')::text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RAISE NOTICE 'TEST T7 pominiety: brak storage.objects'; RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true), ('offer-photos', 'offer-photos', true)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('company-logos', co2 || '/logo.png', pg_temp.id('sup2'));
  PERFORM pg_temp.login('sup1');
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('company-logos', co1 || '/logo.png', pg_temp.id('sup1'));
  PERFORM pg_temp.expect_error('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''company-logos'', ''' || co2 || '/hack.png'', ''' || pg_temp.id('sup1') || ''')', 'row-level security');
  DELETE FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co2 || '/logo.png';
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co2 || '/logo.png') = 1, 'T7 cudze logo nie do skasowania (delete = 0 wierszy)');
  PERFORM pg_temp.ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'company-logos' AND name = co1 || '/logo.png') = 1, 'T7 wlasne logo wgrane');
END $$;

-- ── T8 legacy_sends bez adresow ──────────────────────────────────────────────
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.legacy_sends WHERE data ? 'resendBuyerEmails'), 'T8 legacy_sends.data bez resendBuyerEmails');

SELECT '✅ OK — wszystkie testy 054_security_hotfix_test (T1–T8) przeszly' AS wynik;
ROLLBACK;
