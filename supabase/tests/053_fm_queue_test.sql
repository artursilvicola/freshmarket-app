-- ============================================================================
-- Testy modulu kolejek (migracje 052 + 053, wersja v2 po review Codexa).
-- Uruchamiac w SQL Editor NA BAZIE TESTOWEJ (branch / osobny projekt / lokalny
-- Postgres z supabase/tests/000_supabase_shim.sql). Jedna transakcja, ROLLBACK
-- na koncu — nic nie zostaje. Nie odpalac na produkcji w dzien eventu.
--
-- Kazde NIEPOWODZENIE = RAISE EXCEPTION (czerwony blad). Sukces = 1 wiersz "OK".
--
--   T0  obiekty migracji istnieja; handle_new_user IGNORUJE 'admin'/'staff' z user_metadata
--   T1  anon: brak dostepu do tabel i RPC; widok/snapshot bez nazw firm
--   T2  uprawnienia: bez sesji, nieprzypisany staff, dostawca, kupiec -> bledy;
--       station_state zabronione dla dostawcy/kupca/nieprzypisanego
--   T3  call_next: tylko do przodu; zajete stanowisko -> FM_STATION_BUSY; idem wymagany
--   T4  finish_and_call_next: done + nastepny wywolany w jednej transakcji
--   T5  no_show -> mark_returned -> bariera; serve przed bariera -> blad; po -> OK;
--       last_called_nr bez zmian; tablica busy_private
--   T6  add_exception = max(nr)+1; powtorka z tym samym kluczem nie tworzy 2. numeru
--   T7  cofniecie: call_next -> FM_UNDO_FORBIDDEN; no_show cofniete przywraca spotkanie;
--       last_called_nr NIGDY nie maleje (trigger, nawet dla superusera)
--   T8  version conflict -> FM_CONFLICT
--   T9  idempotencja: ten sam klucz dwa razy = jedna operacja, jeden wpis logu
--   T10 RLS: staff widzi spotkania tylko przypisanej grupy; dostawca tylko swoje;
--       kupiec nic; staff nie pisze do logu/grup
--   T11 parallel: 2 stanowiska, wspolna kolejka — rozne numery, zakonczenie/no_show
--       na kazdym niezaleznie, bariera powracajacego liczona z calej grupy
--   T12 open_day: pelny import wielu spotkan do jednej sieci, pominiecie bez force,
--       synchronizacja z force (zmiana numeru), konflikt numeru, brakujace mapowania,
--       split bez kategorii -> 'unrouted', plan nieopublikowany -> blad
--   T13 logowanie: gate rezerwuje probe (attempt_id, max 5 rownoleglych, wygasa po 60 s), result
--       rozlicza dokladnie te probe raz (success / invalid_credentials / system_error); lockout po
--       5 FAKTYCZNIE blednych PIN-ach, poprawny PIN przy 5. probie = sukces, awaria = bez lockoutu;
--       przypiecie tabletu w jednym UPDATE; limit ip+kod+urzadzenie; set_blocked fail-closed;
--       rotacja PIN: stary token / ta sama sekunda / brak iat = odrzucone
--   T15 move_meeting: przeniesienie zaplanowanego spotkania miedzy grupami sieci (split),
--       konflikt numeru -> max+1 / blad, wywolane nie do przeniesienia, tylko admin
--   T16 close_all: zajete stanowisko -> 'closing' (TERAZ widoczne, bez NASTEPNY), zakaz wywolan
--       i otwierania (FM_DAY_CLOSED), auto-zamkniecie po zakonczeniu, reopen_day
--   T14 tryb testowy + reset_day: tylko super admin, tylko test_mode, nigdy data produkcyjna,
--       w trybie testowym takze po wywolaniach, wpis w logu
-- ============================================================================
BEGIN;

-- ── helpery ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('admin', gen_random_uuid()), ('admin2', gen_random_uuid()), ('op1', gen_random_uuid()), ('op2', gen_random_uuid()), ('op_old', gen_random_uuid()),
  ('sup_user', gen_random_uuid()), ('buyer_user', gen_random_uuid()), ('escalate', gen_random_uuid()),
  ('co1', gen_random_uuid()), ('co2', gen_random_uuid()), ('co3', gen_random_uuid()), ('co4', gen_random_uuid()), ('co5', gen_random_uuid());
CREATE TEMP TABLE t_state (s jsonb);
CREATE TEMP TABLE t_json (j jsonb);
GRANT ALL ON t_ids, t_state, t_json TO anon, authenticated;  -- tabele tymczasowe uzywane tez pod SET ROLE

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT v FROM t_ids t WHERE t.k = id.k); END $$;
-- symulacja sesji PostgREST (auth.uid() / auth.jwt() czytaja request.jwt.claims)
CREATE OR REPLACE FUNCTION pg_temp.login(k text, p_iat bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  ELSE
    -- domyslny iat = teraz + 60 s: now() w transakcji jest stale, a po rotacji PIN-u token musi byc PO pelnej sekundzie rotacji
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(k), 'role', 'authenticated', 'iat', COALESCE(p_iat, extract(epoch FROM now())::bigint + 60))::text, true);
    PERFORM set_config('request.jwt.claim.sub', pg_temp.id(k)::text, true);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.login_noiat(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(k), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.id(k)::text, true);
END $$;
-- expect_error: FAIL zarowno gdy instrukcja przeszla, jak i gdy blad jest inny
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
-- plpgsql (nie sql): ciala nie sa walidowane przy tworzeniu, a tabele tymczasowe powstaja nizej
CREATE OR REPLACE FUNCTION pg_temp.st(k text) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT sid FROM t_st WHERE key = k); END $$;
CREATE OR REPLACE FUNCTION pg_temp.ver(k text) RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT version FROM public.fm_stations WHERE id = pg_temp.st(k)); END $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(k text) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT gid FROM t_g WHERE cid = k); END $$;
CREATE OR REPLACE FUNCTION pg_temp.mtg(k text, n int) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT id FROM public.fm_queue_meetings WHERE queue_group_id = pg_temp.grp(k) AND nr = n); END $$;

-- ── T0 obiekty + trigger ról ─────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fm_queue_call_next','fm_queue_open_day','fm_staff_login_gate','fm_queue_station_state_unsafe','is_staff')) = 5, 'T0 funkcje z 053 istnieja');
SELECT pg_temp.ok((SELECT 'staff' = ANY(enum_range(NULL::public.user_role)::text[])), 'T0 ENUM user_role zawiera staff (052)');

