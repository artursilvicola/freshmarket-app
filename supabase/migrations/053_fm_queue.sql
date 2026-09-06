-- ============================================================================
-- 053_fm_queue.sql
-- [feat/fm-queue] Modul kolejek / numerkow spotkan B2B na zywo (FM 2026).
-- Specyfikacja: docs/production/FM_KOLEJKI_NUMERKI_PROPOZYCJA.md, sekcja 14.
--
-- WYMAGA: 052_staff_role.sql zaaplikowane WCZESNIEJ, w osobnym uruchomieniu
-- (wartosc ENUM 'staff' musi byc zatwierdzona zanim jej tu uzyjemy).
--
-- Zawartosc:
--   1. handle_new_user: akceptuje role 'staff' z metadanych (tylko admin tworzy)
--   2. helpery: is_staff(), fm_queue_can_operate(group)
--   3. tabele: fm_staff, fm_queue_groups, fm_stations, fm_queue_meetings,
--      fm_queue_assignments, fm_queue_log, fm_queue_settings
--   4. RLS: admin pelny; staff czyta przypisane; anon NIC na tabelach
--   5. widok publiczny fm_queue_board_v (bez nazw firm, bez company_id)
--   6. RPC SECURITY DEFINER (jedyna droga zmiany stanu kolejki)
--   7. REVOKE/GRANT
--
-- Zasady egzekwowane w bazie (nie w UI):
--   • numer publiczny grupy (last_called_nr) NIGDY nie maleje (wyjatek: undo
--     wywolania w ciagu 30 s, logowany jako 'undo_call'),
--   • "Zakoncz i wywolaj nastepny" = jedna transakcja z blokada grupy,
--   • powracajacy (no_show -> returned_waiting) obslugiwany dopiero gdy
--     spotkanie o numerze return_after_nr jest zakonczone — poza tablica,
--     na stanowisku (active_returnee_id), bez zmiany last_called_nr,
--   • wyjatek = max(nr)+1, nigdy miedzy wczesniejsze numery,
--   • free_entry tylko gdy stanowisko nie ma aktywnego spotkania,
--   • kazda operacja: kontrola roli i przypisania, version, idempotency key, log.
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor po review bezpieczenstwa (Codex).
-- ============================================================================

BEGIN;

-- ── 1. handle_new_user: 'staff' tylko z metadanych ustawianych przez service role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_text text;
  v_role public.user_role := 'supplier';
  v_terms text;
  v_privacy text;
  v_accepted_at timestamptz;
BEGIN
  v_role_text := COALESCE(new.raw_user_meta_data->>'role', 'supplier');
  -- 'staff' powstaje wylacznie przez admin-staff-create (service role);
  -- publiczna rejestracja (register-supplier-self) nigdy nie wysyla role='staff'.
  IF v_role_text IN ('admin', 'supplier', 'buyer', 'staff') THEN
    v_role := v_role_text::public.user_role;
  END IF;

  v_terms := NULLIF(new.raw_user_meta_data->>'accepted_terms_version', '');
  v_privacy := NULLIF(new.raw_user_meta_data->>'accepted_privacy_version', '');
  BEGIN
    v_accepted_at := NULLIF(new.raw_user_meta_data->>'accepted_at', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_accepted_at := NULL;
  END;
  IF (v_terms IS NOT NULL OR v_privacy IS NOT NULL) AND v_accepted_at IS NULL THEN
    v_accepted_at := now();
  END IF;

  INSERT INTO public.profiles (id, email, role, accepted_terms_version, accepted_privacy_version, accepted_at)
  VALUES (new.id, new.email, v_role, v_terms, v_privacy, v_accepted_at)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, updated_at = now()
    WHERE public.profiles.email IS DISTINCT FROM EXCLUDED.email;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for auth user % (%): %', new.id, new.email, SQLERRM;
  RETURN new;
END;
$$;

-- ── 2. helpery ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT p.role = 'staff' AND s.active AND NOT s.blocked
                   FROM public.profiles p JOIN public.fm_staff s ON s.id = p.id
                   WHERE p.id = auth.uid()), false);
$$;

