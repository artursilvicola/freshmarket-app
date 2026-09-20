-- ============================================================================
-- fm_decision_sources_test.sql — testy migracji 20260920130000_fm_decision_sources
-- Uruchomienie (TYLKO baza testowa, nigdy produkcja):
--   node scripts/fm-decision-sources-sql-test.mjs   (embedded Postgres 127.0.0.1:54329)
-- Cała transakcja kończy się ROLLBACK — nic nie zostaje w bazie.
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
    IF SQLERRM NOT LIKE '%' || p_code || '%' AND SQLSTATE <> p_code THEN
      RAISE EXCEPTION 'TEST FAIL: oczekiwano bledu [%], dostano [% %] dla: %', p_code, SQLSTATE, SQLERRM, p_sql;
    END IF;
  END;
  IF v_passed THEN RAISE EXCEPTION 'TEST FAIL: oczekiwano bledu [%], a instrukcja PRZESZLA: %', p_code, p_sql; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'TEST FAIL: %', p_msg; END IF; END $$;
-- źródło wyboru dostawcy / decyzji kupca — odczyt jako właściciel bazy (bez RLS)
CREATE OR REPLACE FUNCTION pg_temp.src(p_entity text, p_co text, p_rid integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN RETURN (SELECT source || '|' || coalesce(source_user_id::text, 'null') || '|' || coalesce(decision, 'null')
              FROM public.fm_decision_sources WHERE entity = p_entity AND company_id = pg_temp.id(p_co) AND retailer_id = p_rid); END $$;
CREATE OR REPLACE FUNCTION pg_temp.targets(p_co text, p_items jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM public.fm_set_company_targets(pg_temp.id(p_co), p_items); END $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fm_trigger_fm_resps_email' AND tgrelid = 'public.fm_resps'::regclass) THEN
    EXECUTE 'ALTER TABLE public.fm_resps DISABLE TRIGGER fm_trigger_fm_resps_email';
  END IF;
END $$;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(),
       CASE k WHEN 'admin' THEN '{"provider":"email","role":"admin"}'::jsonb ELSE '{"provider":"email"}'::jsonb END, '{}'::jsonb
FROM t_ids WHERE k IN ('admin','sup1','sup2','buyer1','buyer2');
UPDATE public.profiles SET role = 'admin', name = 'Oksana Test' WHERE id = pg_temp.id('admin');
INSERT INTO public.companies (id, name, fm_b2b_enabled, account_status, fm_b2b_tier, fm_b2b_packages) VALUES
  (pg_temp.id('co1'), 'TEST Firma 1', true, 'active', 'business', 1),
  (pg_temp.id('co2'), 'TEST Firma 2', true, 'active', 'business', 1);
UPDATE public.profiles SET company_id = pg_temp.id('co1'), role = 'supplier' WHERE id = pg_temp.id('sup1');
UPDATE public.profiles SET company_id = pg_temp.id('co2'), role = 'supplier' WHERE id = pg_temp.id('sup2');
INSERT INTO public.retailers (id, name, fm26_active, fm26_chain_id) VALUES
  (990201, 'TEST Siec A', true, 'test-a'), (990202, 'TEST Siec B', true, 'test-b'), (990203, 'TEST Siec C', true, 'test-c');
UPDATE public.profiles SET role = 'buyer', retailer_id = 990201, fm26_active = true WHERE id = pg_temp.id('buyer1');
UPDATE public.profiles SET role = 'buyer', retailer_id = 990202, fm26_active = true WHERE id = pg_temp.id('buyer2');
INSERT INTO public.fm_settings (algo_phase, event_date) SELECT 'preferences_open', '2026-09-24' WHERE NOT EXISTS (SELECT 1 FROM public.fm_settings);
UPDATE public.fm_settings SET algo_phase = 'preferences_open', schedule = NULL, selection_deadline = NULL;
-- wybór sprzed migracji (bez wpisu źródła) — istniejące dane nie dostają oznaczenia
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES (pg_temp.id('co2'), 990203, 1000, 'chain:test-c');

-- ── T0 obiekty ───────────────────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fm_decision_sources') = 1, 'T0 tabela fm_decision_sources');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'fm_decision_sources' AND policyname IN ('fds_admin_read','fds_supplier_own','fds_buyer_own') AND cmd = 'SELECT') = 3
               AND (SELECT count(*) FROM pg_policies WHERE tablename = 'fm_decision_sources' AND cmd <> 'SELECT') = 0, 'T0 tylko polityki SELECT (zapis wylacznie RPC/trigger)');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_fm_resps_decision_source') = 1, 'T0 trigger fm_resps');
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fm_decision_source_of_caller','fm_resps_decision_source','fm_set_company_targets')) = 3, 'T0 funkcje');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T0 istniejace wybory sprzed migracji bez zrodla');