-- uzytkownicy auth: role uprzywilejowane przez app_metadata; 'escalate' probuje admin z user_metadata
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(),
       CASE k WHEN 'admin' THEN '{"provider":"email","role":"admin"}'::jsonb WHEN 'admin2' THEN '{"provider":"email","role":"admin"}' WHEN 'op1' THEN '{"provider":"email","role":"staff"}' WHEN 'op2' THEN '{"provider":"email","role":"staff"}' WHEN 'op_old' THEN '{"provider":"email","role":"staff"}' ELSE '{"provider":"email"}' END,
       CASE k WHEN 'sup_user' THEN '{"role":"supplier"}'::jsonb WHEN 'buyer_user' THEN '{"role":"buyer"}' WHEN 'escalate' THEN '{"role":"admin"}' ELSE '{}' END
FROM t_ids WHERE k IN ('admin','admin2','op1','op2','op_old','sup_user','buyer_user','escalate');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('admin')) = 'admin', 'T0 admin z app_metadata');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('op1')) = 'staff', 'T0 staff z app_metadata');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('escalate')) = 'supplier', 'T0 role admin z user_metadata ZIGNOROWANA (eskalacja zablokowana)');
UPDATE public.profiles SET admin_level = 'super' WHERE id = pg_temp.id('admin');

-- fixtures: obsluga (dzisiaj wg Europe/Warsaw), firmy, sieci, grupy, stanowiska, spotkania
CREATE TEMP TABLE t_day AS SELECT (now() AT TIME ZONE 'Europe/Warsaw')::date AS today;
INSERT INTO public.fm_staff (id, code, event_date, pin_rotated_at) VALUES
  (pg_temp.id('op1'), 'TEST-OP1', (SELECT today FROM t_day), now() - interval '1 day'), (pg_temp.id('op2'), 'TEST-OP2', (SELECT today FROM t_day), now() - interval '1 day'),
  (pg_temp.id('op_old'), 'TEST-OLD', (SELECT today - 1 FROM t_day), now() - interval '1 day');
INSERT INTO public.companies (id, name, categories) VALUES
  (pg_temp.id('co1'), 'TEST Firma 1', '{owoce}'), (pg_temp.id('co2'), 'TEST Firma 2', '{owoce}'), (pg_temp.id('co3'), 'TEST Firma 3', '{kwiaty}'),
  (pg_temp.id('co4'), 'TEST Firma 4', '{}'), (pg_temp.id('co5'), 'TEST Firma 5', '{owoce}');
UPDATE public.profiles SET company_id = pg_temp.id('co2') WHERE id = pg_temp.id('sup_user');
INSERT INTO public.retailers (id, name, fm26_active, fm26_chain_id) VALUES (990001, 'TEST Siec A', true, 'test-a'), (990002, 'TEST Siec B', true, 'test-b'), (990003, 'TEST Siec C', true, 'test-c');
CREATE TEMP TABLE t_ret AS SELECT id, fm26_chain_id AS cid FROM public.retailers WHERE fm26_chain_id IN ('test-a','test-b','test-c');
UPDATE public.profiles SET retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-a') WHERE id = pg_temp.id('buyer_user');

INSERT INTO public.fm_queue_groups (event_date, retailer_id, gate) SELECT (SELECT today FROM t_day), id, 1 FROM t_ret WHERE cid IN ('test-a','test-b');
CREATE TEMP TABLE t_g AS SELECT g.id AS gid, r.cid FROM public.fm_queue_groups g JOIN t_ret r ON r.id = g.retailer_id;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 1 FROM t_g;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 2 FROM t_g WHERE cid = 'test-b';  -- parallel ×2
CREATE TEMP TABLE t_st AS SELECT (g.cid || '-' || s.idx) AS key, s.id AS sid FROM public.fm_stations s JOIN t_g g ON g.gid = s.queue_group_id;
GRANT SELECT ON t_day, t_ret, t_g, t_st TO anon, authenticated;
INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr) SELECT gid, pg_temp.id('co' || n), n FROM t_g, generate_series(1,4) n;
INSERT INTO public.fm_queue_assignments (operator_id, queue_group_id) VALUES (pg_temp.id('op1'), pg_temp.grp('test-a')), (pg_temp.id('op2'), pg_temp.grp('test-b'));

-- ── T1 anon ──────────────────────────────────────────────────────────────────
SELECT pg_temp.login(NULL);
SET LOCAL ROLE anon;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_board_v WHERE event_date = (SELECT today FROM t_day)) = 3, 'T1 anon widzi 3 stanowiska w widoku');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fm_queue_board_v' AND column_name IN ('company_id','name','exception_name','operator_id')), 'T1 widok bez kolumn z firma/operatorem');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_queue_meetings', 'permission denied');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_staff', 'permission denied');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_login_attempts', 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), 0, 'idem-anon-00000')$q$, 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state(pg_temp.st('test-a-1'))$q$, 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state_unsafe(pg_temp.st('test-a-1'))$q$, 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_staff_login_gate('TEST-OP1', '1.2.3.4', 'dev-tablet-0001')$q$, 'permission denied');
SELECT pg_temp.ok(public.fm_queue_public_snapshot((SELECT today FROM t_day))::text NOT LIKE '%TEST Firma%', 'T1 snapshot bez nazw firm');
RESET ROLE;

-- ── T2 uprawnienia ───────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(NULL);
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, 'idem-noauth-0001')$q$, 'FM_AUTH_REQUIRED');
SELECT pg_temp.login('op2');  -- przypisany tylko do B
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, 'idem-op2-a-00001')$q$, 'FM_NOT_ASSIGNED');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state(pg_temp.st('test-a-1'))$q$, 'FM_NOT_ASSIGNED');
SELECT pg_temp.login('sup_user');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, 'idem-sup-000001')$q$, 'FM_FORBIDDEN');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state(pg_temp.st('test-a-1'))$q$, 'FM_FORBIDDEN');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state_unsafe(pg_temp.st('test-a-1'))$q$, 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_my_stations(NULL)$q$, 'FM_FORBIDDEN');
SELECT pg_temp.login('buyer_user');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_station_state(pg_temp.st('test-a-1'))$q$, 'FM_FORBIDDEN');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), 0, 'idem-buyer-00001')$q$, 'FM_FORBIDDEN');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_day((SELECT today FROM t_day), false)$q$, 'FM_FORBIDDEN');
SELECT pg_temp.login('op_old');  -- konto z wczorajsza data eventu
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_my_stations(NULL)$q$, 'FM_FORBIDDEN');

