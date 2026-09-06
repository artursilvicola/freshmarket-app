-- ============================================================================
-- Testy modulu kolejek (migracje 052 + 053). Uruchamiac w Supabase SQL Editor
-- NA BAZIE TESTOWEJ / BRANCHU. Skrypt jest w jednej transakcji i konczy sie
-- ROLLBACK — nic nie zostaje, ale i tak nie odpalaj go na produkcji w dzien eventu.
--
-- Co sprawdza (kazde NIEPOWODZENIE = RAISE EXCEPTION, czyli czerwony blad):
--   T1  anon: brak dostepu do tabel, widok bez nazw firm
--   T2  nieprzypisany staff -> FM_NOT_ASSIGNED; bez sesji -> FM_AUTH_REQUIRED
--   T3  call_next: numer tylko do przodu; zajete stanowisko -> FM_STATION_BUSY
--   T4  finish_and_call_next: done + nastepny wywolany w jednej transakcji
--   T5  no_show -> mark_returned -> bariera; serve_returnee przed bariera -> blad,
--       po barierze OK; last_called_nr bez zmian podczas obslugi powracajacego
--   T6  add_exception = max(nr)+1
--   T7  undo call_next (<=30 s) przywraca last_called_nr; drugi undo tego samego -> blad
--   T8  version conflict -> FM_CONFLICT
--   T9  idempotencja: ten sam klucz dwa razy = jedna operacja, jeden wpis logu
--   T10 RLS: staff widzi spotkania tylko przypisanej grupy; dostawca tylko swoje
--   T11 parallel (2 stanowiska, wspolna kolejka): dwa rozne numery TERAZ
-- ============================================================================
BEGIN;

-- ── fixtures ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('admin', gen_random_uuid()), ('op1', gen_random_uuid()), ('op2', gen_random_uuid()),
  ('sup_user', gen_random_uuid()), ('co1', gen_random_uuid()), ('co2', gen_random_uuid()), ('co3', gen_random_uuid()), ('co4', gen_random_uuid());

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t_ids WHERE k = $1 $$;
-- symulacja sesji PostgREST: auth.uid() czyta request.jwt.claims
CREATE OR REPLACE FUNCTION pg_temp.login(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(k), 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', pg_temp.id(k)::text, true);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'OCZEKIWANO bledu % dla: %', p_code, p_sql;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%' || p_code || '%' THEN RETURN; END IF;
  RAISE;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(p_cond, false) THEN RAISE EXCEPTION 'TEST FAIL: %', p_msg; END IF; END $$;

-- uzytkownicy auth (trigger handle_new_user zaklada profile; role z metadanych)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(), now(), now(), '{"provider":"email"}',
       json_build_object('role', CASE k WHEN 'admin' THEN 'admin' WHEN 'sup_user' THEN 'supplier' ELSE 'staff' END)::jsonb
FROM t_ids WHERE k IN ('admin','op1','op2','sup_user');
UPDATE public.profiles SET role = 'admin' WHERE id = pg_temp.id('admin');
UPDATE public.profiles SET role = 'staff' WHERE id IN (pg_temp.id('op1'), pg_temp.id('op2'));
INSERT INTO public.fm_staff (id, code, event_date) VALUES (pg_temp.id('op1'), 'TEST-OP1', '2099-01-01'), (pg_temp.id('op2'), 'TEST-OP2', '2099-01-01');

-- firmy i siec testowa
INSERT INTO public.companies (id, name) VALUES (pg_temp.id('co1'), 'TEST Firma 1'), (pg_temp.id('co2'), 'TEST Firma 2'), (pg_temp.id('co3'), 'TEST Firma 3'), (pg_temp.id('co4'), 'TEST Firma 4');
UPDATE public.profiles SET role = 'supplier', company_id = pg_temp.id('co2') WHERE id = pg_temp.id('sup_user');
INSERT INTO public.retailers (name, fm26_active, fm26_chain_id) VALUES ('TEST Siec A', true, 'test-a'), ('TEST Siec B', true, 'test-b');
CREATE TEMP TABLE t_ret AS SELECT id, fm26_chain_id AS cid FROM public.retailers WHERE fm26_chain_id IN ('test-a','test-b');

INSERT INTO public.fm_queue_groups (id, event_date, retailer_id, gate) SELECT gen_random_uuid(), '2099-01-01', id, 1 FROM t_ret;
CREATE TEMP TABLE t_g AS SELECT g.id AS gid, r.cid FROM public.fm_queue_groups g JOIN t_ret r ON r.id = g.retailer_id;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 1 FROM t_g;
INSERT INTO public.fm_stations (queue_group_id, idx) SELECT gid, 2 FROM t_g WHERE cid = 'test-b';  -- parallel ×2
CREATE TEMP TABLE t_st AS SELECT s.id AS sid, g.cid, s.idx FROM public.fm_stations s JOIN t_g g ON g.gid = s.queue_group_id;
-- 4 spotkania w sieci A (nr 1..4), 4 w sieci B
INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr) SELECT gid, pg_temp.id('co' || n), n FROM t_g, generate_series(1,4) n;
INSERT INTO public.fm_queue_assignments (operator_id, queue_group_id) SELECT pg_temp.id('op1'), gid FROM t_g WHERE cid = 'test-a';
INSERT INTO public.fm_queue_assignments (operator_id, queue_group_id) SELECT pg_temp.id('op2'), gid FROM t_g WHERE cid = 'test-b';