-- ── T1 dostawca sam zapisuje → źródło supplier ──────────────────────────────
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":100,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) = 'supplier|' || pg_temp.id('sup1') || '|star', 'T1 A: supplier/star: ' || coalesce(pg_temp.src('target','co1',990201), 'null'));
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'supplier|' || pg_temp.id('sup1') || '|thumb', 'T1 B: supplier/thumb');
SELECT pg_temp.ok((SELECT count(*) FROM public.audit_log WHERE action = 'fm_targets_saved' AND entity_id = pg_temp.id('co1')::text AND meta->>'source' = 'supplier') = 1, 'T1 audyt fm_targets_saved z source');

-- ── T2 admin zapisuje ZA dostawcę: oznaczone tylko sieci nowe / ze zmienioną klasą ──
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
-- A bez zmian (star), B rezerwowa → główna, C nowa (rezerwowa)
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":1000,"note":"chain:test-b"},{"retailer_id":990203,"priority":100,"note":"chain:test-c"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) = 'supplier|' || pg_temp.id('sup1') || '|star', 'T2 A bez zmiany zachowuje zrodlo supplier');
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|' || pg_temp.id('admin') || '|star', 'T2 B zmiana klasy → admin: ' || coalesce(pg_temp.src('target','co1',990202), 'null'));
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) = 'admin|' || pg_temp.id('admin') || '|thumb', 'T2 C nowa → admin');
-- ponowny identyczny zapis admina niczego nie zmienia
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":1000,"note":"chain:test-b"},{"retailer_id":990203,"priority":100,"note":"chain:test-c"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T2 identyczny zapis: A nadal supplier');

-- ── T3 dostawca zmienia sam → oznaczenie znika; usunięta sieć → brak wpisu ──
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
-- B z powrotem rezerwowa (zmiana przez dostawcę), C usunięta, A bez zmian
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":100,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'supplier|' || pg_temp.id('sup1') || '|thumb', 'T3 B po samodzielnej zmianie → supplier');
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) IS NULL, 'T3 C usunieta → brak wpisu zrodla');
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T3 A nadal supplier');
-- admin ustawia ponownie → oznaczenie wraca
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":1000,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) LIKE 'admin|%', 'T3 ponowna zmiana przez admina → admin');