-- ── T3 call_next ─────────────────────────────────────────────────────────────
SELECT pg_temp.login('op1');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, NULL)$q$, 'FM_IDEM_REQUIRED');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, 'x')$q$, 'FM_IDEM_REQUIRED');
INSERT INTO t_state SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), 0, 'idem-open-a1-0001');
SELECT pg_temp.ok((SELECT s->>'mode' FROM t_state) = 'open', 'T3 open');
SELECT pg_temp.ok((SELECT s->>'mode' FROM (SELECT public.fm_queue_station_state(pg_temp.st('test-a-1')) s) x) = 'open', 'T3 przypisany operator czyta station_state');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-call-a1-0001');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 1 AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 1, 'T3 wywolany nr 1');
SELECT pg_temp.ok((SELECT s->'current'->>'name' FROM t_state) = 'TEST Firma 1', 'T3 operator widzi nazwe firmy');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-call-a1-0002')$q$, 'FM_STATION_BUSY');

-- ── T8 version conflict ──────────────────────────────────────────────────────
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_start(pg_temp.st('test-a-1'), 999, 'idem-start-a1-9999')$q$, 'FM_CONFLICT');

-- ── T9 idempotencja ──────────────────────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_start(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-start-a1-0001');
SELECT pg_temp.ok((SELECT s->'current'->>'status' FROM t_state) = 'in_progress', 'T9 start');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_start(pg_temp.st('test-a-1'), 12345, 'idem-start-a1-0001'); -- powtorka: zla wersja nie ma znaczenia
SELECT pg_temp.ok((SELECT s->'current'->>'status' FROM t_state) = 'in_progress' AND (SELECT (s->>'version')::int FROM t_state) = pg_temp.ver('test-a-1'), 'T9 powtorka zwraca stan, nie wykonuje operacji');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_log WHERE idempotency_key = 'idem-start-a1-0001') = 1, 'T9 jeden wpis logu');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');

-- ── T4 finish_and_call_next ──────────────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-fin-a1-0001', true);
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 2 AND (SELECT s->'current'->>'status' FROM t_state) = 'called', 'T4 nastepny (2) wywolany');
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.fm_queue_meetings WHERE id = pg_temp.mtg('test-a', 1)) = 'done', 'T4 nr 1 done');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_log WHERE idempotency_key IN ('idem-fin-a1-0001','idem-fin-a1-0001:next')) = 2, 'T4 dwa wpisy logu (finish + call_next) z pochodnym kluczem');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');

-- ── T7a cofniecie wywolania ZABRONIONE ───────────────────────────────────────
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_undo(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-undo-a1-0001')$q$, 'FM_UNDO_FORBIDDEN');

-- ── T5 no_show -> powrot -> bariera ──────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_no_show(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-ns-a1-0002');
SELECT pg_temp.ok((SELECT s->'current' FROM t_state) = 'null'::jsonb, 'T5 stanowisko wolne po no_show');
-- T7b: cofniecie no_show (<= 30 s) przywraca spotkanie jako biezace, last_called_nr bez zmian
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_undo(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-undo-a1-0002');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 2 AND (SELECT s->'current'->>'status' FROM t_state) = 'called' AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 2, 'T7 undo no_show przywrocil nr 2 jako wywolany');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_undo(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-undo-a1-0003')$q$, 'FM_UNDO_NOT_LAST');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_no_show(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-ns-a1-0003');
-- nr 2 nieobecny; wywolujemy 3 (biezacy), kolejny to 4 -> bariera powrotu = 4
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-call-a1-0003');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 3, 'T5 wywolany 3');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_mark_returned(pg_temp.mtg('test-a', 2), 'idem-ret-a-0002');
SELECT pg_temp.ok((SELECT (j->>'return_after_nr')::int FROM t_json) = 4, 'T5 bariera = 4 (po biezacym 3 i kolejnym 4)');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-fin-a1-0003', true);
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 4, 'T5 wywolany 4');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_serve_returnee(pg_temp.st('test-a-1'), pg_temp.mtg('test-a', 2), pg_temp.ver('test-a-1'), 'idem-serve-a-0002')$q$, 'FM_STATION_BUSY');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-fin-a1-0004', false);
SELECT pg_temp.ok((SELECT (s->'waiting_returnees'->0->>'ready')::boolean FROM t_state) = true, 'T5 powracajacy gotowy po zakonczeniu 4');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_serve_returnee(pg_temp.st('test-a-1'), pg_temp.mtg('test-a', 2), pg_temp.ver('test-a-1'), 'idem-serve-a-0002');
SELECT pg_temp.ok((SELECT (s->'returnee'->>'nr')::int FROM t_state) = 2 AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 4, 'T5 powracajacy poza tablica, last_called_nr = 4');
SELECT pg_temp.ok((SELECT (x->>'busy_private')::boolean FROM jsonb_array_elements(public.fm_queue_public_snapshot((SELECT today FROM t_day))->'stations') x WHERE (x->>'station_id')::uuid = pg_temp.st('test-a-1')), 'T5 tablica: busy_private=true');
SELECT pg_temp.ok((SELECT x->>'current_nr' FROM jsonb_array_elements(public.fm_queue_public_snapshot((SELECT today FROM t_day))->'stations') x WHERE (x->>'station_id')::uuid = pg_temp.st('test-a-1')) IS NULL, 'T5 tablica nie pokazuje numeru 2');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-call-a1-0005')$q$, 'FM_STATION_BUSY_RETURNEE');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_returnee(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-finret-a-0002');
SELECT pg_temp.ok((SELECT s->'returnee' FROM t_state) = 'null'::jsonb, 'T5 powracajacy zakonczony');

