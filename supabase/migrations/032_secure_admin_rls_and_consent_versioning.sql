-- ============================================================================
-- 032 — Secure admin RLS (trigger guard) + wersjonowanie zgód RODO/regulamin
-- [B2B Round prod-rollout / legal + admin-team hardening]
--
-- Codex w review wykrył 2 problemy w migracji 031:
--
-- 1) RLS-BUG: nowa polityka `profiles_super_admin_role_change` została dodana
--    OBOK starej polityki "admin_update" (z 002_rls_policies.sql). PostgreSQL
--    sumuje polityki PERMISSIVE przez OR — zwykły admin nadal może
--    UPDATE'ować profiles bo stara polityka mu na to pozwala. Nowa polityka
--    nic nie ogranicza, tylko dodaje równoległą ścieżkę.
--
--    Fix: TRIGGER BEFORE UPDATE który niezależnie od polityk RLS sprawdza
--    czy zmiana dotyczy role lub admin_level i czy auth.uid() jest
--    super-adminem. To "defense in depth" — nawet jeśli ktoś poluzuje RLS,
--    trigger nadal blokuje.
--
-- 2) BRAK wersjonowania zgód — przy RODO/regulaminie powinno się zapisywać
--    którą wersję dokumentu user zaakceptował (art. 7 RODO — obowiązek
--    wykazania zgody). Dodajemy 3 kolumny do profiles + helper widok.
--
-- Idempotentne: CREATE OR REPLACE TRIGGER, ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- CZĘŚĆ A — TRIGGER zabezpieczający role/admin_level przed zwykłymi adminami
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_super_admin_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super boolean;
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();

  -- Bypass dla operacji bez user context (np. migracja, backend service role).
  -- auth.uid() zwraca NULL kiedy operacja idzie z service_role / SQL Editor
  -- jako postgres user. Trigger ma blokować tylko ruch przez RLS-aware
  -- ścieżki (frontend → PostgREST).
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-edit: user może edytować WŁASNY wiersz (np. swój own name, email)
  -- ale NIE może zmienić sobie role ani admin_level
  -- (zabezpieczenie przed eskalacją uprawnień u dostawcy/kupca)
  IF NEW.id = v_caller_id THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Nie można zmienić sobie samemu roli (role). Tę operację wykonuje super admin.'
        USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;
    IF NEW.admin_level IS DISTINCT FROM OLD.admin_level THEN
      RAISE EXCEPTION 'Nie można zmienić sobie samemu admin_level. Tę operację wykonuje inny super admin.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Edycja CUDZEGO wiersza: zmiana role / admin_level wymaga super-admina
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
  'Trigger BEFORE UPDATE na profiles. Blokuje zmianę role/admin_level przez '
  'kogokolwiek poza super-adminem. Działa niezależnie od polityk RLS — '
  'defense-in-depth.';

-- Zdejmij ewentualnie istniejący trigger żeby uniknąć duplikatu
DROP TRIGGER IF EXISTS trg_enforce_super_admin_on_role_change ON profiles;

CREATE TRIGGER trg_enforce_super_admin_on_role_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_super_admin_on_role_change();

-- Plus zdejmijmy nadmiarową/mylącą politykę z 031 — trigger ją zastępuje
-- i działa pewniej. Polityka mogła sugerować że RLS sam wystarcza, a nie wystarczał.
DROP POLICY IF EXISTS profiles_super_admin_role_change ON profiles;


-- ─────────────────────────────────────────────────────────────────────────
-- CZĘŚĆ B — Wersjonowanie zgód RODO + regulamin (art. 7 RODO)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS accepted_terms_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_privacy_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN profiles.accepted_terms_version IS
  'Wersja Regulaminu zaakceptowana przy rejestracji (np. "1.0"). NULL = '
  'przed wprowadzeniem wersjonowania (przed migracją 032).';
COMMENT ON COLUMN profiles.accepted_privacy_version IS
  'Wersja Polityki Prywatności zaakceptowana przy rejestracji.';
COMMENT ON COLUMN profiles.accepted_at IS
  'Data i godzina akceptacji Regulaminu i Polityki Prywatności.';

-- Backfill dla istniejących userów którzy zaakceptowali przed wprowadzeniem
-- wersjonowania. Zapisujemy "pre-1.0" + timestamp ich rejestracji.
-- Po wdrożeniu wersji 1.0 Regulaminu, nowe rejestracje będą zapisywać "1.0".
UPDATE profiles
SET accepted_terms_version = 'pre-1.0',
    accepted_privacy_version = 'pre-1.0',
    accepted_at = COALESCE(created_at, now())
WHERE accepted_terms_version IS NULL
  AND created_at IS NOT NULL;

-- Helper view dla admina: kto którą wersję zaakceptował
CREATE OR REPLACE VIEW public.consent_audit AS
SELECT
  id,
  email,
  role,
  accepted_terms_version,
  accepted_privacy_version,
  accepted_at,
  created_at
FROM profiles
WHERE accepted_terms_version IS NOT NULL;

COMMENT ON VIEW public.consent_audit IS
  'Audit zgód regulamin/polityka per user. Dla wymogu art. 7 RODO (obowiązek '
  'wykazania zgody). Tylko widok — żadne uprawnienia poza domyślnymi.';


-- ─────────────────────────────────────────────────────────────────────────
-- WALIDACJA — sprawdź że trigger działa
-- ─────────────────────────────────────────────────────────────────────────
--
-- 1. Trigger powinien być widoczny:
--    SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgname = 'trg_enforce_super_admin_on_role_change';
--    → 1 wiersz, tgenabled='O' (Origin = włączony)
--
-- 2. Polityka 031 powinna być USUNIĘTA:
--    SELECT polname FROM pg_policy
--    WHERE polrelid = 'profiles'::regclass
--      AND polname = 'profiles_super_admin_role_change';
--    → 0 wierszy
--
-- 3. Wersjonowanie zgód:
--    SELECT email, accepted_terms_version, accepted_privacy_version, accepted_at
--    FROM profiles WHERE email LIKE '%@%' LIMIT 5;
--    → wszyscy istniejący userzy powinni mieć "pre-1.0"
--
-- ─────────────────────────────────────────────────────────────────────────

COMMIT;