-- ── 3. tabele ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fm_staff (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,                 -- 'OBSLUGA-3' / 'TABLICA' (login operatora)
  display_name text,                         -- imie osoby, ktora dostala tablet (opcjonalnie)
  kind text NOT NULL DEFAULT 'operator' CHECK (kind IN ('operator', 'board')),
  event_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  blocked boolean NOT NULL DEFAULT false,
  device_id text,                            -- opcjonalnie jedno urzadzenie
  device_label text,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  pin_rotated_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fm_queue_groups (            -- wlasciciel kolejki i numeracji
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  retailer_id integer NOT NULL REFERENCES public.retailers(id) ON DELETE CASCADE,
  label text,                                -- NULL = sama nazwa sieci; np. 'Owoce' / 'Kwiaty'
  categories text[] NOT NULL DEFAULT '{}',   -- routing spotkan przy Otworz dzien (split)
  gate smallint CHECK (gate IS NULL OR gate IN (1, 2)),
  meetings_per_station smallint NOT NULL DEFAULT 5 CHECK (meetings_per_station BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  last_called_nr int NOT NULL DEFAULT 0,     -- publiczny wskaznik: tylko do przodu
  version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fm_queue_groups_uniq ON public.fm_queue_groups (event_date, retailer_id, COALESCE(label, ''));

CREATE TABLE IF NOT EXISTS public.fm_stations (                -- fizyczne stanowiska grupy
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_group_id uuid NOT NULL REFERENCES public.fm_queue_groups(id) ON DELETE CASCADE,
  idx smallint NOT NULL DEFAULT 1,
  label text,
  active boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'closed' CHECK (mode IN ('closed', 'open', 'paused', 'free_entry')),
  current_meeting_id uuid,                   -- publicznie wywolane spotkanie (FK nizej)
  active_returnee_id uuid,                   -- powracajacy obslugiwany poza tablica (FK nizej)
  free_entry_started_at timestamptz,
  version int NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_group_id, idx)
);

CREATE TABLE IF NOT EXISTS public.fm_queue_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_group_id uuid NOT NULL REFERENCES public.fm_queue_groups(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  exception_name text,                       -- spotkanie wyjatkowe bez konta firmy
  nr int NOT NULL CHECK (nr > 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned', 'called', 'in_progress', 'done', 'no_show', 'skipped', 'cancelled',
    'returned_waiting', 'returned_in_progress')),
  station_id uuid REFERENCES public.fm_stations(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'plan' CHECK (source IN ('plan', 'exception')),
  return_after_nr int,                       -- bariera: obsluzyc po zakonczeniu spotkania o tym nr
  called_at timestamptz, started_at timestamptz, ended_at timestamptz,
  operator_id uuid,
  note text,
  version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_group_id, nr)
);
ALTER TABLE public.fm_stations
  DROP CONSTRAINT IF EXISTS fm_stations_current_fk,
  ADD CONSTRAINT fm_stations_current_fk FOREIGN KEY (current_meeting_id) REFERENCES public.fm_queue_meetings(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS fm_stations_returnee_fk,
  ADD CONSTRAINT fm_stations_returnee_fk FOREIGN KEY (active_returnee_id) REFERENCES public.fm_queue_meetings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fm_queue_meetings_group_status ON public.fm_queue_meetings (queue_group_id, status, nr);
CREATE INDEX IF NOT EXISTS fm_queue_meetings_company ON public.fm_queue_meetings (company_id);

CREATE TABLE IF NOT EXISTS public.fm_queue_assignments (
  operator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  queue_group_id uuid NOT NULL REFERENCES public.fm_queue_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, queue_group_id)
);

CREATE TABLE IF NOT EXISTS public.fm_queue_log (                -- audyt, append-only
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  operator_id uuid,
  device_id text,
  queue_group_id uuid,
  station_id uuid,
  meeting_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  nr int,
  idempotency_key text,
  payload jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS fm_queue_log_idem ON public.fm_queue_log (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS fm_queue_log_station_ts ON public.fm_queue_log (station_id, ts DESC);

CREATE TABLE IF NOT EXISTS public.fm_queue_settings (
  event_date date PRIMARY KEY,
  board_rotation_s smallint NOT NULL DEFAULT 9 CHECK (board_rotation_s BETWEEN 3 AND 60),
  board_items_per_page smallint NOT NULL DEFAULT 12 CHECK (board_items_per_page BETWEEN 4 AND 40),
  board_pinned_group_ids uuid[] NOT NULL DEFAULT '{}',
  day_opened_at timestamptz,
  closed_all_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at
CREATE OR REPLACE FUNCTION public.fm_queue_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fm_staff','fm_queue_groups','fm_stations','fm_queue_meetings','fm_queue_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fm_queue_touch()', t, t);
  END LOOP; END $$;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.fm_staff             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_stations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_meetings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_settings    ENABLE ROW LEVEL SECURITY;

-- admin: pelny dostep (konfiguracja przez zwykle zapytania; zmiany stanu kolejki i tak przez RPC)
DROP POLICY IF EXISTS fm_staff_admin_all ON public.fm_staff;
CREATE POLICY fm_staff_admin_all ON public.fm_staff FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_staff_self_select ON public.fm_staff;
CREATE POLICY fm_staff_self_select ON public.fm_staff FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS fm_groups_admin_all ON public.fm_queue_groups;
CREATE POLICY fm_groups_admin_all ON public.fm_queue_groups FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- grupy i stanowiska NIE zawieraja danych wrazliwych (siec, etykieta, gate, liczba
-- stanowisk) — czytaja wszyscy zalogowani: algorytm (pojemnosc = stanowiska × spotkania)
-- musi dawac ten sam wynik u admina, dostawcy i kupca; anon nadal nic (tylko widok tablicy).
DROP POLICY IF EXISTS fm_groups_staff_select ON public.fm_queue_groups;
DROP POLICY IF EXISTS fm_groups_auth_select ON public.fm_queue_groups;
CREATE POLICY fm_groups_auth_select ON public.fm_queue_groups FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fm_stations_admin_all ON public.fm_stations;
CREATE POLICY fm_stations_admin_all ON public.fm_stations FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_stations_staff_select ON public.fm_stations;
DROP POLICY IF EXISTS fm_stations_auth_select ON public.fm_stations;
CREATE POLICY fm_stations_auth_select ON public.fm_stations FOR SELECT TO authenticated USING (true);

-- spotkania: operator widzi nazwy firm TYLKO w przypisanych grupach; konto 'board' nie widzi spotkan wcale
DROP POLICY IF EXISTS fm_meetings_admin_all ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_admin_all ON public.fm_queue_meetings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_meetings_staff_select ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_staff_select ON public.fm_queue_meetings FOR SELECT USING (
  public.is_staff() AND EXISTS (SELECT 1 FROM public.fm_queue_assignments a WHERE a.operator_id = auth.uid() AND a.queue_group_id = fm_queue_meetings.queue_group_id));
-- dostawca widzi wylacznie WLASNE spotkania (numer, status) — do "Twoja kolej"
DROP POLICY IF EXISTS fm_meetings_supplier_own ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_supplier_own ON public.fm_queue_meetings FOR SELECT USING (
  company_id IS NOT NULL AND company_id = public.app_company_id());

DROP POLICY IF EXISTS fm_assign_admin_all ON public.fm_queue_assignments;
CREATE POLICY fm_assign_admin_all ON public.fm_queue_assignments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_assign_self_select ON public.fm_queue_assignments;
CREATE POLICY fm_assign_self_select ON public.fm_queue_assignments FOR SELECT USING (operator_id = auth.uid());

DROP POLICY IF EXISTS fm_log_admin_select ON public.fm_queue_log;
CREATE POLICY fm_log_admin_select ON public.fm_queue_log FOR SELECT USING (public.is_admin());
-- INSERT do logu wylacznie przez RPC (SECURITY DEFINER) — brak polityki INSERT dla rol aplikacji.

DROP POLICY IF EXISTS fm_settings_admin_all ON public.fm_queue_settings;
CREATE POLICY fm_settings_admin_all ON public.fm_queue_settings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_settings_staff_select ON public.fm_queue_settings;
CREATE POLICY fm_settings_staff_select ON public.fm_queue_settings FOR SELECT USING (public.is_staff());

-- ── 5. publiczny widok tablicy (bez nazw firm, bez company_id, bez operatorow) ──
CREATE OR REPLACE VIEW public.fm_queue_board_v AS
SELECT
  g.event_date,
  g.id            AS group_id,
  r.name          AS retailer_name,
  g.label         AS group_label,
  g.gate,
  g.active        AS group_active,
  g.last_called_nr,
  (SELECT min(m.nr) FROM public.fm_queue_meetings m
     WHERE m.queue_group_id = g.id AND m.status = 'planned' AND m.nr > g.last_called_nr) AS next_nr,
  st.id           AS station_id,
  st.idx          AS station_idx,
  st.label        AS station_label,
  st.active       AS station_active,
  st.mode,
  cm.nr           AS current_nr,
  cm.status       AS current_status,
  (st.active_returnee_id IS NOT NULL) AS busy_private,
  st.updated_at
FROM public.fm_queue_groups g
JOIN public.retailers r ON r.id = g.retailer_id
JOIN public.fm_stations st ON st.queue_group_id = g.id
LEFT JOIN public.fm_queue_meetings cm ON cm.id = st.current_meeting_id
WHERE g.active;

-- snapshot dla telefonow (cache'owalny JSON; wolany przez funkcje Netlify z naglowkiem Cache-Control)
CREATE OR REPLACE FUNCTION public.fm_queue_public_snapshot(p_event_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event_date', COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups)),
    'generated_at', now(),
    'settings', (SELECT jsonb_build_object('rotation_s', s.board_rotation_s, 'per_page', s.board_items_per_page, 'pinned', s.board_pinned_group_ids, 'closed_all_at', s.closed_all_at)
                   FROM public.fm_queue_settings s WHERE s.event_date = COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups))),
    'stations', COALESCE((SELECT jsonb_agg(to_jsonb(v) - 'updated_at' ORDER BY v.gate NULLS LAST, v.retailer_name, v.group_label, v.station_idx)
                   FROM public.fm_queue_board_v v
                   WHERE v.event_date = COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups))), '[]'::jsonb));
$$;

-- ── 6. RPC ───────────────────────────────────────────────────────────────────
-- Wspolne: kontrola operatora + przypisania (admin zawsze moze).
CREATE OR REPLACE FUNCTION public.fm_queue_assert_operator(p_group_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FM_AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF public.is_admin() THEN RETURN v_uid; END IF;
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fm_queue_assignments a WHERE a.operator_id = v_uid AND a.queue_group_id = p_group_id) THEN
    RAISE EXCEPTION 'FM_NOT_ASSIGNED' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END; $$;

-- Log + idempotencja: jesli klucz juz byl, zwraca true (operacja juz wykonana).
CREATE OR REPLACE FUNCTION public.fm_queue_log_write(
  p_operator uuid, p_group uuid, p_station uuid, p_meeting uuid, p_action text,
  p_from text, p_to text, p_nr int, p_idem text, p_payload jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.fm_queue_log (operator_id, device_id, queue_group_id, station_id, meeting_id, action, from_status, to_status, nr, idempotency_key, payload)
  VALUES (p_operator, left(NULLIF(NULLIF(current_setting('request.headers', true), '')::jsonb->>'x-device-id', ''), 64), p_group, p_station, p_meeting, p_action, p_from, p_to, p_nr, NULLIF(p_idem, ''), p_payload);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_idem_done(p_idem text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT p_idem IS NOT NULL AND p_idem <> '' AND EXISTS (SELECT 1 FROM public.fm_queue_log l WHERE l.idempotency_key = p_idem);
$$;

-- Stan stanowiska do zwrotu (to samo, co widzi tablet).
CREATE OR REPLACE FUNCTION public.fm_queue_station_state(p_station_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'station_id', st.id, 'group_id', g.id, 'mode', st.mode, 'version', st.version, 'group_version', g.version,
    'last_called_nr', g.last_called_nr,
    'current', (SELECT jsonb_build_object('id', m.id, 'nr', m.nr, 'status', m.status, 'company_id', m.company_id,
                 'name', COALESCE(c.name, m.exception_name), 'called_at', m.called_at, 'started_at', m.started_at)
                FROM public.fm_queue_meetings m LEFT JOIN public.companies c ON c.id = m.company_id WHERE m.id = st.current_meeting_id),
    'returnee', (SELECT jsonb_build_object('id', m.id, 'nr', m.nr, 'status', m.status, 'name', COALESCE(c.name, m.exception_name), 'started_at', m.started_at)
                FROM public.fm_queue_meetings m LEFT JOIN public.companies c ON c.id = m.company_id WHERE m.id = st.active_returnee_id),
    'next', (SELECT jsonb_build_object('id', m.id, 'nr', m.nr, 'name', COALESCE(c.name, m.exception_name))
             FROM public.fm_queue_meetings m LEFT JOIN public.companies c ON c.id = m.company_id
             WHERE m.queue_group_id = g.id AND m.status = 'planned' AND m.nr > g.last_called_nr ORDER BY m.nr LIMIT 1),
    'waiting_returnees', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'nr', m.nr, 'name', COALESCE(c.name, m.exception_name), 'return_after_nr', m.return_after_nr,
                            'ready', (m.return_after_nr IS NULL OR EXISTS (SELECT 1 FROM public.fm_queue_meetings d WHERE d.queue_group_id = g.id AND d.nr = m.return_after_nr AND d.status IN ('done','no_show','skipped','cancelled')))) ORDER BY m.nr), '[]'::jsonb)
             FROM public.fm_queue_meetings m LEFT JOIN public.companies c ON c.id = m.company_id
             WHERE m.queue_group_id = g.id AND m.status = 'returned_waiting'),
    'remaining', (SELECT count(*) FROM public.fm_queue_meetings m WHERE m.queue_group_id = g.id AND m.status = 'planned' AND m.nr > g.last_called_nr))
  FROM public.fm_stations st JOIN public.fm_queue_groups g ON g.id = st.queue_group_id
  WHERE st.id = p_station_id;