-- ── T6 wyjatek = max+1 ───────────────────────────────────────────────────────
SELECT pg_temp.ok((public.fm_queue_add_exception(pg_temp.grp('test-a'), 'TEST Wyjatek', 'idem-exc-a-0001')->>'nr')::int = 5, 'T6 wyjatek dostal nr 5');
SELECT pg_temp.ok((public.fm_queue_add_exception(pg_temp.grp('test-a'), 'TEST Wyjatek', 'idem-exc-a-0001')->>'nr')::int = 5, 'T6 powtorka z tym samym kluczem nie tworzy 6');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_add_exception(pg_temp.grp('test-a'), '   ', 'idem-exc-a-0002')$q$, 'FM_NAME_REQUIRED');

-- ── T7c last_called_nr NIGDY nie maleje (trigger, nawet superuser) ───────────
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE public.fm_queue_groups SET last_called_nr = last_called_nr - 1 WHERE id = pg_temp.grp('test-a')$q$, 'FM_FORWARD_ONLY');
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE id = pg_temp.grp('test-a')) = 4, 'T7 last_called_nr = 4 po probie cofniecia');

-- ── T10 RLS ──────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');
SELECT pg_temp.ok((SELECT count(DISTINCT queue_group_id) FROM public.fm_queue_meetings) = 1, 'T10 op1 widzi spotkania tylko grupy A');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_groups WHERE event_date = (SELECT today FROM t_day)) = 2, 'T10 staff czyta konfiguracje grup');
SELECT pg_temp.expect_error($q$INSERT INTO public.fm_queue_log (action) VALUES ('hack')$q$, 'permission denied');
SELECT pg_temp.expect_error($q$INSERT INTO public.fm_login_attempts (ip) VALUES ('x')$q$, 'permission denied');
-- RLS na UPDATE bez pasujacej polityki = 0 zmienionych wierszy (cicho), nie blad
UPDATE public.fm_queue_groups SET last_called_nr = 99;
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE id = pg_temp.grp('test-a')) = 4, 'T10 staff nie zmienil last_called_nr (RLS: 0 wierszy)');
UPDATE public.fm_queue_meetings SET note = 'hack';
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings WHERE note = 'hack') = 0, 'T10 staff nie zmienil spotkan (RLS: 0 wierszy)');
UPDATE public.fm_staff SET blocked = false, active = true;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_staff) = 1, 'T10 staff widzi tylko wlasny wiersz fm_staff');
SELECT pg_temp.login('sup_user');  -- dostawca firmy co2
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings) = 2 AND (SELECT count(*) FROM public.fm_queue_meetings WHERE company_id <> pg_temp.id('co2')) = 0, 'T10 dostawca widzi tylko wlasne spotkania (A i B)');
SELECT pg_temp.login('buyer_user');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings) = 0, 'T10 kupiec nie widzi zadnych spotkan');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_staff) = 0, 'T10 kupiec nie widzi kont obslugi');
RESET ROLE;

-- ── T11 parallel: 2 stanowiska, wspolna kolejka ──────────────────────────────
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT public.fm_queue_open_station(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-open-b1-0001');
SELECT public.fm_queue_open_station(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-open-b2-0001');
SELECT public.fm_queue_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-call-b1-0001');
SELECT public.fm_queue_call_next(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-call-b2-0001');
RESET ROLE;
SELECT pg_temp.ok((SELECT array_agg(cm.nr ORDER BY cm.nr) FROM public.fm_stations s JOIN public.fm_queue_meetings cm ON cm.id = s.current_meeting_id WHERE s.queue_group_id = pg_temp.grp('test-b')) = ARRAY[1,2], 'T11 dwa stanowiska maja nr 1 i 2');
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE id = pg_temp.grp('test-b')) = 2, 'T11 last_called_nr grupy = 2');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT public.fm_queue_start(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-start-b1-0001');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-fin-b1-0001', false);
-- A zakonczylo 1, B pokazuje 2: cofniecie zakonczenia na A pokazaloby starszy numer -> ZABRONIONE
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_undo(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-undo-b1-0001')$q$, 'FM_UNDO_FORBIDDEN');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-call-b1-0003');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 3, 'T11 stanowisko 1 dostalo 3 (stanowisko 2 dalej ma 2)');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_no_show(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-ns-b2-0001');
SELECT pg_temp.ok((SELECT s->'current' FROM t_state) = 'null'::jsonb AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 3, 'T11 no_show na stanowisku 2 nie rusza numeru grupy (3)');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_mark_returned(pg_temp.mtg('test-b', 2), 'idem-ret-b-0002');
SELECT pg_temp.ok((SELECT (j->>'return_after_nr')::int FROM t_json) = 4, 'T11 bariera powrotu liczona z calej grupy (biezacy 3 + kolejny 4)');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-call-b2-0002');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 4, 'T11 stanowisko 2 dostalo 4');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-call-b1-0009')$q$, 'FM_STATION_BUSY');
RESET ROLE;

-- ── T12 open_day (import zatwierdzonego planu) ───────────────────────────────
-- siec C: brak grupy (open_day tworzy domyslna); siec A ma juz spotkania (pominieta bez force)
INSERT INTO public.fm_settings (event_date, algo_phase, schedule) VALUES ((SELECT today FROM t_day), 'matching', '{"nums":{}}');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_day((SELECT today FROM t_day), false)$q$, 'FM_PLAN_NOT_PUBLISHED');
RESET ROLE;
UPDATE public.fm_settings SET algo_phase = 'published', schedule = jsonb_build_object('nums', jsonb_build_object(
    pg_temp.id('co1')::text, jsonb_build_object('test-c', 1, 'test-a', 9),
    pg_temp.id('co2')::text, jsonb_build_object('test-c', 2),
    pg_temp.id('co3')::text, jsonb_build_object('test-c', 3),
    pg_temp.id('co4')::text, jsonb_build_object('test-c', 4),
    pg_temp.id('co5')::text, jsonb_build_object('test-c', 5),
    'nieznana-firma', jsonb_build_object('test-c', 6)))
  WHERE event_date = (SELECT today FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), false);
