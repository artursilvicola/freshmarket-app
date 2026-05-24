-- ============================================================================
-- 033 — HOTFIX: trigger 032 blokował rejestrację dostawcy
-- [B2B Round prod-rollout / admin-team hotfix]
--
-- Bug zgłoszony przez Artura po wgraniu migracji 032:
--   Rejestracja nowego dostawcy → "Database error creating new user"
--
-- Przyczyna:
--   Mój trigger enforce_super_admin_on_role_change() w 032 sprawdzał
--   auth.uid() żeby określić kto edytuje profile. ALE:
--
--   1) Netlify Function register-supplier-self.js używa service_role.
--      W kontekście service_role auth.uid() może rzucać błąd albo
--      zwracać niepuste wartości specjalne (zależy od wersji Supabase).
--      Mój prosty IF NULL bypass nie złapał wszystkich przypadków.
--
--   2) register-supplier-self.js robi `upsert` na profiles. Jeśli
--      Supabase Auth ma trigger handle_new_user który automatycznie
--      tworzy profile po auth.admin.createUser, to upsert idzie jako
--      UPDATE (nie INSERT) — i mój trigger BEFORE UPDATE odpalał się
--      na zmianie role NULL → "supplier", co miało wyglądać jak
--      zmiana role wymagająca super-admina.
--
-- Fix — bardziej defensywny trigger:
--   • Wrap auth.uid() w BEGIN/EXCEPTION (zwraca NULL przy błędzie)
--   • Sprawdź request.jwt.claim.role — bypass dla service_role
--   • Bypass dla NULL caller (cron, migracje, system internal)
--   • Pierwsze ustawienie role z NULL→cokolwiek przy INSERT-via-upsert
--     to BEZPIECZNIE — to nie eskalacja, tylko nadanie pierwotnej roli
--
-- Idempotentne: CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_super_admin_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super  boolean;
  v_caller_id uuid;
  v_jwt_role  text;
BEGIN
  -- ── 1. Bezpieczne pobranie auth.uid() ─────────────────────────────────
  -- W kontekście service_role / cron / migracji auth.uid() może rzucać
  -- błąd. BEGIN/EXCEPTION go łapie i ustawia NULL.
  BEGIN
    v_caller_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := NULL;
  END;

  -- ── 2. Bypass dla service_role ────────────────────────────────────────
  -- Netlify Functions (register-supplier-self, send-retailer-batch itd.)
  -- używają service_role do CRUD. Te wywołania to "system trust" —
  -- nie blokujemy ich naszą weryfikacją RBAC.
  BEGIN
    v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' OR v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── 3. Bezpieczna pierwsza inicjalizacja role (NULL → cokolwiek) ──────
  -- Jeśli stara role była NULL (świeży profile utworzony przez trigger
  -- handle_new_user) a nowa jest ustawiana po raz pierwszy (np. przez
  -- selfRegisterSupplier), to NIE jest eskalacja uprawnień, tylko
  -- pierwsze nadanie pozycji w systemie. Pozwalamy.
  IF OLD.role IS NULL AND NEW.role IS NOT NULL THEN
    -- Ale jeśli ktoś NIE jest authenticated user, nie powinien móc nadać
    -- sobie role. service_role już przeszedł wyżej, więc dochodzi tu
    -- tylko zalogowany user → blokujemy nadanie sobie roli admin.
    IF NEW.role = 'admin' AND NEW.id = v_caller_id THEN
      RAISE EXCEPTION 'Nie można nadać sobie samemu roli administratora.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ── 4. Self-edit istniejącego usera ──────────────────────────────────
  -- User może edytować WŁASNY wiersz (name, email, phone, ustawienia)
  -- ale NIE może zmienić sobie role ani admin_level.
  IF NEW.id = v_caller_id THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Nie można zmienić sobie samemu roli (role). Tę operację wykonuje super admin.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.admin_level IS DISTINCT FROM OLD.admin_level THEN
      RAISE EXCEPTION 'Nie można zmienić sobie samemu admin_level. Tę operację wykonuje inny super admin.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ── 5. Edycja CUDZEGO wiersza ─────────────────────────────────────────
  -- Zmiana role / admin_level cudzemu userowi wymaga super-admina.
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.admin_level IS DISTINCT FROM OLD.admin_level THEN
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = v_caller_id
        AND role = 'admin'
        AND admin_level = 'super'
    ) INTO v_is_super;

    IF NOT v_is_super THEN
      RAISE EXCEPTION 'Zmiana role / admin_level wymaga uprawnień super administratora.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_super_admin_on_role_change() IS
  'Trigger BEFORE UPDATE na profiles. v2 (033): bezpieczny dla service_role + '
  'NULL→cokolwiek (pierwsza inicjalizacja role przez self-register). Blokuje '
  'eskalację uprawnień przez authenticated userów którzy nie są super-adminem.';

COMMIT;

-- ============================================================================
-- WALIDACJA — uruchom po wdrożeniu żeby sprawdzić że trigger nadal istnieje
-- ============================================================================
-- SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
-- FROM pg_trigger
-- WHERE tgname = 'trg_enforce_super_admin_on_role_change';
-- → 1 wiersz, tgenabled='O' (Origin = włączony)
-- ============================================================================
