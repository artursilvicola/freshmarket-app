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
--   T13 logowanie: gate/result — zly kod, zly dzien, urzadzenie wymagane, lockout po 5,
--       reset przy sukcesie, przypiecie i niezgodnosc urzadzenia, limit per IP,
--       revoke_sessions + pin_rotated_at uniewaznia stare tokeny dla is_staff()
--   T14 reset_day: zabroniony dla dnia z ruchem, dozwolony dla dnia testowego
-- ============================================================================
BEGIN;

-- ── helpery ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('admin', gen_random_uuid()), ('op1', gen_random_uuid()), ('op2', gen_random_uuid()), ('op_old', gen_random_uuid()),
  ('sup_user', gen_random_uuid()), ('buyer_user', gen_random_uuid()), ('escalate', gen_random_uuid()),
  ('co1', gen_random_uuid()), ('co2', gen_random_uuid()), ('co3', gen_random_uuid()), ('co4', gen_random_uuid()), ('co5', gen_random_uuid());
CREATE TEMP TABLE t_state (s jsonb);
CREATE TEMP TABLE t_json (j jsonb);

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t_ids WHERE k = $1 $$;
-- symulacja sesji PostgREST (auth.uid() / auth.jwt() czytaja request.jwt.claims)
CREATE OR REPLACE FUNCTION pg_temp.login(k text, p_iat bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(k), 'role', 'authenticated', 'iat', COALESCE(p_iat, extract(epoch FROM now())::bigint))::text, true);
    PERFORM set_config('request.jwt.claim.sub', pg_temp.id(k)::text, true);
  END IF;
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
CREATE OR REPLACE FUNCTION pg_temp.st(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT sid FROM t_st WHERE key = $1 $$;
CREATE OR REPLACE FUNCTION pg_temp.ver(k text) RETURNS int LANGUAGE sql AS $$ SELECT version FROM public.fm_stations WHERE id = pg_temp.st($1) $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT gid FROM t_g WHERE cid = $1 $$;
CREATE OR REPLACE FUNCTION pg_temp.mtg(k text, n int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.fm_queue_meetings WHERE queue_group_id = pg_temp.grp($1) AND nr = $2 $$;

-- ── T0 obiekty + trigger ról ─────────────────────────────────────────────────
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fm_queue_call_next','fm_queue_open_day','fm_staff_login_gate','fm_queue_station_state_unsafe','is_staff')) = 5, 'T0 funkcje z 053 istnieja');
SELECT pg_temp.ok((SELECT 'staff' = ANY(enum_range(NULL::public.user_role)::text[])), 'T0 ENUM user_role zawiera staff (052)');

-- uzytkownicy auth: role uprzywilejowane przez app_metadata; 'escalate' probuje admin z user_metadata
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(),
       CASE k WHEN 'admin' THEN '{"provider":"email","role":"admin"}'::jsonb WHEN 'op1' THEN '{"provider":"email","role":"staff"}' WHEN 'op2' THEN '{"provider":"email","role":"staff"}' WHEN 'op_old' THEN '{"provider":"email","role":"staff"}' ELSE '{"provider":"email"}' END,
       CASE k WHEN 'sup_user' THEN '{"role":"supplier"}'::jsonb WHEN 'buyer_user' THEN '{"role":"buyer"}' WHEN 'escalate' THEN '{"role":"admin"}' ELSE '{}' END
FROM t_ids WHERE k IN ('admin','op1','op2','op_old','sup_user','buyer_user','escalate');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('admin')) = 'admin', 'T0 admin z app_metadata');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('op1')) = 'staff', 'T0 staff z app_metadata');
SELECT pg_temp.ok((SELECT role::text FROM public.profiles WHERE id = pg_temp.id('escalate')) = 'supplier', 'T0 role admin z user_metadata ZIGNOROWANA (eskalacja zablokowana)');
UPDATE public.profiles SET admin_level = 'super' WHERE id = pg_temp.id('admin');

-- fixtures: obsluga (dzisiaj wg Europe/Warsaw), firmy, sieci, grupy, stanowiska, spotkania
CREATE TEMP TABLE t_day AS SELECT (now() AT TIME ZONE 'Europe/Warsaw')::date AS today;
INSERT INTO public.fm_staff (id, code, event_date) VALUES
  (pg_temp.id('op1'), 'TEST-OP1', (SELECT today FROM t_day)), (pg_temp.id('op2'), 'TEST-OP2', (SELECT today FROM t_day)),
  (pg_temp.id('op_old'), 'TEST-OLD', (SELECT today - 1 FROM t_day));
INSERT INTO public.companies (id, name, categories) VALUES
  (pg_temp.id('co1'), 'TEST Firma 1', '{owoce}'), (pg_temp.id('co2'), 'TEST Firma 2', '{owoce}'), (pg_temp.id('co3'), 'TEST Firma 3', '{kwiaty}'),
  (pg_temp.id('co4'), 'TEST Firma 4', '{}'), (pg_temp.id('co5'), 'TEST Firma 5', '{owoce}');