SELECT pg_temp.ok((SELECT (j->>'groups_created')::int FROM t_json) >= 1, 'T12 utworzono grupe dla sieci C (i ew. innych sieci FM bez konfiguracji)');
SELECT pg_temp.ok((SELECT (j->>'inserted')::int FROM t_json) = 5, 'T12 WSZYSTKIE 5 spotkan sieci C zaimportowane');
SELECT pg_temp.ok((SELECT (j->>'skipped_groups')::int FROM t_json) = 1, 'T12 siec A (ma juz spotkania) pominieta bez force');
SELECT pg_temp.ok((SELECT (SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'missing_supplier' AND p->>'sid' = 'nieznana-firma') = 1 FROM t_json), 'T12 nieznana firma w raporcie');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-c') AND m.source = 'plan') = 5, 'T12 5 spotkan w bazie dla sieci C');
-- powtorka bez force: nic nowego; z force + zmieniony numer co5 5->7 -> updated; co4 na 3 (zajete przez co3) -> nr_conflict
UPDATE public.fm_settings SET schedule = jsonb_set(jsonb_set(schedule, ARRAY['nums', pg_temp.id('co5')::text, 'test-c'], '7'), ARRAY['nums', pg_temp.id('co4')::text, 'test-c'], '3') WHERE event_date = (SELECT today FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), false);
SELECT pg_temp.ok((SELECT (j->>'inserted')::int FROM t_json) = 0 AND (SELECT (j->>'skipped_groups')::int FROM t_json) = 2, 'T12 powtorka bez force: 0 nowych, 2 grupy pominiete');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), true);
SELECT pg_temp.ok((SELECT (j->>'updated')::int FROM t_json) = 1, 'T12 force: numer co5 zaktualizowany (5->7)');
SELECT pg_temp.ok((SELECT (SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'nr_conflict') = 1 FROM t_json), 'T12 force: konflikt numeru co4->3 zaraportowany, nie nadpisany');
SELECT pg_temp.ok((SELECT (SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'locked_status') >= 1 FROM t_json), 'T12 force: spotkania sieci A w toku (done/called) nie sa ruszane');
RESET ROLE;
SELECT pg_temp.ok((SELECT nr FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-c') AND m.company_id = pg_temp.id('co5')) = 7, 'T12 co5 ma nr 7');
SELECT pg_temp.ok((SELECT nr FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-c') AND m.company_id = pg_temp.id('co3')) = 3, 'T12 co3 zachowal nr 3');
-- split: siec C dostaje druga grupe 'Kwiaty' (kategorie {kwiaty}); glowna grupa dostaje {owoce}
-- -> co3 (kwiaty) juz zaimportowana do glownej zostaje; nowa firma bez kategorii = 'unrouted'
INSERT INTO public.companies (id, name, categories) VALUES (gen_random_uuid(), 'TEST Firma 6 bez kategorii', '{}');
UPDATE public.fm_queue_groups SET categories = '{owoce}' WHERE retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-c');
INSERT INTO public.fm_queue_groups (event_date, retailer_id, label, categories) VALUES ((SELECT today FROM t_day), (SELECT id FROM t_ret WHERE cid = 'test-c'), 'Kwiaty', '{kwiaty}');
UPDATE public.fm_settings SET schedule = jsonb_set(schedule, ARRAY['nums', (SELECT id::text FROM public.companies WHERE name = 'TEST Firma 6 bez kategorii'), 'test-c'], '8', true) WHERE event_date = (SELECT today FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), true);
SELECT pg_temp.ok((SELECT (SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'unrouted') >= 1 FROM t_json), 'T12 split bez zgodnej kategorii -> unrouted (decyzja admina), nie losowa grupa');
SELECT pg_temp.ok((SELECT (SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'group_changed') = 1 FROM t_json), 'T12 firma z kategoria kwiaty ma juz spotkanie w grupie glownej -> group_changed (nie duplikat)');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = 990003 AND m.company_id = pg_temp.id('co3')) = 1, 'T12 co3 nadal ma dokladnie jedno spotkanie w sieci C');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
RESET ROLE;

-- ── T13 logowanie obslugi (gate/result jako service_role) ────────────────────
CREATE TEMP TABLE t_att (k text PRIMARY KEY, id bigint);
GRANT ALL ON t_att TO anon, authenticated;
SELECT pg_temp.ok((public.fm_staff_login_gate('NIE-MA', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_BAD_CREDENTIALS', 'T13 nieznany kod');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OLD', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_WRONG_DAY', 'T13 konto z inna data eventu');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', NULL)->>'reason') = 'FM_DEVICE_REQUIRED', 'T13 urzadzenie wymagane');
-- rezerwacje: 5 rownoleglych prob dostaje attempt_id, 6. czeka (FM_BUSY) — bez zwiekszania licznika
INSERT INTO t_att SELECT 'a' || g, (public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-0001')->>'attempt_id')::bigint FROM generate_series(1,5) g;
SELECT pg_temp.ok((SELECT count(*) FROM t_att WHERE id IS NOT NULL) = 5, 'T13 5 rezerwacji (attempt_id) dla 5 prob');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_BUSY', 'T13 6. rownolegla proba czeka (FM_BUSY), licznik bez zmian');
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 0, 'T13 rezerwacja nie zwieksza failed_logins');
-- awaria infrastruktury: rozliczenie system_error NIE liczy sie jako bledny PIN
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'a1'), 'system_error', 'dev-tablet-0001')->>'reason') = 'FM_SYSTEM_ERROR', 'T13 system_error rozliczone');
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 0, 'T13 awaria GoTrue nie zwieksza licznika');
-- 4 faktycznie bledne PIN-y: brak lockoutu; 5. bledny -> lockout
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'a' || g), 'invalid_credentials', 'dev-tablet-0001')->>'locked')::boolean = false, 'T13 bledny PIN bez lockoutu (1-4)') FROM generate_series(2,5) g;
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 4 AND (SELECT locked_until FROM public.fm_staff WHERE code = 'TEST-OP1') IS NULL, 'T13 4 bledne = brak blokady');
-- rozliczenie tej samej proby drugi raz -> odrzucone (kazda proba liczona raz)
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'a2'), 'invalid_credentials', 'dev-tablet-0001')->>'reason') = 'FM_ATTEMPT_SETTLED', 'T13 attempt_id rozliczany tylko raz');
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 4, 'T13 powtorne rozliczenie nie liczy sie');
-- POPRAWNY PIN przy 5. probie -> sukces, licznik zerowany, urzadzenie przypiete
INSERT INTO t_att SELECT 'a6', (public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-0001')->>'attempt_id')::bigint;
SELECT pg_temp.ok((SELECT id IS NOT NULL FROM t_att WHERE k = 'a6'), 'T13 5. proba jest jeszcze dopuszczona (4 bledne)');
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'a6'), 'success', 'dev-tablet-0001')->>'device_id') = 'dev-tablet-0001', 'T13 poprawny PIN przy 5. probie = sukces');
SELECT pg_temp.ok((SELECT failed_logins = 0 AND device_id = 'dev-tablet-0001' FROM public.fm_staff WHERE code = 'TEST-OP1'), 'T13 licznik wyzerowany, urzadzenie przypiete');
-- 5 faktycznie blednych = lockout (piaty bledny jest sprawdzany, potem blokada)
-- (inne IP: limit 10/15 min na ip+kod+urzadzenie zostal juz zuzyty seria 'a' — to celowo osobny klucz)
INSERT INTO t_att SELECT 'b' || g, (public.fm_staff_login_gate('TEST-OP1', '10.0.0.11', 'dev-tablet-0001')->>'attempt_id')::bigint FROM generate_series(1,5) g;
SELECT pg_temp.ok((SELECT count(*) FROM t_att WHERE k LIKE 'b%' AND id IS NOT NULL) = 5, 'T13 5 nowych rezerwacji po sukcesie');
SELECT public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'b' || g), 'invalid_credentials', 'dev-tablet-0001') FROM generate_series(1,4) g;
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'b5'), 'invalid_credentials', 'dev-tablet-0001')->>'locked')::boolean, 'T13 5. bledny PIN = lockout');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.11', 'dev-tablet-0001')->>'reason') = 'FM_LOCKED', 'T13 gate: FM_LOCKED');
-- uplyw 15 minut: locked_until w przeszlosci, failed_logins nadal 5 -> gate MUSI wyzerowac i przepuscic (nie FM_BUSY)
UPDATE public.fm_staff SET locked_until = now() - interval '1 second' WHERE code = 'TEST-OP1';
INSERT INTO t_att SELECT 'd1', (public.fm_staff_login_gate('TEST-OP1', '10.0.0.13', 'dev-tablet-0001')->>'attempt_id')::bigint;
SELECT pg_temp.ok((SELECT id IS NOT NULL FROM t_att WHERE k = 'd1'), 'T13 po wygasnieciu lockoutu logowanie znow dozwolone');
SELECT pg_temp.ok((SELECT failed_logins = 0 AND locked_until IS NULL FROM public.fm_staff WHERE code = 'TEST-OP1'), 'T13 wygasly lockout wyzerowal licznik');
SELECT public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'd1'), 'system_error', 'dev-tablet-0001');
UPDATE public.fm_staff SET locked_until = NULL, failed_logins = 0 WHERE code = 'TEST-OP1';
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.12', 'dev-tablet-INNY')->>'reason') = 'FM_DEVICE_MISMATCH', 'T13 inne urzadzenie odrzucone w gate');
-- wygasanie nierozliczonej rezerwacji (funkcja Netlify padla): po 60 s nie blokuje kolejnych prob
INSERT INTO t_att SELECT 'c' || g, (public.fm_staff_login_gate('TEST-OP2', '10.0.0.2', 'dev-tablet-A000')->>'attempt_id')::bigint FROM generate_series(1,5) g;
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP2', '10.0.0.2', 'dev-tablet-A000')->>'reason') = 'FM_BUSY', 'T13 5 wiszacych rezerwacji -> FM_BUSY');
UPDATE public.fm_login_attempts SET ts = now() - interval '2 minutes' WHERE code = 'TEST-OP2' AND status = 'pending';  -- symulacja uplywu 60 s
INSERT INTO t_att SELECT 'c6', (public.fm_staff_login_gate('TEST-OP2', '10.0.0.2', 'dev-tablet-A000')->>'attempt_id')::bigint;
SELECT pg_temp.ok((SELECT id IS NOT NULL FROM t_att WHERE k = 'c6'), 'T13 wygasle rezerwacje nie blokuja (status error, licznik 0)');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_login_attempts WHERE code = 'TEST-OP2' AND status = 'error') = 5 AND (SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP2') = 0, 'T13 wygasle = error, bez lockoutu');
-- wyscig dwoch tabletow przy pustym device_id: przypiecie w jednym UPDATE
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'c6'), 'success', 'dev-tablet-A000')->>'device_id') = 'dev-tablet-A000', 'T13 tablet A przypiety');
INSERT INTO t_att SELECT 'c7', (public.fm_staff_login_gate('TEST-OP2', '10.0.0.2', 'dev-tablet-A000')->>'attempt_id')::bigint;
UPDATE public.fm_login_attempts SET device_id = 'dev-tablet-B000' WHERE id = (SELECT id FROM t_att WHERE k = 'c7');  -- drugi tablet, ktory przeszedl gate przed przypieciem
SELECT pg_temp.ok((public.fm_staff_login_result((SELECT id FROM t_att WHERE k = 'c7'), 'success', 'dev-tablet-B000')->>'reason') = 'FM_DEVICE_MISMATCH', 'T13 tablet B (po udanym GoTrue) odrzucony -> funkcja uniewaznia jego sesje');
SELECT pg_temp.ok((SELECT device_id FROM public.fm_staff WHERE code = 'TEST-OP2') = 'dev-tablet-A000', 'T13 w bazie zostal tablet A');
-- limit ip+kod+urzadzenie (10/15 min) niezalezny od lockoutu; inny kod z tego samego IP nadal moze
SELECT public.fm_staff_login_gate('NIE-MA-2', '10.0.0.9', 'dev-tablet-0009') FROM generate_series(1,10);
SELECT pg_temp.ok((public.fm_staff_login_gate('NIE-MA-2', '10.0.0.9', 'dev-tablet-0009')->>'reason') = 'FM_RATE_LIMIT', 'T13 limit ip+kod+urzadzenie po 10 probach');
SELECT pg_temp.ok((public.fm_staff_login_gate('NIE-MA-3', '10.0.0.9', 'dev-tablet-0010')->>'reason') = 'FM_BAD_CREDENTIALS', 'T13 inny kod/tablet z tego samego IP (wspolne Wi-Fi) nie jest blokowany');
-- blokada fail-closed: fm_staff_set_blocked = blocked + sesje w jednej transakcji
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (gen_random_uuid(), pg_temp.id('op2'), now(), now());
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_staff_set_blocked(pg_temp.id('op2'), true);
SELECT pg_temp.ok((SELECT (j->>'blocked')::boolean AND (j->>'sessions_revoked')::int = 1 FROM t_json), 'T13 set_blocked: zablokowane + sesja uniewazniona atomowo');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP2', '10.0.0.2', 'dev-tablet-A000')->>'reason') = 'FM_BLOCKED', 'T13 zablokowane konto nie loguje sie');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login('op2', extract(epoch FROM now() - interval '1 hour')::bigint);  -- token sprzed blokady
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 zablokowane konto: stary token odrzucony');
SELECT pg_temp.login('op2');  -- nawet swiezy token: konto zablokowane
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 zablokowane konto: is_staff() = false (RPC/RLS odciete)');
RESET ROLE;
SELECT public.fm_staff_set_blocked(pg_temp.id('op2'), false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.login('op2', extract(epoch FROM now() - interval '1 hour')::bigint);  -- ten sam stary token po odblokowaniu
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 po odblokowaniu stary token NADAL odrzucony (prog tokens_valid_from)');
SELECT pg_temp.login('op2');  -- nowe logowanie (iat > prog)
SELECT pg_temp.ok(public.is_staff(), 'T13 po odblokowaniu nowy token dziala');
RESET ROLE;
SELECT pg_temp.expect_error($q$SELECT public.fm_staff_set_blocked(gen_random_uuid(), true)$q$, 'FM_NOT_FOUND');
-- revoke_sessions + rotacja PIN: stare tokeny (iat <= sekunda rotacji) i tokeny bez iat sa odrzucane
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (gen_random_uuid(), pg_temp.id('op1'), now(), now());
SELECT pg_temp.ok((public.fm_staff_revoke_sessions(pg_temp.id('op1'), true)->>'sessions_revoked')::int = 1, 'T13 sesja uniewazniona');
SELECT pg_temp.ok((SELECT device_id IS NULL AND pin_rotated_at > now() - interval '1 minute' FROM public.fm_staff WHERE code = 'TEST-OP1'), 'T13 urzadzenie odpiete, pin_rotated_at ustawione');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login('op1', extract(epoch FROM now() - interval '1 hour')::bigint);
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 stary token: is_staff() = false');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_my_stations(NULL)$q$, 'FM_FORBIDDEN');
SELECT pg_temp.login('op1', (SELECT floor(extract(epoch FROM pin_rotated_at))::bigint FROM public.fm_staff WHERE code = 'TEST-OP1'));
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 token z ta sama sekunda co rotacja: odrzucony (bez tolerancji)');
SELECT pg_temp.login_noiat('op1');
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 token bez iat po rotacji: is_staff() = false');
SELECT pg_temp.login('op1', (SELECT floor(extract(epoch FROM pin_rotated_at))::bigint + 1 FROM public.fm_staff WHERE code = 'TEST-OP1'));
SELECT pg_temp.ok(public.is_staff(), 'T13 token wystawiony sekunde po rotacji: OK');
RESET ROLE;

-- ── T15 przeniesienie spotkania miedzy grupami (split) ───────────────────────
-- siec C: grupa glowna {owoce} i 'Kwiaty' {kwiaty}; co3 (kwiaty) siedzi w glownej z nr 3 -> przenies
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_move_meeting(
  (SELECT m.id FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = 990003 AND g.label IS NULL AND m.company_id = pg_temp.id('co3')),
  (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990003 AND label = 'Kwiaty'), NULL);
SELECT pg_temp.ok((SELECT (j->>'nr')::int FROM t_json) = 3, 'T15 przeniesione z zachowaniem numeru 3 (wolny w celu)');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_move_meeting(%L, %L, 3)$q$,
  (SELECT m.id FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = 990003 AND g.label IS NULL AND m.company_id = pg_temp.id('co2')),
  (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990003 AND label = 'Kwiaty')), 'FM_NR_CONFLICT');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_move_meeting(
  (SELECT m.id FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = 990003 AND g.label IS NULL AND m.company_id = pg_temp.id('co2')),
  (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990003 AND label = 'Kwiaty'), NULL);
