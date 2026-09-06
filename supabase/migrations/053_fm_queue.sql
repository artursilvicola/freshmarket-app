-- ============================================================================
-- 053_fm_queue.sql  (v2 — po review Codexa z 6.09.2026)
-- [feat/fm-queue] Modul kolejek / numerkow spotkan B2B na zywo (FM 2026).
-- Specyfikacja: docs/production/FM_KOLEJKI_NUMERKI_PROPOZYCJA.md, sekcja 14.
-- Review i kontrpropozycja: docs/production/NOTATKA_DLA_CODEX_2026-09-06_KOLEJKI_REVIEW.md
--
-- WYMAGA: 052_staff_role.sql zaaplikowane WCZESNIEJ, w osobnym uruchomieniu.
--
-- Kolejnosc w pliku (zaleznosci!):
--   1. tabele (fm_staff, fm_login_attempts, fm_queue_groups, fm_stations,
--      fm_queue_meetings, fm_queue_assignments, fm_queue_log, fm_queue_settings)
--   2. triggery integralnosci (updated_at; last_called_nr NIGDY nie maleje)
--   3. helpery: is_staff() (po fm_staff!), fm_queue_assert_operator, idem, lock
--   4. handle_new_user: role uprzywilejowane ('admin','staff') TYLKO z
--      raw_app_meta_data (ustawia wylacznie backend z service_role)
--   5. RLS (anon: NIC na tabelach)
--   6. widok publiczny fm_queue_board_v + snapshot (bez nazw firm)
--   7. RPC operatora (SECURITY DEFINER, search_path=public,pg_temp,
--      blokady w kolejnosci GRUPA -> STANOWISKO -> SPOTKANIE,
--      klucz idempotencji OBOWIAZKOWY i sprawdzany ponownie POD blokada)
--   8. RPC admina (open_day z raportem konfliktow, close_all, assign, reset_day)
--   9. RPC logowania obsluga (tylko service_role): gate + result (atomowy lockout,
--      limit per IP, data eventu, urzadzenie), revoke_sessions
--  10. Realtime publication, granty
--
-- Reguly egzekwowane w bazie:
--   • last_called_nr grupy NIGDY nie maleje (trigger) — nie ma "cofnij wywolanie",
--   • "Zakoncz i wywolaj nastepny" = jedna transakcja pod blokada grupy,
--   • powracajacy obslugiwany poza tablica po spelnieniu bariery (return_after_nr),
--   • wyjatek = max(nr)+1, free_entry/closed tylko gdy stanowisko wolne,
--   • kazda operacja operatora: rola + przypisanie, version, idem key, log.
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor po review bezpieczenstwa (Codex).
-- ============================================================================

BEGIN;