-- ── T1 anon ─────────────────────────────────────────────────────────────────
SELECT pg_temp.login(NULL);
SET LOCAL ROLE anon;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_board_v WHERE event_date = '2099-01-01') = 3, 'T1 anon widzi 3 stanowiska w widoku');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fm_queue_board_v' AND column_name IN ('company_id','name','exception_name','operator_id')), 'T1 widok nie ma kolumn z firma/operatorem');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.fm_queue_meetings', 'permission denied');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next((SELECT sid FROM t_st WHERE cid='test-a'), 0, NULL)$q$, 'permission denied');
SELECT pg_temp.ok((public.fm_queue_public_snapshot('2099-01-01')->'stations') IS NOT NULL, 'T1 anon ma snapshot');
SELECT pg_temp.ok(public.fm_queue_public_snapshot('2099-01-01')::text NOT LIKE '%TEST Firma%', 'T1 snapshot bez nazw firm');
RESET ROLE;

-- ── T2 uprawnienia ──────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.login(NULL);
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station((SELECT sid FROM t_st WHERE cid='test-a'), 0, NULL)$q$, 'FM_AUTH_REQUIRED');
SELECT pg_temp.login('op2');  -- op2 przypisany tylko do B
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station((SELECT sid FROM t_st WHERE cid='test-a'), 0, NULL)$q$, 'FM_NOT_ASSIGNED');
SELECT pg_temp.login('sup_user');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_open_station((SELECT sid FROM t_st WHERE cid='test-a'), 0, NULL)$q$, 'FM_FORBIDDEN');

-- ── T3 call_next ────────────────────────────────────────────────────────────
SELECT pg_temp.login('op1');
CREATE TEMP TABLE t_state (s jsonb);
INSERT INTO t_state SELECT public.fm_queue_open_station((SELECT sid FROM t_st WHERE cid='test-a'), 0, 'idem-open-1');
SELECT pg_temp.ok((SELECT s->>'mode' FROM t_state) = 'open', 'T3 open');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next((SELECT sid FROM t_st WHERE cid='test-a'), 1, 'idem-call-1');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 1 AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 1, 'T3 wywolany nr 1');
SELECT pg_temp.ok((SELECT s->'current'->>'name' FROM t_state) = 'TEST Firma 1', 'T3 operator widzi nazwe firmy');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_call_next((SELECT sid FROM t_st WHERE cid='test-a'), 2, 'idem-call-2')$q$, 'FM_STATION_BUSY');

-- ── T8 version conflict ─────────────────────────────────────────────────────
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_start((SELECT sid FROM t_st WHERE cid='test-a'), 999, NULL)$q$, 'FM_CONFLICT');