SELECT pg_temp.ok((SELECT (j->>'nr')::int FROM t_json) = 2, 'T15 wolny numer zachowany (2)');
RESET ROLE;
-- grupa docelowa wywolala juz numery do 5: przeniesienie nr 4 (<= last_called) dostaje kolejny wolny = 6
UPDATE public.fm_queue_groups SET last_called_nr = 5 WHERE retailer_id = 990003 AND label = 'Kwiaty';
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_move_meeting(
  (SELECT m.id FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = 990003 AND g.label IS NULL AND m.company_id = pg_temp.id('co4')),
  (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990003 AND label = 'Kwiaty'), NULL);
SELECT pg_temp.ok((SELECT (j->>'nr')::int FROM t_json) = 6, 'T15 numer <= last_called_nr celu -> kolejny wolny (6)');
RESET ROLE;
INSERT INTO public.fm_queue_groups (event_date, retailer_id, label) VALUES ((SELECT today FROM t_day), 990001, 'Druga');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_move_meeting(%L, %L, NULL)$q$, pg_temp.mtg('test-a', 1), (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990001 AND label = 'Druga')), 'FM_BAD_STATUS');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_move_meeting(%L, %L, NULL)$q$, pg_temp.mtg('test-a', 5), (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990003 AND label = 'Kwiaty')), 'FM_BAD_TARGET');
SELECT pg_temp.login('op1');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_move_meeting(%L, %L, NULL)$q$, pg_temp.mtg('test-a', 5), (SELECT id FROM public.fm_queue_groups WHERE retailer_id = 990001 AND label = 'Druga')), 'FM_FORBIDDEN');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_log WHERE action = 'move_meeting') = 3, 'T15 trzy wpisy move_meeting w logu');

