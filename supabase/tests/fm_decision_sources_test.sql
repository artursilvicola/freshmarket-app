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
GRANT ALL ON t_ids TO anon, authenticated, service_role;
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

-- ── T0 obiekty ───────────────────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fm_decision_sources') = 1, 'T0 tabela fm_decision_sources');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'fm_decision_sources') = 1
               AND (SELECT count(*) FROM pg_policies WHERE tablename = 'fm_decision_sources' AND policyname = 'fds_admin_read' AND cmd = 'SELECT') = 1, 'T0 jedyna polityka: SELECT admina (uzytkownik czyta przez RPC)');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_fm_resps_decision_source', 'trg_ctr_decision_source')) = 2, 'T0 triggery fm_resps + company_target_retailers');
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fm_decision_source_of_caller','fm_resps_decision_source','ctr_decision_source','fm_set_company_targets','fm_my_decision_sources')) = 5, 'T0 funkcje');
SELECT pg_temp.ok((SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fm_decision_sources') = 'entity,company_id,retailer_id,decision,source,source_user_id,source_at', 'T0 kolumny');
-- wybor sprzed migracji: wstawiony przez SQL PRZED migracja nie istnieje w tym tescie (migracja juz jest);
-- zamiast tego: wiersz wstawiony przy wylaczonym triggerze = stan sprzed migracji (brak zrodla)
ALTER TABLE public.company_target_retailers DISABLE TRIGGER trg_ctr_decision_source;
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES (pg_temp.id('co2'), 990203, 1000, 'chain:test-c');
ALTER TABLE public.company_target_retailers ENABLE TRIGGER trg_ctr_decision_source;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T0 wybor sprzed migracji bez zrodla');

-- ── T1 dostawca sam zapisuje → źródło supplier ──────────────────────────────
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":100,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) = 'supplier|' || pg_temp.id('sup1') || '|star', 'T1 A: supplier/star: ' || coalesce(pg_temp.src('target','co1',990201), 'null'));
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'supplier|' || pg_temp.id('sup1') || '|thumb', 'T1 B: supplier/thumb');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE entity = 'target' AND company_id = pg_temp.id('co1')) = 2, 'T1 dokladnie 2 wpisy (trigger wylaczony w RPC nie dubluje)');
SELECT pg_temp.ok((SELECT count(*) FROM public.audit_log WHERE action = 'fm_targets_saved' AND entity_id = pg_temp.id('co1')::text AND meta->>'source' = 'supplier') = 1, 'T1 audyt fm_targets_saved z source');
SELECT pg_temp.ok(coalesce(current_setting('fm.targets_rpc', true), '') = '', 'T1 flaga RPC wyzerowana po zapisie');

-- ── T2 admin zapisuje ZA dostawcę: oznaczone tylko sieci nowe / ze zmienioną klasą ──
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":1000,"note":"chain:test-b"},{"retailer_id":990203,"priority":100,"note":"chain:test-c"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) = 'supplier|' || pg_temp.id('sup1') || '|star', 'T2 A bez zmiany zachowuje zrodlo supplier');
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|' || pg_temp.id('admin') || '|star', 'T2 B zmiana klasy → admin: ' || coalesce(pg_temp.src('target','co1',990202), 'null'));
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) = 'admin|' || pg_temp.id('admin') || '|thumb', 'T2 C nowa → admin');
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":1000,"note":"chain:test-b"},{"retailer_id":990203,"priority":100,"note":"chain:test-c"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T2 identyczny zapis: A nadal supplier');
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) LIKE 'admin|%' AND pg_temp.src('target','co1',990203) LIKE 'admin|%', 'T2 identyczny zapis: B, C nadal admin');

-- ── T3 dostawca zmienia sam → oznaczenie znika; usunięta sieć → brak wpisu ──
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":100,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'supplier|' || pg_temp.id('sup1') || '|thumb', 'T3 B po samodzielnej zmianie → supplier');
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) IS NULL, 'T3 C usunieta → brak wpisu zrodla');
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T3 A nadal supplier');
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
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990201, pg_temp.id('co1'), 'want', 'want', '{}'::jsonb)
  ON CONFLICT (retailer_id, supplier_company_id) DO UPDATE SET zone = excluded.zone, status = excluded.status, meta = excluded.meta;
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('resp','co1',990201) = 'admin|' || pg_temp.id('admin') || '|want', 'T4 upsert admina → admin');
SELECT pg_temp.login(NULL);
INSERT INTO public.fm_resps (retailer_id, supplier_company_id, zone, status, meta) VALUES (990202, pg_temp.id('co1'), 'remove', 'remove', '{}'::jsonb);
SELECT pg_temp.ok(pg_temp.src('resp','co1',990202) = 'admin|null|remove', 'T4 sesja serwerowa (SQL) → admin bez autora: ' || coalesce(pg_temp.src('resp','co1',990202), 'null'));
DELETE FROM public.fm_resps WHERE retailer_id = 990202 AND supplier_company_id = pg_temp.id('co1');
SELECT pg_temp.ok(pg_temp.src('resp','co1',990202) IS NULL, 'T4 delete czysci zrodlo');