UPDATE public.profiles SET company_id = pg_temp.id('co2') WHERE id = pg_temp.id('sup_user');
INSERT INTO public.retailers (name, fm26_active, fm26_chain_id) VALUES ('TEST Siec A', true, 'test-a'), ('TEST Siec B', true, 'test-b'), ('TEST Siec C', true, 'test-c');
CREATE TEMP TABLE t_ret AS SELECT id, fm26_chain_id AS cid FROM public.retailers WHERE fm26_chain_id IN ('test-a','test-b','test-c');
UPDATE public.profiles SET retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-a') WHERE id = pg_temp.id('buyer_user');

INSERT INTO public.fm_queue_groups (event_date, retailer_id, gate) SELECT (SELECT today FROM t_day), id, 1 FROM t_ret WHERE cid IN ('test-a','test-b');
CREATE TEMP TABLE t_g AS SELECT g.id AS gid, r.cid FROM public.fm_queue_groups g JOIN t_ret r ON r.id = g.retailer_id;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 1 FROM t_g;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 2 FROM t_g WHERE cid = 'test-b';  -- parallel ×2
CREATE TEMP TABLE t_st AS SELECT (g.cid || '-' || s.idx) AS key, s.id AS sid FROM public.fm_stations s JOIN t_g g ON g.gid = s.queue_group_id;
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
SELECT pg_temp.expect_error($q$INSERT INTO public.fm_queue_log (action) VALUES ('hack')$q$, 'row-level security');
SELECT pg_temp.expect_error($q$UPDATE public.fm_queue_groups SET last_called_nr = 99$q$, 'row-level security');
SELECT pg_temp.expect_error($q$UPDATE public.fm_queue_meetings SET status = 'done'$q$, 'row-level security');
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
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next(pg_temp.st('test-b-1'), pg_temp.ver('test-b-1'), 'idem-fin-b1-0001', true);
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
    pg_temp.id('co1')::text, jsonb_build_object('test-c', 1, 'test-a', 1),
    pg_temp.id('co2')::text, jsonb_build_object('test-c', 2),
    pg_temp.id('co3')::text, jsonb_build_object('test-c', 3),
    pg_temp.id('co4')::text, jsonb_build_object('test-c', 4),
    pg_temp.id('co5')::text, jsonb_build_object('test-c', 5),
    'nieznana-firma', jsonb_build_object('test-c', 6)))
  WHERE event_date = (SELECT today FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), false);
SELECT pg_temp.ok((SELECT (j->>'groups_created')::int FROM t_json) = 1, 'T12 utworzono grupe dla sieci C');
SELECT pg_temp.ok((SELECT (j->>'inserted')::int FROM t_json) = 5, 'T12 WSZYSTKIE 5 spotkan sieci C zaimportowane');
SELECT pg_temp.ok((SELECT (j->>'skipped_groups')::int FROM t_json) = 1, 'T12 siec A (ma juz spotkania) pominieta bez force');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'missing_supplier' AND p->>'sid' = 'nieznana-firma') = 1 FROM t_json), 'T12 nieznana firma w raporcie');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings m JOIN public.fm_queue_groups g ON g.id = m.queue_group_id WHERE g.retailer_id = (SELECT id FROM t_ret WHERE cid = 'test-c') AND m.source = 'plan') = 5, 'T12 5 spotkan w bazie dla sieci C');
-- powtorka bez force: nic nowego; z force + zmieniony numer co5 5->7 -> updated; co4 na 3 (zajete przez co3) -> nr_conflict
UPDATE public.fm_settings SET schedule = jsonb_set(jsonb_set(schedule, ARRAY['nums', pg_temp.id('co5')::text, 'test-c'], '7'), ARRAY['nums', pg_temp.id('co4')::text, 'test-c'], '3') WHERE event_date = (SELECT today FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), false);
SELECT pg_temp.ok((SELECT (j->>'inserted')::int FROM t_json) = 0 AND (SELECT (j->>'skipped_groups')::int FROM t_json) = 2, 'T12 powtorka bez force: 0 nowych, 2 grupy pominiete');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_open_day((SELECT today FROM t_day), true);
SELECT pg_temp.ok((SELECT (j->>'updated')::int FROM t_json) = 1, 'T12 force: numer co5 zaktualizowany (5->7)');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'nr_conflict') = 1 FROM t_json), 'T12 force: konflikt numeru co4->3 zaraportowany, nie nadpisany');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'locked_status') >= 1 FROM t_json), 'T12 force: spotkania sieci A w toku (done/called) nie sa ruszane');
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
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(j->'problems') p WHERE p->>'reason' = 'unrouted') = 1 FROM t_json), 'T12 split bez zgodnej kategorii -> unrouted (decyzja admina), nie losowa grupa');
RESET ROLE;