$$;

-- Otworz stanowisko (closed/paused -> open)
CREATE OR REPLACE FUNCTION public.fm_queue_open_station(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_op uuid;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  IF NOT st.active THEN RAISE EXCEPTION 'FM_STATION_INACTIVE' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_stations SET mode = 'open', free_entry_started_at = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, NULL, 'open_station', st.mode, 'open', NULL, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Wywolaj nastepny numer (tylko do przodu; blokada grupy = bezpieczne dla parallel)
CREATE OR REPLACE FUNCTION public.fm_queue_call_next(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; g public.fm_queue_groups; m public.fm_queue_meetings; v_op uuid;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = st.queue_group_id FOR UPDATE;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  IF st.mode <> 'open' THEN RAISE EXCEPTION 'FM_STATION_NOT_OPEN' USING ERRCODE = '22023'; END IF;
  IF st.active_returnee_id IS NOT NULL THEN RAISE EXCEPTION 'FM_STATION_BUSY_RETURNEE' USING ERRCODE = '22023'; END IF;
  IF st.current_meeting_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.id = st.current_meeting_id AND x.status IN ('called','in_progress')) THEN
    RAISE EXCEPTION 'FM_STATION_BUSY' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.fm_queue_meetings
    WHERE queue_group_id = g.id AND status = 'planned' AND nr > g.last_called_nr
    ORDER BY nr LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_QUEUE_EMPTY' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'called', station_id = st.id, called_at = now(), operator_id = v_op, version = version + 1 WHERE id = m.id;
  UPDATE public.fm_queue_groups SET last_called_nr = m.nr, version = version + 1 WHERE id = g.id;
  UPDATE public.fm_stations SET current_meeting_id = m.id, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, g.id, st.id, m.id, 'call_next', 'planned', 'called', m.nr, p_idem, jsonb_build_object('prev_last_called_nr', g.last_called_nr));
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Rozpocznij (called -> in_progress)
CREATE OR REPLACE FUNCTION public.fm_queue_start(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; m public.fm_queue_meetings; v_op uuid;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status = 'called' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_CALLED_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'in_progress', started_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'start', 'called', 'in_progress', m.nr, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Zakoncz biezace (called/in_progress -> done) i od razu wywolaj nastepny (jedna transakcja)
CREATE OR REPLACE FUNCTION public.fm_queue_finish_and_call_next(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL, p_call_next boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; m public.fm_queue_meetings; v_op uuid; v_state jsonb;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status IN ('called','in_progress') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_ACTIVE_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'done', ended_at = now(), started_at = COALESCE(started_at, now()), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET current_meeting_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'finish', m.status, 'done', m.nr, p_idem, NULL);
  IF p_call_next AND st.mode = 'open' THEN
    BEGIN
      v_state := public.fm_queue_call_next(p_station_id, st.version + 1, CASE WHEN p_idem IS NULL THEN NULL ELSE p_idem || ':next' END);
      RETURN v_state;
    EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;  -- kolejka pusta: zostajemy bez biezacego
    END;
  END IF;
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Nieobecny (called/in_progress -> no_show); kolejka idzie dalej
CREATE OR REPLACE FUNCTION public.fm_queue_no_show(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; m public.fm_queue_meetings; v_op uuid;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status IN ('called','in_progress') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_ACTIVE_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'no_show', ended_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET current_meeting_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'no_show', m.status, 'no_show', m.nr, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Pomin zaplanowane spotkanie (planned -> skipped), np. firma zrezygnowala
CREATE OR REPLACE FUNCTION public.fm_queue_skip(p_meeting_id uuid, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.fm_queue_meetings; v_op uuid;
BEGIN
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(m.queue_group_id);
  IF public.fm_queue_idem_done(p_idem) THEN RETURN jsonb_build_object('id', m.id, 'status', m.status); END IF;
  IF m.status NOT IN ('planned','returned_waiting') THEN RAISE EXCEPTION 'FM_BAD_STATUS' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'skipped', ended_at = now(), version = version + 1 WHERE id = m.id;
  PERFORM public.fm_queue_log_write(v_op, m.queue_group_id, m.station_id, m.id, 'skip', m.status, 'skipped', m.nr, p_idem, NULL);
  RETURN jsonb_build_object('id', m.id, 'status', 'skipped');
END; $$;

-- Powracajacy zglosil sie (no_show -> returned_waiting) + bariera "po biezacym i kolejnym"
CREATE OR REPLACE FUNCTION public.fm_queue_mark_returned(p_meeting_id uuid, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.fm_queue_meetings; g public.fm_queue_groups; v_op uuid; v_barrier int;
BEGIN
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(m.queue_group_id);
  IF public.fm_queue_idem_done(p_idem) THEN RETURN jsonb_build_object('id', m.id, 'status', m.status, 'return_after_nr', m.return_after_nr); END IF;
  IF m.status <> 'no_show' THEN RAISE EXCEPTION 'FM_BAD_STATUS' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = m.queue_group_id FOR UPDATE;
  -- bariera = "po biezacym i kolejnym": wiekszy z dwoch najblizszych numerow
  -- (biezace wywolane + pierwsze planned; gdy stanowisko wolne: dwa pierwsze planned;
  --  gdy zostal jeden: ten jeden; pusta kolejka: NULL = mozna obsluzyc od razu)
  SELECT max(x.nr) INTO v_barrier FROM (
    SELECT nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id AND status IN ('called','in_progress') AND nr = g.last_called_nr
    UNION ALL
    SELECT nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id AND status = 'planned' AND nr > g.last_called_nr
    ORDER BY nr LIMIT 2
  ) x;
  UPDATE public.fm_queue_meetings SET status = 'returned_waiting', return_after_nr = v_barrier, version = version + 1 WHERE id = m.id;
  PERFORM public.fm_queue_log_write(v_op, g.id, m.station_id, m.id, 'mark_returned', 'no_show', 'returned_waiting', m.nr, p_idem, jsonb_build_object('return_after_nr', v_barrier));
  RETURN jsonb_build_object('id', m.id, 'status', 'returned_waiting', 'return_after_nr', v_barrier);
END; $$;

-- Obsluz powracajacego POZA tablica (stanowisko wolne, bariera spelniona); last_called_nr bez zmian
CREATE OR REPLACE FUNCTION public.fm_queue_serve_returnee(p_station_id uuid, p_meeting_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; m public.fm_queue_meetings; v_op uuid; v_ready boolean;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  IF st.mode <> 'open' THEN RAISE EXCEPTION 'FM_STATION_NOT_OPEN' USING ERRCODE = '22023'; END IF;
  IF st.active_returnee_id IS NOT NULL THEN RAISE EXCEPTION 'FM_STATION_BUSY_RETURNEE' USING ERRCODE = '22023'; END IF;
  IF st.current_meeting_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.id = st.current_meeting_id AND x.status IN ('called','in_progress')) THEN
    RAISE EXCEPTION 'FM_STATION_BUSY' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = p_meeting_id AND queue_group_id = st.queue_group_id FOR UPDATE;
  IF NOT FOUND OR m.status <> 'returned_waiting' THEN RAISE EXCEPTION 'FM_BAD_STATUS' USING ERRCODE = '22023'; END IF;
  v_ready := m.return_after_nr IS NULL OR EXISTS (SELECT 1 FROM public.fm_queue_meetings d WHERE d.queue_group_id = m.queue_group_id AND d.nr = m.return_after_nr AND d.status IN ('done','no_show','skipped','cancelled'));
  IF NOT v_ready THEN RAISE EXCEPTION 'FM_RETURNEE_BARRIER' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'returned_in_progress', station_id = st.id, started_at = now(), operator_id = v_op, version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET active_returnee_id = m.id, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'serve_returnee', 'returned_waiting', 'returned_in_progress', m.nr, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_finish_returnee(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; m public.fm_queue_meetings; v_op uuid;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.active_returnee_id AND status = 'returned_in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_RETURNEE' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'done', ended_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET active_returnee_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'finish_returnee', 'returned_in_progress', 'done', m.nr, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Spotkanie wyjatkowe: max(nr)+1, nigdy miedzy wczesniejsze numery
CREATE OR REPLACE FUNCTION public.fm_queue_add_exception(p_group_id uuid, p_name text, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g public.fm_queue_groups; v_op uuid; v_nr int; v_id uuid; v_prev jsonb;
BEGIN
  v_op := public.fm_queue_assert_operator(p_group_id);
  IF public.fm_queue_idem_done(p_idem) THEN
    -- powtorka (retry po utracie sieci): zwroc wynik pierwszego wywolania, nie tworz drugiego numeru
    SELECT jsonb_build_object('id', l.meeting_id, 'nr', l.nr, 'status', 'planned') INTO v_prev
      FROM public.fm_queue_log l WHERE l.idempotency_key = p_idem;
    RETURN v_prev;
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'FM_NAME_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(max(nr), 0) + 1 INTO v_nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id;
  v_nr := GREATEST(v_nr, g.last_called_nr + 1);
  INSERT INTO public.fm_queue_meetings (queue_group_id, exception_name, nr, status, source, operator_id)
  VALUES (g.id, btrim(p_name), v_nr, 'planned', 'exception', v_op) RETURNING id INTO v_id;
  UPDATE public.fm_queue_groups SET version = version + 1 WHERE id = g.id;
  PERFORM public.fm_queue_log_write(v_op, g.id, NULL, v_id, 'add_exception', NULL, 'planned', v_nr, p_idem, jsonb_build_object('name', btrim(p_name)));
  RETURN jsonb_build_object('id', v_id, 'nr', v_nr, 'status', 'planned');
END; $$;

-- Tryby stanowiska: open | paused | free_entry | closed
CREATE OR REPLACE FUNCTION public.fm_queue_set_mode(p_station_id uuid, p_mode text, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_op uuid; v_busy boolean;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  IF p_mode NOT IN ('open','paused','free_entry','closed') THEN RAISE EXCEPTION 'FM_BAD_MODE' USING ERRCODE = '22023'; END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  v_busy := st.active_returnee_id IS NOT NULL OR (st.current_meeting_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.id = st.current_meeting_id AND x.status IN ('called','in_progress')));
  IF p_mode IN ('free_entry','closed') AND v_busy THEN RAISE EXCEPTION 'FM_STATION_BUSY' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_stations SET mode = p_mode,
    free_entry_started_at = CASE WHEN p_mode = 'free_entry' THEN now() ELSE NULL END,
    version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, NULL, 'set_mode', st.mode, p_mode, NULL, p_idem, NULL);
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- Cofnij ostatnia operacje stanowiska (<= 30 s). Jedyny dozwolony "krok wstecz" wskaznika:
-- undo wywolania w ciagu 30 s, gdy nic po nim nie zaszlo — logowane jako 'undo_call'.
CREATE OR REPLACE FUNCTION public.fm_queue_undo(p_station_id uuid, p_expected_version int, p_idem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; l public.fm_queue_log; m public.fm_queue_meetings; g public.fm_queue_groups; v_op uuid; v_prev int;
BEGIN
  IF public.fm_queue_idem_done(p_idem) THEN RETURN public.fm_queue_station_state(p_station_id); END IF;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(st.queue_group_id);
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO l FROM public.fm_queue_log l0
    WHERE l0.station_id = st.id AND l0.action IN ('call_next','start','finish','no_show')
      AND NOT EXISTS (SELECT 1 FROM public.fm_queue_log u WHERE u.action LIKE 'undo\_%' AND (u.payload->>'undone_log_id')::bigint = l0.id)  -- juz cofniete
    ORDER BY l0.ts DESC, l0.id DESC LIMIT 1;
  IF NOT FOUND OR l.ts < now() - interval '30 seconds' THEN RAISE EXCEPTION 'FM_UNDO_EXPIRED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.fm_queue_log x WHERE x.station_id = st.id AND x.id > l.id AND x.action NOT LIKE 'undo%') THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = l.meeting_id FOR UPDATE;
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = st.queue_group_id FOR UPDATE;
  IF l.action = 'start' THEN
    UPDATE public.fm_queue_meetings SET status = 'called', started_at = NULL, version = version + 1 WHERE id = m.id;
  ELSIF l.action = 'no_show' THEN
    UPDATE public.fm_queue_meetings SET status = l.from_status, ended_at = NULL, version = version + 1 WHERE id = m.id;
    UPDATE public.fm_stations SET current_meeting_id = m.id WHERE id = st.id;
  ELSIF l.action = 'finish' THEN
    IF st.current_meeting_id IS NOT NULL THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
    UPDATE public.fm_queue_meetings SET status = l.from_status, ended_at = NULL, version = version + 1 WHERE id = m.id;
    UPDATE public.fm_stations SET current_meeting_id = m.id WHERE id = st.id;
  ELSIF l.action = 'call_next' THEN
    v_prev := COALESCE((l.payload->>'prev_last_called_nr')::int, 0);
    UPDATE public.fm_queue_meetings SET status = 'planned', station_id = NULL, called_at = NULL, version = version + 1 WHERE id = m.id;
    UPDATE public.fm_stations SET current_meeting_id = NULL WHERE id = st.id;
    UPDATE public.fm_queue_groups SET last_called_nr = v_prev, version = version + 1 WHERE id = g.id;
  END IF;
  UPDATE public.fm_stations SET version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'undo_' || l.action, l.to_status, l.from_status, m.nr, p_idem, jsonb_build_object('undone_log_id', l.id));
  RETURN public.fm_queue_station_state(p_station_id);
END; $$;

-- ADMIN: Otworz dzien — import zatwierdzonego planu (fm_settings.schedule.nums) do kolejek.
-- Idempotentny: grupa, ktora ma juz spotkania, jest pomijana (chyba ze p_force).
CREATE OR REPLACE FUNCTION public.fm_queue_open_day(p_event_date date, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_sched jsonb; v_sid text; v_cid text; v_nr int; v_company uuid; v_ret public.retailers;
        v_group uuid; v_groups int := 0; v_meetings int := 0; v_skipped int := 0; v_missing text[] := '{}'; r record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT schedule INTO v_sched FROM public.fm_settings ORDER BY updated_at DESC LIMIT 1;
  IF v_sched IS NULL OR v_sched->'nums' IS NULL THEN RAISE EXCEPTION 'FM_NO_SCHEDULE' USING ERRCODE = 'P0002'; END IF;

  -- grupy/stanowiska domyslne dla sieci FM bez konfiguracji
  FOR v_ret IN SELECT * FROM public.retailers WHERE fm26_active AND fm26_chain_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.fm_queue_groups WHERE event_date = p_event_date AND retailer_id = v_ret.id) THEN
      INSERT INTO public.fm_queue_groups (event_date, retailer_id, gate) VALUES (p_event_date, v_ret.id, v_ret.fm_gate) RETURNING id INTO v_group;
      INSERT INTO public.fm_stations (queue_group_id, idx) VALUES (v_group, 1);
      v_groups := v_groups + 1;
    END IF;
  END LOOP;
  INSERT INTO public.fm_queue_settings (event_date, day_opened_at, updated_by) VALUES (p_event_date, now(), v_uid)
    ON CONFLICT (event_date) DO UPDATE SET day_opened_at = COALESCE(public.fm_queue_settings.day_opened_at, now()), updated_by = v_uid;

  -- import par: nums[sid][cid] = nr
  FOR r IN SELECT key, value FROM jsonb_each(v_sched->'nums') LOOP
    v_sid := r.key;
    SELECT id INTO v_company FROM public.companies WHERE id::text = v_sid OR legacy_fm_id = v_sid LIMIT 1;
    IF v_company IS NULL THEN v_missing := array_append(v_missing, v_sid); CONTINUE; END IF;
    FOR v_cid, v_nr IN SELECT key, value::text::int FROM jsonb_each(r.value) LOOP
      -- grupa: split -> po kategoriach firmy; inaczej pierwsza grupa sieci
      SELECT g.id INTO v_group
        FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
        LEFT JOIN public.companies c ON c.id = v_company
        WHERE g.event_date = p_event_date AND rt.fm26_chain_id = v_cid AND g.active
        ORDER BY (CASE WHEN cardinality(g.categories) > 0 AND c.categories && g.categories THEN 0 WHEN cardinality(g.categories) = 0 THEN 1 ELSE 2 END), g.label NULLS FIRST
        LIMIT 1;
      IF v_group IS NULL THEN v_missing := array_append(v_missing, v_cid); CONTINUE; END IF;
      IF NOT p_force AND EXISTS (SELECT 1 FROM public.fm_queue_meetings m WHERE m.queue_group_id = v_group AND m.source = 'plan') THEN
        v_skipped := v_skipped + 1; CONTINUE;
      END IF;
      INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr, status, source)
      VALUES (v_group, v_company, v_nr, 'planned', 'plan')
      ON CONFLICT (queue_group_id, nr) DO NOTHING;
      v_meetings := v_meetings + 1;
    END LOOP;
  END LOOP;
  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'open_day', NULL, NULL, NULL, NULL, jsonb_build_object('event_date', p_event_date, 'groups_created', v_groups, 'meetings', v_meetings, 'skipped', v_skipped, 'missing', v_missing));
  RETURN jsonb_build_object('groups_created', v_groups, 'meetings', v_meetings, 'skipped_existing', v_skipped, 'missing', to_jsonb(v_missing));
END; $$;

-- ADMIN: zamknij wszystkie stanowiska (17:00), w tym Free entry
CREATE OR REPLACE FUNCTION public.fm_queue_close_all(p_event_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE public.fm_stations st SET mode = 'closed', free_entry_started_at = NULL, version = version + 1, updated_by = v_uid
    FROM public.fm_queue_groups g WHERE g.id = st.queue_group_id AND g.event_date = p_event_date AND st.mode <> 'closed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.fm_queue_settings SET closed_all_at = now(), updated_by = v_uid WHERE event_date = p_event_date;
  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'close_all', NULL, 'closed', NULL, NULL, jsonb_build_object('event_date', p_event_date, 'stations', v_n));
  RETURN jsonb_build_object('closed', v_n);
END; $$;

-- ADMIN: przypisz operatora do wszystkich grup sieci (lub usun przypisanie)
CREATE OR REPLACE FUNCTION public.fm_queue_assign_retailer(p_operator_id uuid, p_retailer_id int, p_event_date date, p_assign boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_assign THEN
    INSERT INTO public.fm_queue_assignments (operator_id, queue_group_id)
      SELECT p_operator_id, g.id FROM public.fm_queue_groups g WHERE g.retailer_id = p_retailer_id AND g.event_date = p_event_date
      ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.fm_queue_assignments a USING public.fm_queue_groups g
      WHERE a.queue_group_id = g.id AND a.operator_id = p_operator_id AND g.retailer_id = p_retailer_id AND g.event_date = p_event_date;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.fm_queue_log_write(auth.uid(), NULL, NULL, NULL, CASE WHEN p_assign THEN 'assign' ELSE 'unassign' END, NULL, NULL, NULL, NULL, jsonb_build_object('operator_id', p_operator_id, 'retailer_id', p_retailer_id));
  RETURN jsonb_build_object('changed', v_n);
END; $$;

-- Operator: moje stanowiska (przypisane grupy) — jedno zapytanie dla tabletu
CREATE OR REPLACE FUNCTION public.fm_queue_my_stations(p_event_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'station_id', st.id, 'group_id', g.id, 'retailer_name', r.name, 'group_label', g.label, 'gate', g.gate,
      'station_idx', st.idx, 'station_label', st.label, 'stations_in_group', (SELECT count(*) FROM public.fm_stations x WHERE x.queue_group_id = g.id AND x.active),
      'state', public.fm_queue_station_state(st.id))
    ORDER BY r.name, g.label NULLS FIRST, st.idx), '[]'::jsonb)
  FROM public.fm_stations st
  JOIN public.fm_queue_groups g ON g.id = st.queue_group_id
  JOIN public.retailers r ON r.id = g.retailer_id
  WHERE st.active AND g.active
    AND g.event_date = COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups))
    AND (public.is_admin() OR EXISTS (SELECT 1 FROM public.fm_queue_assignments a WHERE a.operator_id = auth.uid() AND a.queue_group_id = g.id));