-- ── T5 zapisy wyborow dostawcy POZA RPC (SQL Editor / service_role) — review P2/1 ──
-- stan: co1: A star(supplier), B star(admin)
SELECT pg_temp.login(NULL);
UPDATE public.company_target_retailers SET priority = 100 WHERE company_id = pg_temp.id('co1') AND retailer_id = 990202;   -- glowna → rezerwowa przez SQL
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|null|thumb', 'T5 SQL UPDATE zmiana klasy → admin bez autora, decision thumb: ' || coalesce(pg_temp.src('target','co1',990202), 'null'));
UPDATE public.company_target_retailers SET note = 'chain:test-a-x' WHERE company_id = pg_temp.id('co1') AND retailer_id = 990201;   -- sama notatka
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) = 'supplier|' || pg_temp.id('sup1') || '|star', 'T5 SQL UPDATE bez zmiany klasy (note) nie zmienia zrodla');
UPDATE public.company_target_retailers SET priority = 1500 WHERE company_id = pg_temp.id('co1') AND retailer_id = 990201;   -- priorytet w tej samej klasie
SELECT pg_temp.ok(pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T5 SQL UPDATE priorytetu w tej samej klasie nie zmienia zrodla');
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES (pg_temp.id('co1'), 990203, 1000, 'chain:test-c');
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) = 'admin|null|star', 'T5 SQL INSERT → admin bez autora');
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1') AND retailer_id = 990203;
SELECT pg_temp.ok(pg_temp.src('target','co1',990203) IS NULL, 'T5 SQL DELETE czysci zrodlo');
-- usuniecie i odtworzenie przez SQL: stare zrodlo nie przezywa
DELETE FROM public.company_target_retailers WHERE company_id = pg_temp.id('co1') AND retailer_id = 990202;
INSERT INTO public.company_target_retailers (company_id, retailer_id, priority, note) VALUES (pg_temp.id('co1'), 990202, 1000, 'chain:test-b');
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|null|star', 'T5 SQL DELETE+INSERT → nowe zrodlo, aktualna klasa');
-- service_role (BYPASSRLS, bez auth.uid()) → tak samo admin bez autora
SET LOCAL ROLE service_role;
UPDATE public.company_target_retailers SET priority = 100 WHERE company_id = pg_temp.id('co1') AND retailer_id = 990202;
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|null|thumb', 'T5 service_role UPDATE → admin bez autora');
-- po zapisach SQL identyczny zapis RPC przez dostawce nie zmienia zrodel (nie ma czego naprawiac: decision aktualne)
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.targets('co1', '[{"retailer_id":990201,"priority":1000,"note":"chain:test-a"},{"retailer_id":990202,"priority":100,"note":"chain:test-b"}]');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.src('target','co1',990202) = 'admin|null|thumb' AND pg_temp.src('target','co1',990201) LIKE 'supplier|%', 'T5 identyczny zapis RPC po SQL zachowuje zrodla');

-- ── T6 RLS / API: tabela tylko admin; uzytkownik przez RPC bez autora i czasu ──
-- stan: target co1: A supplier(sup1), B admin(null, thumb); resp: (990201, co1) admin
SELECT pg_temp.login('sup1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T6 dostawca: tabela = 0 wierszy (autor/czas niedostepne przez API)');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources()) = 2 AND (SELECT count(*) FROM public.fm_my_decision_sources() WHERE entity = 'target' AND company_id = pg_temp.id('co1')) = 2, 'T6 dostawca: RPC = 2 wlasne target');
SELECT pg_temp.ok((SELECT source FROM public.fm_my_decision_sources() WHERE retailer_id = 990202) = 'admin' AND (SELECT decision FROM public.fm_my_decision_sources() WHERE retailer_id = 990202) = 'thumb', 'T6 dostawca: widzi zrodlo admin i klase');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources() WHERE entity = 'resp') = 0, 'T6 dostawca NIE widzi zrodel decyzji kupcow o sobie');
SELECT pg_temp.expect_error('INSERT INTO public.fm_decision_sources (entity, company_id, retailer_id, source) VALUES (''target'', pg_temp.id(''co1''), 990201, ''supplier'')', '42501');
SELECT pg_temp.expect_error('UPDATE public.fm_decision_sources SET source = ''supplier''', '42501');
RESET ROLE;
SELECT pg_temp.login('sup2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources()) = 0, 'T6 inny dostawca (co2, wybor sprzed migracji) widzi 0');
RESET ROLE;
SELECT pg_temp.login('buyer1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 0, 'T6 kupiec: tabela = 0 wierszy');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources()) = 1 AND (SELECT count(*) FROM public.fm_my_decision_sources() WHERE entity = 'resp' AND retailer_id = 990201 AND source = 'admin') = 1, 'T6 kupiec: RPC = 1 wlasna decyzja (admin)');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources() WHERE entity = 'target') = 0, 'T6 kupiec NIE widzi zrodel wyborow dostawcow (takze o swojej sieci)');
SELECT pg_temp.expect_error('DELETE FROM public.fm_decision_sources', '42501');
RESET ROLE;
SELECT pg_temp.login('buyer2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources()) = 0, 'T6 inny kupiec widzi 0');
RESET ROLE;
SELECT pg_temp.login('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources) = 3, 'T6 admin: tabela = wszystko (3) z autorem i czasem');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources s JOIN public.profiles p ON p.id = s.source_user_id WHERE s.source = 'admin' AND p.name = 'Oksana Test') = 1, 'T6 admin: autor (profil) czytelny dla wpisu z sesji admina');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_my_decision_sources()) = 0, 'T6 admin: RPC uzytkownika = 0 (admin czyta tabele)');
RESET ROLE;
SELECT pg_temp.login(NULL);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_decision_sources', 'permission denied');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_my_decision_sources()', 'permission denied');
RESET ROLE;

-- ── T7 cascade ──────────────────────────────────────────────────────────────
SELECT pg_temp.login(NULL);
DELETE FROM public.companies WHERE id = pg_temp.id('co1');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_decision_sources WHERE company_id = pg_temp.id('co1')) = 0, 'T7 cascade po usunieciu firmy');

SELECT 'OK: fm_decision_sources T0-T7' AS result;
ROLLBACK;