-- ── T16 Zamknij wszystkie przy trwajacym spotkaniu -> 'closing' ──────────────
-- po T11: b-1 ma nr 3 (called), b-2 ma nr 4 (called); a-1 wolne (open)
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT public.fm_queue_start(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-start-b1-0003');
SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_close_all((SELECT today FROM t_day));
RESET ROLE;
SELECT pg_temp.ok((SELECT mode FROM public.fm_stations WHERE id = pg_temp.st('test-b-1')) = 'closing', 'T16 zajete stanowisko -> closing');
SELECT pg_temp.ok((SELECT mode FROM public.fm_stations WHERE id = pg_temp.st('test-a-1')) = 'closed', 'T16 wolne stanowisko -> closed');
SELECT pg_temp.ok((SELECT (x->>'current_nr')::int FROM jsonb_array_elements(public.fm_queue_public_snapshot((SELECT today FROM t_day))->'stations') x WHERE (x->>'station_id')::uuid = pg_temp.st('test-b-1')) = 3, 'T16 tablica: trwajace spotkanie nadal widoczne (mode closing)');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-call-b1-0099')$q$, 'FM_STATION_NOT_OPEN');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_set_mode(pg_temp.st('test-b-2'), 'open', pg_temp.ver('test-b-2'), 'idem-mode-b2-0099')$q$, 'FM_DAY_CLOSED');
SELECT pg_temp.login('op1');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-open-a1-0099')$q$, 'FM_DAY_CLOSED');
SELECT pg_temp.login('op2');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-fin-b1-0003', true);
SELECT pg_temp.ok((SELECT s->>'mode' FROM t_state) = 'closed' AND (SELECT s->'current' FROM t_state) = 'null'::jsonb, 'T16 po zakonczeniu: closing -> closed, bez wywolania nastepnego');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_no_show(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-ns-b2-0004');
SELECT pg_temp.ok((SELECT s->>'mode' FROM t_state) = 'closed', 'T16 no_show w closing -> closed');
-- reopen_day przy stanowisku w 'closing': wraca do 'open' z nowa wersja; 'closed' zostaje
RESET ROLE;
INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr) VALUES (pg_temp.grp('test-b'), pg_temp.id('co5'), 5);  -- jeszcze jedno spotkanie do wywolania
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT public.fm_queue_open_station(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-open-b2-0200') FROM (SELECT 1) x WHERE false;  -- (dzien zamkniety: nie otwieramy)
SELECT pg_temp.login('admin');
SELECT public.fm_queue_reopen_day((SELECT today FROM t_day));
SELECT pg_temp.login('op2');
SELECT public.fm_queue_open_station(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-open-b2-0201');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next(pg_temp.st('test-b-2'), pg_temp.ver('test-b-2'), 'idem-call-b2-0201');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 5, 'T16 po reopen b-2 wywolal 5');
SELECT pg_temp.login('admin');
SELECT public.fm_queue_close_all((SELECT today FROM t_day));
RESET ROLE;
SELECT pg_temp.ok((SELECT mode FROM public.fm_stations WHERE id = pg_temp.st('test-b-2')) = 'closing', 'T16 b-2 zajete -> closing');
CREATE TEMP TABLE t_ver AS SELECT version AS v FROM public.fm_stations WHERE id = pg_temp.st('test-b-2');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_reopen_day((SELECT today FROM t_day));
SELECT pg_temp.ok((SELECT (j->>'reopened_stations')::int FROM t_json) = 1, 'T16 reopen_day: 1 stanowisko closing -> open');
RESET ROLE;
SELECT pg_temp.ok((SELECT mode = 'open' AND version = (SELECT v FROM t_ver) + 1 FROM public.fm_stations WHERE id = pg_temp.st('test-b-2')), 'T16 b-2 znow open, version + 1');
SELECT pg_temp.ok((SELECT mode FROM public.fm_stations WHERE id = pg_temp.st('test-b-1')) = 'closed', 'T16 b-1 (closed) zostaje closed');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');
SELECT pg_temp.ok((SELECT s->>'mode' FROM (SELECT public.fm_queue_open_station(pg_temp.st('test-a-1'), pg_temp.ver('test-a-1'), 'idem-open-a1-0100') s) x) = 'open', 'T16 po reopen_day mozna otworzyc');
RESET ROLE;

-- ── T14 tryb testowy + reset dnia ────────────────────────────────────────────
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
-- dzisiaj = data produkcyjna (fm_settings.event_date): tryb testowy i reset zabronione
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_set_test_mode((SELECT today FROM t_day), true)$q$, 'FM_PRODUCTION_DATE');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_reset_day(%L, %L)$q$, (SELECT today FROM t_day), 'RESET ' || to_char((SELECT today FROM t_day), 'YYYY-MM-DD')), 'FM_NOT_TEST_MODE');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_reset_day((SELECT today FROM t_day), 'zle potwierdzenie')$q$, 'FM_CONFIRM_REQUIRED');
RESET ROLE;
-- dzien testowy (jutro): grupa + spotkanie + wywolanie
INSERT INTO public.fm_queue_groups (event_date, retailer_id) VALUES ((SELECT today + 1 FROM t_day), 990001);
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT id, 1 FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day);
INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr) SELECT id, pg_temp.id('co1'), 1 FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day);
UPDATE public.fm_queue_groups SET last_called_nr = 1 WHERE event_date = (SELECT today + 1 FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin2');  -- zwykly admin (bez admin_level='super')
SELECT pg_temp.ok(NOT public.is_super_admin() AND public.is_admin(), 'T14 admin2 jest zwyklym adminem');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_set_test_mode((SELECT today + 1 FROM t_day), true)$q$, 'FM_FORBIDDEN');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_reset_day(%L, %L)$q$, (SELECT today + 1 FROM t_day), 'RESET ' || to_char((SELECT today + 1 FROM t_day), 'YYYY-MM-DD')), 'FM_FORBIDDEN');
SELECT pg_temp.login('admin');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_reset_day(%L, %L)$q$, (SELECT today + 1 FROM t_day), 'RESET ' || to_char((SELECT today + 1 FROM t_day), 'YYYY-MM-DD')), 'FM_NOT_TEST_MODE');
SELECT pg_temp.ok((public.fm_queue_set_test_mode((SELECT today + 1 FROM t_day), true)->>'test_mode')::boolean, 'T14 tryb testowy wlaczony (super admin, data nieprodukcyjna)');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_reset_day((SELECT today + 1 FROM t_day), 'RESET ' || to_char((SELECT today + 1 FROM t_day), 'YYYY-MM-DD'));
SELECT pg_temp.ok((SELECT (j->>'deleted_meetings')::int FROM t_json) = 1, 'T14 reset dnia testowego usunal spotkania (takze po wywolaniach)');
RESET ROLE;
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day)) = 0, 'T14 last_called_nr wyzerowany TYLKO przez reset_day');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_log WHERE action IN ('reset_day','set_test_mode')) = 2, 'T14 reset i tryb testowy w logu append-only');

SELECT '✅ OK — wszystkie testy 053_fm_queue_test (T0–T16) przeszly' AS wynik;
ROLLBACK;