-- ── 1. TABELE ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fm_staff (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,                 -- 'OBSLUGA-3' (login operatora)
  display_name text,
  kind text NOT NULL DEFAULT 'operator' CHECK (kind IN ('operator')),
  event_date date NOT NULL,                  -- konto dziala TYLKO tego dnia (Europe/Warsaw)
  active boolean NOT NULL DEFAULT true,
  blocked boolean NOT NULL DEFAULT false,
  device_id text,                            -- przypiete przy pierwszym logowaniu (wymagane)
  device_bound_at timestamptz,
  device_label text,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  pin_rotated_at timestamptz,                -- sesje wydane wczesniej sa niewazne dla RPC
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fm_login_attempts (   -- limit prob per IP / kod
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  ip text,
  code text,
  ok boolean
);
CREATE INDEX IF NOT EXISTS fm_login_attempts_ip_ts ON public.fm_login_attempts (ip, ts DESC);

CREATE TABLE IF NOT EXISTS public.fm_queue_groups (            -- wlasciciel kolejki i numeracji
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  retailer_id integer NOT NULL REFERENCES public.retailers(id) ON DELETE CASCADE,
  label text,                                -- NULL = sama nazwa sieci; np. 'Owoce' / 'Kwiaty'
  categories text[] NOT NULL DEFAULT '{}',   -- routing spotkan przy Otworz dzien (split)
  gate smallint CHECK (gate IS NULL OR gate IN (1, 2)),
  -- pojemnosc = meetings_per_station × aktywne stanowiska (decyzja Codexa: 60/stanowisko)
  meetings_per_station smallint NOT NULL DEFAULT 60 CHECK (meetings_per_station BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  last_called_nr int NOT NULL DEFAULT 0,     -- publiczny wskaznik: TYLKO do przodu (trigger)
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
CREATE UNIQUE INDEX IF NOT EXISTS fm_queue_meetings_group_company ON public.fm_queue_meetings (queue_group_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fm_queue_meetings_group_status ON public.fm_queue_meetings (queue_group_id, status, nr);
CREATE INDEX IF NOT EXISTS fm_queue_meetings_company ON public.fm_queue_meetings (company_id);
ALTER TABLE public.fm_stations
  DROP CONSTRAINT IF EXISTS fm_stations_current_fk,
  ADD CONSTRAINT fm_stations_current_fk FOREIGN KEY (current_meeting_id) REFERENCES public.fm_queue_meetings(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS fm_stations_returnee_fk,
  ADD CONSTRAINT fm_stations_returnee_fk FOREIGN KEY (active_returnee_id) REFERENCES public.fm_queue_meetings(id) ON DELETE SET NULL;

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

-- ── 2. TRIGGERY INTEGRALNOSCI ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fm_queue_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fm_staff','fm_queue_groups','fm_stations','fm_queue_meetings','fm_queue_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fm_queue_touch()', t, t);
  END LOOP; END $$;

-- Numer publiczny NIGDY nie maleje. Jedyny wyjatek: swiadomy reset dnia przez admina
-- (fm_queue_reset_day ustawia lokalnie fm.allow_reset='on' w swojej transakcji).
CREATE OR REPLACE FUNCTION public.fm_queue_groups_forward_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.last_called_nr < OLD.last_called_nr AND COALESCE(current_setting('fm.allow_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'FM_FORWARD_ONLY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fm_queue_groups_forward_only ON public.fm_queue_groups;
CREATE TRIGGER fm_queue_groups_forward_only BEFORE UPDATE OF last_called_nr ON public.fm_queue_groups
  FOR EACH ROW EXECUTE FUNCTION public.fm_queue_groups_forward_only();

-- ── 3. HELPERY ───────────────────────────────────────────────────────────────
-- staff = profil 'staff' + wiersz fm_staff aktywny, nieblokowany, na DZISIEJSZY dzien
-- eventu, z tokenem wydanym PO ostatniej rotacji PIN-u.
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT p.role = 'staff' AND s.active AND NOT s.blocked
       AND s.event_date = (now() AT TIME ZONE 'Europe/Warsaw')::date
       AND (s.pin_rotated_at IS NULL
            OR NULLIF(auth.jwt()->>'iat', '') IS NULL
            OR to_timestamp((auth.jwt()->>'iat')::bigint) >= s.pin_rotated_at - interval '5 seconds')
    FROM public.profiles p JOIN public.fm_staff s ON s.id = p.id
    WHERE p.id = auth.uid()), false);
$$;

-- kontrola operatora + przypisania (admin zawsze moze); NIE zaklada blokad
CREATE OR REPLACE FUNCTION public.fm_queue_assert_operator(p_group_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
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

CREATE OR REPLACE FUNCTION public.fm_queue_require_idem(p_idem text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_idem IS NULL OR length(btrim(p_idem)) < 8 OR length(p_idem) > 128 THEN
    RAISE EXCEPTION 'FM_IDEM_REQUIRED' USING ERRCODE = '22023';
  END IF;
  RETURN btrim(p_idem);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_idem_done(p_idem text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT p_idem IS NOT NULL AND EXISTS (SELECT 1 FROM public.fm_queue_log l WHERE l.idempotency_key = p_idem);
$$;

CREATE OR REPLACE FUNCTION public.fm_queue_log_write(
  p_operator uuid, p_group uuid, p_station uuid, p_meeting uuid, p_action text,
  p_from text, p_to text, p_nr int, p_idem text, p_payload jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.fm_queue_log (operator_id, device_id, queue_group_id, station_id, meeting_id, action, from_status, to_status, nr, idempotency_key, payload)
  VALUES (p_operator,
          left(NULLIF(NULLIF(current_setting('request.headers', true), '')::jsonb->>'x-device-id', ''), 64),
          p_group, p_station, p_meeting, p_action, p_from, p_to, p_nr, NULLIF(p_idem, ''), p_payload);
END; $$;

-- Blokady ZAWSZE w kolejnosci: grupa -> stanowisko (-> spotkanie w wywolujacym).
-- Zwraca zablokowany wiersz stanowiska; blokady trwaja do konca transakcji.
CREATE OR REPLACE FUNCTION public.fm_queue_lock_station(p_station_id uuid)
RETURNS public.fm_stations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_gid uuid; st public.fm_stations;
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.fm_queue_groups WHERE id = v_gid FOR UPDATE;
  SELECT * INTO st FROM public.fm_stations WHERE id = p_station_id FOR UPDATE;
  RETURN st;
END; $$;

-- Stan stanowiska (WEWNETRZNY — bez kontroli uprawnien; nigdy nie nadawac grantow)
CREATE OR REPLACE FUNCTION public.fm_queue_station_state_unsafe(p_station_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'station_id', st.id, 'group_id', g.id, 'mode', st.mode, 'version', st.version, 'group_version', g.version,
    'last_called_nr', g.last_called_nr,
    'current', (SELECT jsonb_build_object('id', m.id, 'nr', m.nr, 'status', m.status,
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

-- Stan stanowiska (PUBLICZNY dla zalogowanych): tylko admin lub przypisany operator.
CREATE OR REPLACE FUNCTION public.fm_queue_station_state(p_station_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v_gid uuid;
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.fm_queue_assert_operator(v_gid);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- ── 4. handle_new_user: role uprzywilejowane tylko z app_metadata ────────────
-- raw_user_meta_data moze ustawic KAZDY (signUp z klucza anon) -> z niego bierzemy
-- wylacznie 'supplier'/'buyer'. 'admin'/'staff' TYLKO z raw_app_meta_data, ktore
-- zapisuje wylacznie backend przez service_role (admin-create-user, admin-staff).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app_role text;
  v_user_role text;
  v_role public.user_role := 'supplier';
  v_terms text;
  v_privacy text;
  v_accepted_at timestamptz;
BEGIN
  v_app_role  := new.raw_app_meta_data->>'role';
  v_user_role := new.raw_user_meta_data->>'role';
  IF v_app_role IN ('admin', 'staff', 'supplier', 'buyer') THEN
    v_role := v_app_role::public.user_role;
  ELSIF v_user_role IN ('supplier', 'buyer') THEN
    v_role := v_user_role::public.user_role;
  ELSE
    v_role := 'supplier';  -- 'admin'/'staff' z user_metadata sa IGNOROWANE
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

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.fm_staff             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_login_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_stations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_meetings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fm_queue_settings    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fm_staff_admin_all ON public.fm_staff;
CREATE POLICY fm_staff_admin_all ON public.fm_staff FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_staff_self_select ON public.fm_staff;
CREATE POLICY fm_staff_self_select ON public.fm_staff FOR SELECT USING (id = auth.uid());
-- fm_login_attempts: brak polityk = tylko service_role/RPC

DROP POLICY IF EXISTS fm_groups_admin_all ON public.fm_queue_groups;
CREATE POLICY fm_groups_admin_all ON public.fm_queue_groups FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- grupy i stanowiska NIE zawieraja danych wrazliwych (siec, etykieta, gate, liczba
-- stanowisk) — czytaja wszyscy zalogowani: algorytm liczy te sama pojemnosc u kazdej roli.
DROP POLICY IF EXISTS fm_groups_staff_select ON public.fm_queue_groups;
DROP POLICY IF EXISTS fm_groups_auth_select ON public.fm_queue_groups;
CREATE POLICY fm_groups_auth_select ON public.fm_queue_groups FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fm_stations_admin_all ON public.fm_stations;
CREATE POLICY fm_stations_admin_all ON public.fm_stations FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_stations_staff_select ON public.fm_stations;
DROP POLICY IF EXISTS fm_stations_auth_select ON public.fm_stations;
CREATE POLICY fm_stations_auth_select ON public.fm_stations FOR SELECT TO authenticated USING (true);

-- spotkania: operator widzi nazwy firm TYLKO w przypisanych grupach; dostawca TYLKO swoje
DROP POLICY IF EXISTS fm_meetings_admin_all ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_admin_all ON public.fm_queue_meetings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_meetings_staff_select ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_staff_select ON public.fm_queue_meetings FOR SELECT USING (
  public.is_staff() AND EXISTS (SELECT 1 FROM public.fm_queue_assignments a WHERE a.operator_id = auth.uid() AND a.queue_group_id = fm_queue_meetings.queue_group_id));
DROP POLICY IF EXISTS fm_meetings_supplier_own ON public.fm_queue_meetings;
CREATE POLICY fm_meetings_supplier_own ON public.fm_queue_meetings FOR SELECT USING (
  company_id IS NOT NULL AND company_id = public.app_company_id());

DROP POLICY IF EXISTS fm_assign_admin_all ON public.fm_queue_assignments;
CREATE POLICY fm_assign_admin_all ON public.fm_queue_assignments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_assign_self_select ON public.fm_queue_assignments;
CREATE POLICY fm_assign_self_select ON public.fm_queue_assignments FOR SELECT USING (operator_id = auth.uid());

DROP POLICY IF EXISTS fm_log_admin_select ON public.fm_queue_log;
CREATE POLICY fm_log_admin_select ON public.fm_queue_log FOR SELECT USING (public.is_admin());
-- INSERT do logu wylacznie przez RPC (SECURITY DEFINER) — brak polityki INSERT.

DROP POLICY IF EXISTS fm_settings_admin_all ON public.fm_queue_settings;
CREATE POLICY fm_settings_admin_all ON public.fm_queue_settings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS fm_settings_staff_select ON public.fm_queue_settings;
CREATE POLICY fm_settings_staff_select ON public.fm_queue_settings FOR SELECT USING (public.is_staff());

-- ── 6. WIDOK PUBLICZNY (bez nazw firm, bez company_id, bez operatorow) ───────
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

CREATE OR REPLACE FUNCTION public.fm_queue_public_snapshot(p_event_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH d AS (SELECT COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups)) AS ev)
  SELECT jsonb_build_object(
    'event_date', (SELECT ev FROM d),
    'generated_at', now(),
    'settings', (SELECT jsonb_build_object('rotation_s', s.board_rotation_s, 'per_page', s.board_items_per_page, 'pinned', s.board_pinned_group_ids, 'closed_all_at', s.closed_all_at)
                   FROM public.fm_queue_settings s WHERE s.event_date = (SELECT ev FROM d)),
    'stations', COALESCE((SELECT jsonb_agg(to_jsonb(v) - 'updated_at' ORDER BY v.gate NULLS LAST, v.retailer_name, v.group_label, v.station_idx)
                   FROM public.fm_queue_board_v v WHERE v.event_date = (SELECT ev FROM d)), '[]'::jsonb));
$$;

-- ── 7. RPC OPERATORA ─────────────────────────────────────────────────────────
-- Schemat kazdej operacji na stanowisku:
--   idem wymagany -> assert operator (bez blokad) -> lock grupa+stanowisko
--   -> idem sprawdzony PONOWNIE pod blokada -> version -> zmiana -> log -> stan.

CREATE OR REPLACE FUNCTION public.fm_queue_open_station(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  IF NOT st.active THEN RAISE EXCEPTION 'FM_STATION_INACTIVE' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_stations SET mode = 'open', free_entry_started_at = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, NULL, 'open_station', st.mode, 'open', NULL, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_call_next(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; g public.fm_queue_groups; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = st.queue_group_id;  -- juz zablokowana
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
  PERFORM public.fm_queue_log_write(v_op, g.id, st.id, m.id, 'call_next', 'planned', 'called', m.nr, v_idem, jsonb_build_object('prev_last_called_nr', g.last_called_nr));
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_start(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status = 'called' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_CALLED_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'in_progress', started_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'start', 'called', 'in_progress', m.nr, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- Zakoncz biezace (called/in_progress -> done) i od razu wywolaj nastepny — jedna transakcja
CREATE OR REPLACE FUNCTION public.fm_queue_finish_and_call_next(p_station_id uuid, p_expected_version int, p_idem text, p_call_next boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status IN ('called','in_progress') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_ACTIVE_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'done', ended_at = now(), started_at = COALESCE(started_at, now()), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET current_meeting_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'finish', m.status, 'done', m.nr, v_idem, NULL);
  IF p_call_next AND st.mode = 'open' THEN
    BEGIN
      RETURN public.fm_queue_call_next(p_station_id, st.version + 1, v_idem || ':next');
    EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;  -- kolejka pusta: zostajemy bez biezacego
    END;
  END IF;
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_no_show(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.current_meeting_id AND status IN ('called','in_progress') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_ACTIVE_MEETING' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'no_show', ended_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET current_meeting_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'no_show', m.status, 'no_show', m.nr, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- Pomin (planned/returned_waiting -> skipped). Blokady: grupa -> spotkanie.
CREATE OR REPLACE FUNCTION public.fm_queue_skip(p_meeting_id uuid, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.fm_queue_meetings; v_op uuid; v_gid uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_queue_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  PERFORM 1 FROM public.fm_queue_groups WHERE id = v_gid FOR UPDATE;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF public.fm_queue_idem_done(v_idem) THEN RETURN jsonb_build_object('id', m.id, 'status', m.status); END IF;
  IF m.status NOT IN ('planned','returned_waiting') THEN RAISE EXCEPTION 'FM_BAD_STATUS' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'skipped', ended_at = now(), version = version + 1 WHERE id = m.id;
  PERFORM public.fm_queue_log_write(v_op, m.queue_group_id, m.station_id, m.id, 'skip', m.status, 'skipped', m.nr, v_idem, NULL);
  RETURN jsonb_build_object('id', m.id, 'status', 'skipped');
END; $$;

-- Powracajacy zglosil sie (no_show -> returned_waiting) + bariera "po biezacym i kolejnym"
CREATE OR REPLACE FUNCTION public.fm_queue_mark_returned(p_meeting_id uuid, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.fm_queue_meetings; g public.fm_queue_groups; v_op uuid; v_gid uuid; v_barrier int; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_queue_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = v_gid FOR UPDATE;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF public.fm_queue_idem_done(v_idem) THEN RETURN jsonb_build_object('id', m.id, 'status', m.status, 'return_after_nr', m.return_after_nr); END IF;
  IF m.status <> 'no_show' THEN RAISE EXCEPTION 'FM_BAD_STATUS' USING ERRCODE = '22023'; END IF;
  -- bariera = wiekszy z dwoch najblizszych numerow (biezace wywolane + pierwsze planned;
  -- stanowisko wolne: dwa pierwsze planned; zostal jeden: ten; pusta kolejka: NULL = od razu)
  SELECT max(x.nr) INTO v_barrier FROM (
    SELECT nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id AND status IN ('called','in_progress')
    UNION ALL
    SELECT nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id AND status = 'planned' AND nr > g.last_called_nr
    ORDER BY nr LIMIT 2
  ) x;
  UPDATE public.fm_queue_meetings SET status = 'returned_waiting', return_after_nr = v_barrier, version = version + 1 WHERE id = m.id;
  PERFORM public.fm_queue_log_write(v_op, g.id, m.station_id, m.id, 'mark_returned', 'no_show', 'returned_waiting', m.nr, v_idem, jsonb_build_object('return_after_nr', v_barrier));
  RETURN jsonb_build_object('id', m.id, 'status', 'returned_waiting', 'return_after_nr', v_barrier);
END; $$;

-- Obsluz powracajacego POZA tablica (stanowisko wolne, bariera spelniona); last_called_nr bez zmian
CREATE OR REPLACE FUNCTION public.fm_queue_serve_returnee(p_station_id uuid, p_meeting_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; m public.fm_queue_meetings; v_op uuid; v_ready boolean; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
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
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'serve_returnee', 'returned_waiting', 'returned_in_progress', m.nr, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_finish_returnee(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = st.active_returnee_id AND status = 'returned_in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NO_RETURNEE' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_queue_meetings SET status = 'done', ended_at = now(), version = version + 1 WHERE id = m.id;
  UPDATE public.fm_stations SET active_returnee_id = NULL, version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'finish_returnee', 'returned_in_progress', 'done', m.nr, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- Spotkanie wyjatkowe: max(nr)+1, nigdy miedzy wczesniejsze numery. Blokada: grupa.
CREATE OR REPLACE FUNCTION public.fm_queue_add_exception(p_group_id uuid, p_name text, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g public.fm_queue_groups; v_op uuid; v_nr int; v_id uuid; v_prev jsonb; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  v_op := public.fm_queue_assert_operator(p_group_id);
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'FM_NAME_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM public.fm_queue_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF public.fm_queue_idem_done(v_idem) THEN
    SELECT jsonb_build_object('id', l.meeting_id, 'nr', l.nr, 'status', 'planned') INTO v_prev FROM public.fm_queue_log l WHERE l.idempotency_key = v_idem;
    RETURN v_prev;
  END IF;
  SELECT COALESCE(max(nr), 0) + 1 INTO v_nr FROM public.fm_queue_meetings WHERE queue_group_id = g.id;
  v_nr := GREATEST(v_nr, g.last_called_nr + 1);
  INSERT INTO public.fm_queue_meetings (queue_group_id, exception_name, nr, status, source, operator_id)
  VALUES (g.id, left(btrim(p_name), 120), v_nr, 'planned', 'exception', v_op) RETURNING id INTO v_id;
  UPDATE public.fm_queue_groups SET version = version + 1 WHERE id = g.id;
  PERFORM public.fm_queue_log_write(v_op, g.id, NULL, v_id, 'add_exception', NULL, 'planned', v_nr, v_idem, jsonb_build_object('name', left(btrim(p_name), 120)));
  RETURN jsonb_build_object('id', v_id, 'nr', v_nr, 'status', 'planned');
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_set_mode(p_station_id uuid, p_mode text, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; v_op uuid; v_busy boolean; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  IF p_mode NOT IN ('open','paused','free_entry','closed') THEN RAISE EXCEPTION 'FM_BAD_MODE' USING ERRCODE = '22023'; END IF;
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  v_busy := st.active_returnee_id IS NOT NULL OR (st.current_meeting_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.id = st.current_meeting_id AND x.status IN ('called','in_progress')));
  IF p_mode IN ('free_entry','closed') AND v_busy THEN RAISE EXCEPTION 'FM_STATION_BUSY' USING ERRCODE = '22023'; END IF;
  UPDATE public.fm_stations SET mode = p_mode,
    free_entry_started_at = CASE WHEN p_mode = 'free_entry' THEN now() ELSE NULL END,
    version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, NULL, 'set_mode', st.mode, p_mode, NULL, v_idem, NULL);
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- Cofnij (<= 30 s) WYLACZNIE status spotkania na tym stanowisku: start, no_show, finish.
-- Publicznego wywolania numeru (call_next) NIE cofamy — numer na tablicy nigdy nie maleje.
CREATE OR REPLACE FUNCTION public.fm_queue_undo(p_station_id uuid, p_expected_version int, p_idem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st public.fm_stations; v_gid uuid; l public.fm_queue_log; m public.fm_queue_meetings; v_op uuid; v_idem text := public.fm_queue_require_idem(p_idem);
BEGIN
  SELECT queue_group_id INTO v_gid FROM public.fm_stations WHERE id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_op := public.fm_queue_assert_operator(v_gid);
  st := public.fm_queue_lock_station(p_station_id);
  IF public.fm_queue_idem_done(v_idem) THEN RETURN public.fm_queue_station_state_unsafe(p_station_id); END IF;
  IF st.version <> p_expected_version THEN RAISE EXCEPTION 'FM_CONFLICT' USING ERRCODE = '40001'; END IF;
  -- ostatnia operacja stanowiska (dowolna) — cofac mozna tylko, gdy jest ostatnia i niecofnieta
  SELECT * INTO l FROM public.fm_queue_log l0
    WHERE l0.station_id = st.id AND l0.action NOT LIKE 'undo\_%'
    ORDER BY l0.ts DESC, l0.id DESC LIMIT 1;
  IF NOT FOUND OR l.ts < now() - interval '30 seconds' THEN RAISE EXCEPTION 'FM_UNDO_EXPIRED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.fm_queue_log u WHERE u.action LIKE 'undo\_%' AND (u.payload->>'undone_log_id')::bigint = l.id) THEN
    RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023';
  END IF;
  IF l.action = 'call_next' THEN RAISE EXCEPTION 'FM_UNDO_FORBIDDEN' USING ERRCODE = '22023'; END IF;  -- numery tylko do przodu
  IF l.action NOT IN ('start','no_show','finish') THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
  IF st.active_returnee_id IS NOT NULL THEN RAISE EXCEPTION 'FM_STATION_BUSY_RETURNEE' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.fm_queue_meetings WHERE id = l.meeting_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
  IF l.action = 'start' THEN
    IF m.status <> 'in_progress' OR st.current_meeting_id IS DISTINCT FROM m.id THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
    UPDATE public.fm_queue_meetings SET status = 'called', started_at = NULL, version = version + 1 WHERE id = m.id;
  ELSE  -- no_show / finish: przywroc spotkanie jako biezace, jesli stanowisko wolne
    IF st.current_meeting_id IS NOT NULL THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
    IF m.status NOT IN ('no_show','done') THEN RAISE EXCEPTION 'FM_UNDO_NOT_LAST' USING ERRCODE = '22023'; END IF;
    UPDATE public.fm_queue_meetings SET status = l.from_status, ended_at = NULL, station_id = st.id, version = version + 1 WHERE id = m.id;
    UPDATE public.fm_stations SET current_meeting_id = m.id WHERE id = st.id;
  END IF;
  UPDATE public.fm_stations SET version = version + 1, updated_by = v_op WHERE id = st.id;
  PERFORM public.fm_queue_log_write(v_op, st.queue_group_id, st.id, m.id, 'undo_' || l.action, l.to_status, l.from_status, m.nr, v_idem, jsonb_build_object('undone_log_id', l.id));
  RETURN public.fm_queue_station_state_unsafe(p_station_id);
END; $$;

-- Operator: moje stanowiska (przypisane grupy) — jedno zapytanie dla tabletu
CREATE OR REPLACE FUNCTION public.fm_queue_my_stations(p_event_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_admin boolean; v_ev date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FM_AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  v_admin := public.is_admin();
  IF NOT v_admin AND NOT public.is_staff() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  v_ev := COALESCE(p_event_date, (SELECT max(event_date) FROM public.fm_queue_groups));
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'station_id', st.id, 'group_id', g.id, 'retailer_name', r.name, 'group_label', g.label, 'gate', g.gate,
      'station_idx', st.idx, 'station_label', st.label,
      'stations_in_group', (SELECT count(*) FROM public.fm_stations x WHERE x.queue_group_id = g.id AND x.active),
      'state', public.fm_queue_station_state_unsafe(st.id))
    ORDER BY r.name, g.label NULLS FIRST, st.idx), '[]'::jsonb)
  FROM public.fm_stations st
  JOIN public.fm_queue_groups g ON g.id = st.queue_group_id
  JOIN public.retailers r ON r.id = g.retailer_id
  WHERE st.active AND g.active AND g.event_date = v_ev
    AND (v_admin OR EXISTS (SELECT 1 FROM public.fm_queue_assignments a WHERE a.operator_id = v_uid AND a.queue_group_id = g.id)));
END; $$;

-- ── 8. RPC ADMINA ────────────────────────────────────────────────────────────
-- Otworz dzien: import ZATWIERDZONEGO planu (fm_settings dla tej daty, faza opublikowana)
-- do kolejek. Raport: wstawione / zaktualizowane / pominiete grupy / problemy per para.
--   p_force=false: grupa, ktora ma juz spotkania z planu, jest pomijana w calosci.
--   p_force=true : kontrolowana synchronizacja — nowe pary dopisywane, zmieniony numer
--                  aktualizowany TYLKO dla spotkan 'planned', konflikty raportowane.
CREATE OR REPLACE FUNCTION public.fm_queue_open_day(p_event_date date, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_sched jsonb; v_ret public.retailers; v_group uuid;
  v_groups int := 0; v_inserted int := 0; v_updated int := 0; v_skipped_groups int := 0;
  r record; v_cnt int; v_match int; v_catchall int; v_existing public.fm_queue_meetings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT schedule INTO v_sched FROM public.fm_settings
    WHERE event_date = p_event_date AND algo_phase IN ('published','final_published','event_day')
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FM_PLAN_NOT_PUBLISHED' USING ERRCODE = 'P0002'; END IF;
  IF v_sched IS NULL OR v_sched->'nums' IS NULL OR jsonb_typeof(v_sched->'nums') <> 'object' THEN RAISE EXCEPTION 'FM_NO_SCHEDULE' USING ERRCODE = 'P0002'; END IF;

  -- domyslne grupy/stanowiska dla sieci FM bez konfiguracji
  FOR v_ret IN SELECT * FROM public.retailers WHERE fm26_active AND fm26_chain_id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.fm_queue_groups WHERE event_date = p_event_date AND retailer_id = v_ret.id) THEN
      INSERT INTO public.fm_queue_groups (event_date, retailer_id, gate) VALUES (p_event_date, v_ret.id, v_ret.fm_gate) RETURNING id INTO v_group;
      INSERT INTO public.fm_stations (queue_group_id, idx) VALUES (v_group, 1);
      v_groups := v_groups + 1;
    END IF;
  END LOOP;
  INSERT INTO public.fm_queue_settings (event_date, day_opened_at, updated_by) VALUES (p_event_date, now(), v_uid)
    ON CONFLICT (event_date) DO UPDATE SET day_opened_at = COALESCE(public.fm_queue_settings.day_opened_at, now()), updated_by = v_uid;

  -- blokujemy wszystkie grupy dnia (import nie moze sciac sie z operatorem)
  PERFORM 1 FROM public.fm_queue_groups WHERE event_date = p_event_date ORDER BY id FOR UPDATE;

  DROP TABLE IF EXISTS t_imp;
  CREATE TEMP TABLE t_imp (rid serial PRIMARY KEY, sid text, cid text, nr int, company_id uuid, group_id uuid, reason text) ON COMMIT DROP;
  INSERT INTO t_imp (sid, cid, nr)
    SELECT s.key, c.key, NULLIF(c.value, '')::int
    FROM jsonb_each(v_sched->'nums') s, jsonb_each_text(s.value) c
    WHERE jsonb_typeof(s.value) = 'object';
  UPDATE t_imp SET reason = 'bad_nr' WHERE nr IS NULL OR nr <= 0;
  UPDATE t_imp t SET company_id = c.id FROM public.companies c WHERE t.reason IS NULL AND (c.id::text = t.sid OR c.legacy_fm_id = t.sid);
  UPDATE t_imp SET reason = 'missing_supplier' WHERE reason IS NULL AND company_id IS NULL;

  -- routing do grupy: 1 grupa -> ona; split -> dokladnie jedna zgodna kategoria,
  -- w przeciwnym razie jedyna grupa bez kategorii (catch-all); inaczej 'unrouted'
  FOR r IN SELECT t.rid, t.cid, t.company_id FROM t_imp t WHERE t.reason IS NULL ORDER BY t.rid LOOP
    SELECT count(*) INTO v_cnt FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
      WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid;
    IF v_cnt = 0 THEN UPDATE t_imp SET reason = 'missing_chain' WHERE rid = r.rid; CONTINUE; END IF;
    IF v_cnt = 1 THEN
      UPDATE t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid) WHERE rid = r.rid;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_match FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id JOIN public.companies c ON c.id = r.company_id
      WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) > 0 AND c.categories && g.categories;
    IF v_match = 1 THEN
      UPDATE t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id JOIN public.companies c ON c.id = r.company_id
        WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) > 0 AND c.categories && g.categories) WHERE rid = r.rid;
      CONTINUE;
    END IF;
    IF v_match = 0 THEN
      SELECT count(*) INTO v_catchall FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
        WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) = 0;
      IF v_catchall = 1 THEN
        UPDATE t_imp SET group_id = (SELECT g.id FROM public.fm_queue_groups g JOIN public.retailers rt ON rt.id = g.retailer_id
          WHERE g.event_date = p_event_date AND g.active AND rt.fm26_chain_id = r.cid AND cardinality(g.categories) = 0) WHERE rid = r.rid;
        CONTINUE;
      END IF;
    END IF;
    UPDATE t_imp SET reason = 'unrouted' WHERE rid = r.rid;  -- decyzja admina (split bez jednoznacznej kategorii)
  END LOOP;

  -- grupy juz zaimportowane (stan SPRZED importu) -> pomijane bez p_force
  IF NOT p_force THEN
    UPDATE t_imp t SET reason = 'group_already_imported'
      WHERE t.reason IS NULL AND EXISTS (SELECT 1 FROM public.fm_queue_meetings m WHERE m.queue_group_id = t.group_id AND m.source = 'plan');
    SELECT count(DISTINCT group_id) INTO v_skipped_groups FROM t_imp WHERE reason = 'group_already_imported';
  END IF;

  -- wstawianie / synchronizacja
  FOR r IN SELECT t.* FROM t_imp t WHERE t.reason IS NULL ORDER BY t.group_id, t.nr LOOP
    SELECT * INTO v_existing FROM public.fm_queue_meetings WHERE queue_group_id = r.group_id AND company_id = r.company_id;
    IF FOUND THEN
      IF v_existing.nr = r.nr THEN UPDATE t_imp SET reason = 'unchanged' WHERE rid = r.rid; CONTINUE; END IF;
      IF v_existing.status <> 'planned' THEN UPDATE t_imp SET reason = 'locked_status' WHERE rid = r.rid; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.queue_group_id = r.group_id AND x.nr = r.nr AND x.id <> v_existing.id) THEN
        UPDATE t_imp SET reason = 'nr_conflict' WHERE rid = r.rid; CONTINUE;
      END IF;
      UPDATE public.fm_queue_meetings SET nr = r.nr, version = version + 1 WHERE id = v_existing.id;
      UPDATE t_imp SET reason = 'updated' WHERE rid = r.rid; v_updated := v_updated + 1;
    ELSE
      IF EXISTS (SELECT 1 FROM public.fm_queue_meetings x WHERE x.queue_group_id = r.group_id AND x.nr = r.nr) THEN
        UPDATE t_imp SET reason = 'nr_conflict' WHERE rid = r.rid; CONTINUE;
      END IF;
      INSERT INTO public.fm_queue_meetings (queue_group_id, company_id, nr, status, source) VALUES (r.group_id, r.company_id, r.nr, 'planned', 'plan');
      UPDATE t_imp SET reason = 'inserted' WHERE rid = r.rid; v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'open_day', NULL, NULL, NULL, NULL,
    jsonb_build_object('event_date', p_event_date, 'force', p_force, 'groups_created', v_groups, 'inserted', v_inserted, 'updated', v_updated, 'skipped_groups', v_skipped_groups,
      'problems', (SELECT count(*) FROM t_imp WHERE reason NOT IN ('inserted','updated','unchanged'))));
  RETURN jsonb_build_object(
    'groups_created', v_groups, 'inserted', v_inserted, 'updated', v_updated, 'skipped_groups', v_skipped_groups,
    'unchanged', (SELECT count(*) FROM t_imp WHERE reason = 'unchanged'),
    'problems', COALESCE((SELECT jsonb_agg(jsonb_build_object('sid', sid, 'cid', cid, 'nr', nr, 'reason', reason) ORDER BY reason, cid, nr)
                          FROM t_imp WHERE reason NOT IN ('inserted','updated','unchanged','group_already_imported')), '[]'::jsonb));
END; $$;

-- Zamknij wszystkie stanowiska (17:00), w tym Free entry
CREATE OR REPLACE FUNCTION public.fm_queue_close_all(p_event_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.fm_queue_groups WHERE event_date = p_event_date ORDER BY id FOR UPDATE;
  UPDATE public.fm_stations st SET mode = 'closed', free_entry_started_at = NULL, version = version + 1, updated_by = v_uid
    FROM public.fm_queue_groups g WHERE g.id = st.queue_group_id AND g.event_date = p_event_date AND st.mode <> 'closed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.fm_queue_settings SET closed_all_at = now(), updated_by = v_uid WHERE event_date = p_event_date;
  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'close_all', NULL, 'closed', NULL, NULL, jsonb_build_object('event_date', p_event_date, 'stations', v_n));
  RETURN jsonb_build_object('closed', v_n);
END; $$;

-- Reset dnia (TYLKO proba generalna / dzien testowy): usuwa spotkania, zeruje numery.
-- Jedyna droga zmniejszenia last_called_nr (flaga fm.allow_reset lokalna dla tej transakcji).
-- Odmawia, gdy dzien byl juz otwarty tego samego dnia kalendarzowego, w ktorym trwa event.
CREATE OR REPLACE FUNCTION public.fm_queue_reset_day(p_event_date date, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_confirm IS DISTINCT FROM ('RESET ' || to_char(p_event_date, 'YYYY-MM-DD')) THEN RAISE EXCEPTION 'FM_CONFIRM_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF p_event_date = (now() AT TIME ZONE 'Europe/Warsaw')::date AND EXISTS (SELECT 1 FROM public.fm_queue_log WHERE action IN ('call_next','start','finish') AND ts > (now() AT TIME ZONE 'Europe/Warsaw')::date) THEN
    RAISE EXCEPTION 'FM_RESET_LIVE_DAY' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('fm.allow_reset', 'on', true);
  PERFORM 1 FROM public.fm_queue_groups WHERE event_date = p_event_date ORDER BY id FOR UPDATE;
  UPDATE public.fm_stations st SET mode = 'closed', current_meeting_id = NULL, active_returnee_id = NULL, free_entry_started_at = NULL, version = version + 1, updated_by = v_uid
    FROM public.fm_queue_groups g WHERE g.id = st.queue_group_id AND g.event_date = p_event_date;
  DELETE FROM public.fm_queue_meetings m USING public.fm_queue_groups g WHERE g.id = m.queue_group_id AND g.event_date = p_event_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.fm_queue_groups SET last_called_nr = 0, version = version + 1 WHERE event_date = p_event_date;
  UPDATE public.fm_queue_settings SET day_opened_at = NULL, closed_all_at = NULL, updated_by = v_uid WHERE event_date = p_event_date;
  PERFORM public.fm_queue_log_write(v_uid, NULL, NULL, NULL, 'reset_day', NULL, NULL, NULL, NULL, jsonb_build_object('event_date', p_event_date, 'deleted_meetings', v_n));
  RETURN jsonb_build_object('deleted_meetings', v_n);
END; $$;

CREATE OR REPLACE FUNCTION public.fm_queue_assign_retailer(p_operator_id uuid, p_retailer_id int, p_event_date date, p_assign boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fm_staff WHERE id = p_operator_id) THEN RAISE EXCEPTION 'FM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
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

-- ── 9. LOGOWANIE OBSLUGI (tylko service_role, wolane z funkcji Netlify) ──────
-- gate: limit per IP (30 prob / 15 min), istnienie kodu, blokada, lockout, data eventu,
-- zgodnosc urzadzenia. Zapisuje probe. NIE weryfikuje PIN-u (to robi GoTrue).
CREATE OR REPLACE FUNCTION public.fm_staff_login_gate(p_code text, p_ip text, p_device text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.fm_staff; v_ip_n int; v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
BEGIN
  DELETE FROM public.fm_login_attempts WHERE ts < now() - interval '2 days';
  INSERT INTO public.fm_login_attempts (ip, code) VALUES (left(p_ip, 64), left(p_code, 32));
  SELECT count(*) INTO v_ip_n FROM public.fm_login_attempts WHERE ip = left(p_ip, 64) AND ts > now() - interval '15 minutes';
  IF p_ip IS NOT NULL AND v_ip_n > 30 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_RATE_LIMIT', 'retry_after_s', 900); END IF;
  SELECT * INTO s FROM public.fm_staff WHERE code = p_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_BAD_CREDENTIALS'); END IF;
  IF s.blocked OR NOT s.active THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_BLOCKED'); END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'FM_LOCKED', 'retry_after_s', GREATEST(1, ceil(extract(epoch FROM s.locked_until - now())))::int);
  END IF;
  IF s.event_date <> v_today THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_WRONG_DAY', 'event_date', s.event_date); END IF;
  IF p_device IS NULL OR length(p_device) < 8 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_DEVICE_REQUIRED'); END IF;
  IF s.device_id IS NOT NULL AND s.device_id <> p_device THEN RETURN jsonb_build_object('allowed', false, 'reason', 'FM_DEVICE_MISMATCH'); END IF;
  RETURN jsonb_build_object('allowed', true, 'id', s.id, 'code', s.code, 'display_name', s.display_name, 'attempts_left', 5 - s.failed_logins);
END; $$;

-- result: atomowa aktualizacja licznika/lockoutu (UPDATE w jednym wyrazeniu — bez wyscigu)
CREATE OR REPLACE FUNCTION public.fm_staff_login_result(p_code text, p_ip text, p_success boolean, p_device text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_failed int; v_locked timestamptz; v_dev text;
BEGIN
  UPDATE public.fm_login_attempts SET ok = p_success WHERE id = (SELECT max(id) FROM public.fm_login_attempts WHERE code = left(p_code, 32) AND ip IS NOT DISTINCT FROM left(p_ip, 64));
  IF p_success THEN
    UPDATE public.fm_staff SET failed_logins = 0, locked_until = NULL, last_login_at = now(),
      device_id = COALESCE(device_id, left(p_device, 64)), device_bound_at = COALESCE(device_bound_at, now())
      WHERE code = p_code RETURNING device_id INTO v_dev;
    RETURN jsonb_build_object('ok', true, 'device_id', v_dev);
  END IF;
  UPDATE public.fm_staff
    SET failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
        locked_until  = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
    WHERE code = p_code RETURNING failed_logins, locked_until INTO v_failed, v_locked;
  RETURN jsonb_build_object('ok', false,
    'locked', v_locked IS NOT NULL AND v_locked > now(),
    'retry_after_s', CASE WHEN v_locked IS NOT NULL AND v_locked > now() THEN GREATEST(1, ceil(extract(epoch FROM v_locked - now())))::int ELSE NULL END,
    'attempts_left', CASE WHEN v_locked IS NOT NULL AND v_locked > now() THEN 0 ELSE 5 - v_failed END);
END; $$;

-- reset PIN / blokada: uniewaznij sesje (refresh tokeny + sesje) i odepnij urzadzenie
CREATE OR REPLACE FUNCTION public.fm_staff_revoke_sessions(p_user uuid, p_rotate_pin boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user::text;
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.fm_staff SET device_id = NULL, device_bound_at = NULL, failed_logins = 0, locked_until = NULL,
    pin_rotated_at = CASE WHEN p_rotate_pin THEN now() ELSE pin_rotated_at END WHERE id = p_user;
  RETURN jsonb_build_object('sessions_revoked', v_n);
END; $$;

-- ── 10. REALTIME + GRANTY ────────────────────────────────────────────────────
-- Supabase Realtime (postgres_changes) wysyla zmiany tylko z tabel w publikacji.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fm_stations') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fm_stations';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fm_queue_groups') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fm_queue_groups';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nie udalo sie dodac tabel do supabase_realtime (%): dodaj recznie w Database -> Publications.', SQLERRM;
    END;
  ELSE
    RAISE WARNING 'Brak publikacji supabase_realtime — Realtime dla fm_stations/fm_queue_groups trzeba wlaczyc recznie (Database -> Publications).';
  END IF;
END $$;

-- Widok tablicy: security_invoker = false (domyslnie) — CELOWO: anon czyta TYLKO te
-- projekcje (siec, stanowisko, tryb, numery), a nie tabele pod spodem.
REVOKE ALL ON public.fm_queue_board_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fm_queue_board_v TO anon, authenticated;
REVOKE ALL ON public.fm_login_attempts FROM PUBLIC, anon, authenticated;

-- Supabase nadaje nowym funkcjom EXECUTE dla anon/authenticated (ALTER DEFAULT PRIVILEGES)
-- — odbieramy WSZYSTKO i nadajemy jawnie. Helpery i *_unsafe zostaja bez grantow.
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'is_staff()',
    'fm_queue_assert_operator(uuid)', 'fm_queue_require_idem(text)', 'fm_queue_idem_done(text)',
    'fm_queue_log_write(uuid,uuid,uuid,uuid,text,text,text,int,text,jsonb)', 'fm_queue_lock_station(uuid)',
    'fm_queue_station_state_unsafe(uuid)', 'fm_queue_station_state(uuid)',
    'fm_queue_open_station(uuid,int,text)', 'fm_queue_call_next(uuid,int,text)', 'fm_queue_start(uuid,int,text)',
    'fm_queue_finish_and_call_next(uuid,int,text,boolean)', 'fm_queue_no_show(uuid,int,text)', 'fm_queue_skip(uuid,text)',
    'fm_queue_mark_returned(uuid,text)', 'fm_queue_serve_returnee(uuid,uuid,int,text)', 'fm_queue_finish_returnee(uuid,int,text)',
    'fm_queue_add_exception(uuid,text,text)', 'fm_queue_set_mode(uuid,text,int,text)', 'fm_queue_undo(uuid,int,text)',
    'fm_queue_my_stations(date)', 'fm_queue_public_snapshot(date)',
    'fm_queue_open_day(date,boolean)', 'fm_queue_close_all(date)', 'fm_queue_reset_day(date,text)', 'fm_queue_assign_retailer(uuid,int,date,boolean)',
    'fm_staff_login_gate(text,text,text)', 'fm_staff_login_result(text,text,boolean,text)', 'fm_staff_revoke_sessions(uuid,boolean)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- zalogowani (admin/staff): kazda funkcja sprawdza role i przypisanie w srodku
  FOREACH f IN ARRAY ARRAY[
    'is_staff()', 'fm_queue_station_state(uuid)',
    'fm_queue_open_station(uuid,int,text)', 'fm_queue_call_next(uuid,int,text)', 'fm_queue_start(uuid,int,text)',
    'fm_queue_finish_and_call_next(uuid,int,text,boolean)', 'fm_queue_no_show(uuid,int,text)', 'fm_queue_skip(uuid,text)',
    'fm_queue_mark_returned(uuid,text)', 'fm_queue_serve_returnee(uuid,uuid,int,text)', 'fm_queue_finish_returnee(uuid,int,text)',
    'fm_queue_add_exception(uuid,text,text)', 'fm_queue_set_mode(uuid,text,int,text)', 'fm_queue_undo(uuid,int,text)',
    'fm_queue_my_stations(date)',
    'fm_queue_open_day(date,boolean)', 'fm_queue_close_all(date)', 'fm_queue_reset_day(date,text)', 'fm_queue_assign_retailer(uuid,int,date,boolean)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- snapshot publiczny: anon (telefony przez funkcje Netlify z cache) + authenticated
  GRANT EXECUTE ON FUNCTION public.fm_queue_public_snapshot(date) TO anon, authenticated;
  -- logowanie obslugi: wylacznie backend (service_role)
  GRANT EXECUTE ON FUNCTION public.fm_staff_login_gate(text,text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.fm_staff_login_result(text,text,boolean,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.fm_staff_revoke_sessions(uuid,boolean) TO service_role;
END $$;

COMMIT;

-- KONTROLA:
-- select enum_range(null::public.user_role);                       -- {admin,supplier,buyer,staff}
-- select proname, prosecdef from pg_proc where proname like 'fm_queue%' or proname like 'fm_staff%' order by 1;
-- select * from pg_publication_tables where pubname='supabase_realtime' and tablename like 'fm_%';
-- select * from public.fm_queue_board_v limit 3;