-- ── T13 logowanie obslugi (gate/result jako service_role) ────────────────────
SELECT pg_temp.ok((public.fm_staff_login_gate('NIE-MA', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_BAD_CREDENTIALS', 'T13 nieznany kod');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OLD', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_WRONG_DAY', 'T13 konto z inna data eventu');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', NULL)->>'reason') = 'FM_DEVICE_REQUIRED', 'T13 urzadzenie wymagane');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-0001')->>'allowed')::boolean, 'T13 gate OK');
SELECT public.fm_staff_login_result('TEST-OP1', '10.0.0.1', false, 'dev-tablet-0001') FROM generate_series(1,4);
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 4 AND (SELECT locked_until FROM public.fm_staff WHERE code = 'TEST-OP1') IS NULL, 'T13 4 bledy = brak blokady');
SELECT pg_temp.ok((public.fm_staff_login_result('TEST-OP1', '10.0.0.1', false, 'dev-tablet-0001')->>'locked')::boolean, 'T13 5. blad = lockout');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-0001')->>'reason') = 'FM_LOCKED', 'T13 gate: FM_LOCKED');
UPDATE public.fm_staff SET locked_until = NULL WHERE code = 'TEST-OP1';  -- symulacja uplywu 15 min
SELECT pg_temp.ok((public.fm_staff_login_result('TEST-OP1', '10.0.0.1', true, 'dev-tablet-0001')->>'device_id') = 'dev-tablet-0001', 'T13 sukces: reset licznika, przypiecie urzadzenia');
SELECT pg_temp.ok((SELECT failed_logins FROM public.fm_staff WHERE code = 'TEST-OP1') = 0, 'T13 licznik wyzerowany');
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP1', '10.0.0.1', 'dev-tablet-INNY')->>'reason') = 'FM_DEVICE_MISMATCH', 'T13 inne urzadzenie odrzucone');
SELECT public.fm_staff_login_gate('TEST-OP2', '10.0.0.9', 'dev-tablet-0002') FROM generate_series(1,30);
SELECT pg_temp.ok((public.fm_staff_login_gate('TEST-OP2', '10.0.0.9', 'dev-tablet-0002')->>'reason') = 'FM_RATE_LIMIT', 'T13 limit per IP po 30 probach');
-- revoke_sessions + rotacja PIN: stare tokeny (iat przed rotacja) przestaja dzialac dla RPC
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (gen_random_uuid(), pg_temp.id('op1'), now(), now());
SELECT pg_temp.ok((public.fm_staff_revoke_sessions(pg_temp.id('op1'), true)->>'sessions_revoked')::int = 1, 'T13 sesja uniewazniona');
SELECT pg_temp.ok((SELECT device_id IS NULL AND pin_rotated_at IS NOT NULL FROM public.fm_staff WHERE code = 'TEST-OP1'), 'T13 urzadzenie odpiete, pin_rotated_at ustawione');
SET LOCAL ROLE authenticated;
SELECT pg_temp.login('op1', extract(epoch FROM now() - interval '1 hour')::bigint);   -- token sprzed rotacji
SELECT pg_temp.ok(NOT public.is_staff(), 'T13 stary token: is_staff() = false');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_my_stations(NULL)$q$, 'FM_FORBIDDEN');
SELECT pg_temp.login('op1', extract(epoch FROM now() + interval '1 minute')::bigint);  -- nowe logowanie
SELECT pg_temp.ok(public.is_staff(), 'T13 nowy token: is_staff() = true');
RESET ROLE;

-- ── T14 reset_day ────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_reset_day((SELECT today FROM t_day), 'zle potwierdzenie')$q$, 'FM_CONFIRM_REQUIRED');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_reset_day(%L, %L)$q$, (SELECT today FROM t_day), 'RESET ' || to_char((SELECT today FROM t_day), 'YYYY-MM-DD')), 'FM_RESET_LIVE_DAY');
RESET ROLE;
INSERT INTO public.fm_queue_groups (event_date, retailer_id) VALUES ((SELECT today + 1 FROM t_day), (SELECT id FROM t_ret WHERE cid = 'test-a'));
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT id, 1 FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day);
INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr) SELECT id, pg_temp.id('co1'), 1 FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day);
UPDATE public.fm_queue_groups SET last_called_nr = 1 WHERE event_date = (SELECT today + 1 FROM t_day);
SET LOCAL ROLE authenticated; SELECT pg_temp.login('admin');
DELETE FROM t_json; INSERT INTO t_json SELECT public.fm_queue_reset_day((SELECT today + 1 FROM t_day), 'RESET ' || to_char((SELECT today + 1 FROM t_day), 'YYYY-MM-DD'));
SELECT pg_temp.ok((SELECT (j->>'deleted_meetings')::int FROM t_json) = 1, 'T14 reset dnia testowego usunal spotkania');
RESET ROLE;
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE event_date = (SELECT today + 1 FROM t_day)) = 0, 'T14 last_called_nr wyzerowany TYLKO przez reset_day');

SELECT '✅ OK — wszystkie testy 053_fm_queue_test (T0–T14) przeszly' AS wynik;
ROLLBACK;