$$;

-- ── 7. uprawnienia ───────────────────────────────────────────────────────────
-- Widok tablicy: security_invoker = false (domyslnie) — CELOWO: anon czyta TYLKO tę
-- projekcję (siec, stanowisko, tryb, numery), a nie tabele pod spodem.
REVOKE ALL ON public.fm_queue_board_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fm_queue_board_v TO anon, authenticated;

-- Supabase nadaje nowym funkcjom EXECUTE dla anon/authenticated przez ALTER DEFAULT
-- PRIVILEGES — dlatego najpierw odbieramy WSZYSTKO (PUBLIC, anon, authenticated),
-- a potem nadajemy jawnie. Helpery (assert/log/idem) zostaja bez grantow:
-- wywoluja je tylko funkcje SECURITY DEFINER (wlasciciel = postgres).
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fm_queue_assert_operator(uuid)', 'fm_queue_log_write(uuid,uuid,uuid,uuid,text,text,text,int,text,jsonb)', 'fm_queue_idem_done(text)',
    'fm_queue_station_state(uuid)', 'fm_queue_open_station(uuid,int,text)', 'fm_queue_call_next(uuid,int,text)', 'fm_queue_start(uuid,int,text)',
    'fm_queue_finish_and_call_next(uuid,int,text,boolean)', 'fm_queue_no_show(uuid,int,text)', 'fm_queue_skip(uuid,text)',
    'fm_queue_mark_returned(uuid,text)', 'fm_queue_serve_returnee(uuid,uuid,int,text)', 'fm_queue_finish_returnee(uuid,int,text)',
    'fm_queue_add_exception(uuid,text,text)', 'fm_queue_set_mode(uuid,text,int,text)', 'fm_queue_undo(uuid,int,text)',
    'fm_queue_open_day(date,boolean)', 'fm_queue_close_all(date)', 'fm_queue_assign_retailer(uuid,int,date,boolean)',
    'fm_queue_my_stations(date)', 'fm_queue_public_snapshot(date)', 'is_staff()', 'fm_queue_touch()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- zalogowani (admin/staff/dostawca): wywolania sprawdzaja role w srodku
  FOREACH f IN ARRAY ARRAY[
    'fm_queue_station_state(uuid)', 'fm_queue_open_station(uuid,int,text)', 'fm_queue_call_next(uuid,int,text)', 'fm_queue_start(uuid,int,text)',
    'fm_queue_finish_and_call_next(uuid,int,text,boolean)', 'fm_queue_no_show(uuid,int,text)', 'fm_queue_skip(uuid,text)',
    'fm_queue_mark_returned(uuid,text)', 'fm_queue_serve_returnee(uuid,uuid,int,text)', 'fm_queue_finish_returnee(uuid,int,text)',
    'fm_queue_add_exception(uuid,text,text)', 'fm_queue_set_mode(uuid,text,int,text)', 'fm_queue_undo(uuid,int,text)',
    'fm_queue_open_day(date,boolean)', 'fm_queue_close_all(date)', 'fm_queue_assign_retailer(uuid,int,date,boolean)',
    'fm_queue_my_stations(date)', 'is_staff()'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- snapshot publiczny: anon (telefony przez funkcje Netlify z cache) + authenticated
  GRANT EXECUTE ON FUNCTION public.fm_queue_public_snapshot(date) TO anon, authenticated;
END $$;

COMMIT;

-- KONTROLA:
-- select enum_range(null::public.user_role);
-- select proname, prosecdef from pg_proc where proname like 'fm_queue%' order by 1;
-- select * from public.fm_queue_board_v limit 3;