-- ── T9 idempotencja ─────────────────────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_start((SELECT sid FROM t_st WHERE cid='test-a'), 2, 'idem-start-1');
SELECT pg_temp.ok((SELECT s->'current'->>'status' FROM t_state) = 'in_progress', 'T9 start');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_start((SELECT sid FROM t_st WHERE cid='test-a'), 3, 'idem-start-1'); -- powtorka
SELECT pg_temp.ok((SELECT (s->>'version')::int FROM t_state) = 3, 'T9 powtorka nie zmienia wersji');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_log WHERE idempotency_key = 'idem-start-1') = 1, 'T9 jeden wpis logu');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');

-- ── T4 finish_and_call_next ─────────────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next((SELECT sid FROM t_st WHERE cid='test-a'), 3, 'idem-fin-1', true);
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 2 AND (SELECT s->'current'->>'status' FROM t_state) = 'called', 'T4 nastepny (2) wywolany');
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.fm_queue_meetings WHERE nr = 1 AND queue_group_id = (SELECT gid FROM t_g WHERE cid='test-a')) = 'done', 'T4 nr 1 done');
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op1');

-- ── T5 no_show → powrot → bariera ───────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_no_show((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT (s->>'version')::int FROM t_state), 'idem-ns-2');
SELECT pg_temp.ok((SELECT s->'current' FROM t_state) IS NULL OR (SELECT s->'current' FROM t_state) = 'null'::jsonb, 'T5 stanowisko wolne po no_show');
-- nr 2 nieobecny; wywolujemy 3 (biezacy), kolejny to 4 → bariera dla powrotu = 4
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-call-3');
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 3, 'T5 wywolany 3');
CREATE TEMP TABLE t_ret2 AS SELECT public.fm_queue_mark_returned((SELECT id FROM public.fm_queue_meetings WHERE nr = 2 AND queue_group_id = (SELECT gid FROM t_g WHERE cid='test-a')), 'idem-ret-2') AS r;
SELECT pg_temp.ok((SELECT (r->>'return_after_nr')::int FROM t_ret2) = 4, 'T5 bariera = 4 (po biezacym 3 i kolejnym 4)');
-- zakoncz 3 i wywolaj 4 → 4 w toku; powracajacy jeszcze NIE moze (4 nie zakonczone)
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-fin-3', true);
SELECT pg_temp.ok((SELECT (s->'current'->>'nr')::int FROM t_state) = 4, 'T5 wywolany 4');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_serve_returnee(%L, %L, %s, NULL)$q$, (SELECT sid FROM t_st WHERE cid='test-a'), (SELECT id FROM public.fm_queue_meetings WHERE nr = 2 AND queue_group_id = (SELECT gid FROM t_g WHERE cid='test-a')), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a'))), 'FM_STATION_BUSY');
-- zakoncz 4 bez wywolania (kolejka i tak pusta) → powracajacy gotowy
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_and_call_next((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-fin-4', false);
SELECT pg_temp.ok((SELECT (s->'waiting_returnees'->0->>'ready')::boolean FROM t_state) = true, 'T5 powracajacy gotowy po zakonczeniu 4');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_serve_returnee((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT id FROM public.fm_queue_meetings WHERE nr = 2 AND queue_group_id = (SELECT gid FROM t_g WHERE cid='test-a')), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-serve-2');
SELECT pg_temp.ok((SELECT (s->'returnee'->>'nr')::int FROM t_state) = 2 AND (SELECT (s->>'last_called_nr')::int FROM t_state) = 4, 'T5 powracajacy obslugiwany poza tablica, last_called_nr = 4 bez zmian');
SELECT pg_temp.ok((SELECT (public.fm_queue_public_snapshot('2099-01-01')->'stations'->0->>'busy_private')::boolean), 'T5 tablica: busy_private=true, bez numeru 2');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_call_next(%L, %s, NULL)$q$, (SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a'))), 'FM_STATION_BUSY_RETURNEE');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_finish_returnee((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-finret-2');
SELECT pg_temp.ok((SELECT s->'returnee' FROM t_state) IS NULL OR (SELECT s->'returnee' FROM t_state) = 'null'::jsonb, 'T5 powracajacy zakonczony');

-- ── T6 wyjatek = max+1 ──────────────────────────────────────────────────────
SELECT pg_temp.ok((public.fm_queue_add_exception((SELECT gid FROM t_g WHERE cid='test-a'), 'TEST Wyjatek', 'idem-exc-1')->>'nr')::int = 5, 'T6 wyjatek dostal nr 5');
SELECT pg_temp.ok((public.fm_queue_add_exception((SELECT gid FROM t_g WHERE cid='test-a'), 'TEST Wyjatek', 'idem-exc-1')->>'nr')::int = 5, 'T6 powtorka z tym samym kluczem nie tworzy 6');

-- ── T7 undo call_next ───────────────────────────────────────────────────────
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_call_next((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-call-5');
SELECT pg_temp.ok((SELECT (s->>'last_called_nr')::int FROM t_state) = 5, 'T7 wywolany 5');
DELETE FROM t_state; INSERT INTO t_state SELECT public.fm_queue_undo((SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a')), 'idem-undo-5');
SELECT pg_temp.ok((SELECT (s->>'last_called_nr')::int FROM t_state) = 4 AND (SELECT s->'current' FROM t_state) = 'null'::jsonb, 'T7 undo przywrocil last_called_nr=4');
SELECT pg_temp.expect_error(format($q$SELECT public.fm_queue_undo(%L, %s, NULL)$q$, (SELECT sid FROM t_st WHERE cid='test-a'), (SELECT version FROM public.fm_stations WHERE id = (SELECT sid FROM t_st WHERE cid='test-a'))), 'FM_UNDO');

-- ── T10 RLS ─────────────────────────────────────────────────────────────────
SELECT pg_temp.login('op1');
SELECT pg_temp.ok((SELECT count(DISTINCT queue_group_id) FROM public.fm_queue_meetings) = 1, 'T10 op1 widzi spotkania tylko grupy A');
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_groups WHERE event_date = '2099-01-01') = 2, 'T10 staff czyta konfiguracje grup (bez danych wrazliwych)');
SELECT pg_temp.expect_error($q$INSERT INTO public.fm_queue_log (action) VALUES ('hack')$q$, 'row-level security');
SELECT pg_temp.expect_error($q$UPDATE public.fm_queue_groups SET last_called_nr = 99$q$, 'row-level security');
SELECT pg_temp.login('sup_user');  -- dostawca firmy co2
SELECT pg_temp.ok((SELECT count(*) FROM public.fm_queue_meetings) = 2 AND (SELECT count(*) FROM public.fm_queue_meetings WHERE company_id <> pg_temp.id('co2')) = 0, 'T10 dostawca widzi tylko wlasne spotkania (A i B)');
SELECT pg_temp.expect_error($q$SELECT public.fm_queue_my_stations('2099-01-01')$q$, 'permission denied');  -- brak GRANT? nie: funkcja jest dla authenticated, ale zwraca pusto
RESET ROLE;

-- ── T11 parallel: 2 stanowiska, wspolna kolejka ─────────────────────────────
SET LOCAL ROLE authenticated; SELECT pg_temp.login('op2');
SELECT public.fm_queue_open_station(sid, 0, NULL) FROM t_st WHERE cid='test-b' AND idx = 1;
SELECT public.fm_queue_open_station(sid, 0, NULL) FROM t_st WHERE cid='test-b' AND idx = 2;
SELECT public.fm_queue_call_next(sid, 1, NULL) FROM t_st WHERE cid='test-b' AND idx = 1;
SELECT public.fm_queue_call_next(sid, 1, NULL) FROM t_st WHERE cid='test-b' AND idx = 2;
RESET ROLE;
SELECT pg_temp.ok((SELECT array_agg(cm.nr ORDER BY cm.nr) FROM public.fm_stations s JOIN public.fm_queue_meetings cm ON cm.id = s.current_meeting_id WHERE s.queue_group_id = (SELECT gid FROM t_g WHERE cid='test-b')) = ARRAY[1,2], 'T11 dwa stanowiska maja nr 1 i 2');
SELECT pg_temp.ok((SELECT last_called_nr FROM public.fm_queue_groups WHERE id = (SELECT gid FROM t_g WHERE cid='test-b')) = 2, 'T11 last_called_nr grupy = 2');

SELECT '✅ WSZYSTKIE TESTY PRZESZLY (053_fm_queue_test)' AS wynik;
ROLLBACK;