-- ── T4 decyzje kupca: buyer / admin / ponownie buyer / meta bez zmiany / delete ──
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990201, pg_temp.id('co1'), 'want', 'want', '{}'::jsonb);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) = 'buyer|' || pg_temp.id('buyer1') || '|want', 'T4 insert kupca → buyer: ' || coalesce(pg_temp.src('resp','co1',990201), 'null'));
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
UPDATE public.fm_resps SET zone = 'remove', status = 'remove' WHERE retailer_id = 990201 AND supplier_company_id = pg_temp.id('co1');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) = 'admin|' || pg_temp.id('admin') || '|remove', 'T4 admin zmienia decyzje kupca → admin');
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
UPDATE public.fm_resps SET meta = '{"x":1}'::jsonb WHERE retailer_id = 990201 AND supplier_company_id = pg_temp.id('co1');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) LIKE 'admin|%', 'T4 zmiana samego meta przez kupca nie zmienia zrodla');
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
UPDATE public.fm_resps SET zone = 'chance', status = 'chance' WHERE retailer_id = 990201 AND supplier_company_id = pg_temp.id('co1');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) = 'buyer|' || pg_temp.id('buyer1') || '|chance', 'T4 kupiec sam zmienia → buyer (oznaczenie znika)');
-- upsert jak z aplikacji (ON CONFLICT DO UPDATE) przez admina
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990201, pg_temp.id('co1'), 'want', 'want', '{}'::jsonb)
  ON CONFLICT (retailer_id, supplier_company_id) DO UPDATE SET zone = excluded.zone, status = excluded.status, meta = excluded.meta;
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) = 'admin|' || pg_temp.id('admin') || '|want', 'T4 upsert admina → admin');
-- sesja serwerowa (SQL Editor / service_role: brak auth.uid()) → admin bez autora
SELECT pg_temp.login(NULL);
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990202, pg_temp.id('co1'), 'remove', 'remove', '{}'::jsonb);
SELECT pg_temp.ok(pg_temp.src('resp','co1',990202) = 'admin|null|remove', 'T4 sesja serwerowa → admin bez autora: ' || coalesce(pg_temp.src('resp','co1',990202), 'null'));
DELETE FROM public.fm_resps WHERE retailer_id = 990202 AND supplier_company_id = pg_temp.id('co1');
SELECT pg_temp.ok(pg_temp.src('resp','co1',990202) IS NULL, 'T4 delete czysci zrodlo');

-- ── T5 RLS: kto co widzi ────────────────────────────────────────────────────
-- stan: target co1: A supplier, B admin; resp: (990201, co1) admin
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 2, 'T5 dostawca widzi tylko 2 wlasne target');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'resp') = 0, 'T5 dostawca NIE widzi zrodel decyzji kupcow o sobie');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE company_id <> pg_temp.id('co1')) = 0, 'T5 dostawca nie widzi cudzych firm');
SELECT pg_temp.expect_error('INSERT INTO public.fm_decision_sources (entity, company_id, retailer_id, source) VALUES (''target'', pg_temp.id(''co1''), 990201, ''supplier'')', '42501');
SELECT pg_temp.expect_error('UPDATE public.fm_decision_sources SET source = ''supplier'' WHERE company_id = pg_temp.id(''co1'')', '42501');
RESET ROLE;
SELECT pg_temp.login('sup2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T5 inny dostawca (co2, wybor sprzed migracji) widzi 0');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 1 AND (SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'resp' AND retailer_id = 990201) = 1, 'T5 kupiec widzi tylko wlasna decyzje (resp 990201)');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'target') = 0, 'T5 kupiec NIE widzi zrodel wyborow dostawcow (takze o swojej sieci)');
SELECT pg_temp.expect_error('DELETE FROM public.fm_decision_sources', '42501');
RESET ROLE;
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T5 inny kupiec widzi 0');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 3, 'T5 admin widzi wszystko (3)');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources s JOIN public.profiles p ON p.id = s.source_user_id WHERE s.source = 'admin' AND p.name = 'Oksana Test') = 2, 'T5 admin: autor (profil) czytelny dla oznaczen admina');
RESET ROLE;
SELECT pg_temp.login(NULL);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_decision_sources', 'permission denied');   -- anon: brak nawet SELECT
RESET ROLE;

-- ── T6 usuniecie firmy / sieci czysci wpisy (FK cascade) ────────────────────
SELECT pg_temp.login(NULL);
DELETE FROM public.fm_resps WHERE supplier_company_id = pg_temp.id('co1');
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'resp' AND company_id = pg_temp.id('co1')) = 0, 'T6 delete resps → zrodla resp usuniete');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'target' AND company_id = pg_temp.id('co1')) = 2, 'T6 bezposredni DELETE z company_target_retailers (poza RPC) zostawia wpisy — czysci je nastepny zapis RPC albo cascade firmy');
DELETE FROM public.companies WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE company_id = pg_temp.id('co1')) = 0, 'T6 cascade po usunieciu firmy');

SELECT 'OK: fm_decision_sources T0-T6' AS result;
ROLLBACK;
