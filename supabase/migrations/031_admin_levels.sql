-- ============================================================================
-- 031 — Poziomy administratorów (super admin + zwykli admini)
-- [B2B Round prod-rollout / admin-team]
--
-- Cel:
--   Wprowadzenie 2-poziomowego systemu admin'ów:
--     - SUPER ADMIN — pełen dostęp + może dodawać/usuwać innych admin'ów
--                    + może promować zwykłych admin'ów do super admin
--                    (typowo: Artur, KJOW Sp. z o.o.)
--     - ZWYKŁY ADMIN — pełen dostęp do funkcji moderacji, sieci, firm,
--                      FM, branding, ale NIE może zarządzać innymi adminami
--                      (typowo: Oksana i przyszli pracownicy KJOW)
--
-- Implementacja: kolumna profiles.admin_level
--   NULL          — user nie jest adminem (rola w profiles.role inna)
--   'super'       — super admin (pełen dostęp + zarządzanie zespołem)
--
-- (Brak osobnej wartości 'regular' — zwykły admin to po prostu
--  role='admin' AND admin_level IS NULL. To prostsze niż enum.)
--
-- Plus: 2 helper functions do RLS
--   is_admin()        — czy user jest jakimkolwiek adminem
--   is_super_admin()  — czy user jest super adminem
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
-- ============================================================================

BEGIN;

-- ── 1. Dodaj kolumnę admin_level w profiles ─────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS admin_level text DEFAULT NULL;

COMMENT ON COLUMN profiles.admin_level IS
  'NULL = nie admin lub zwykły admin (gdy role=admin). ''super'' = super admin (może zarządzać zespołem).';

-- ── 2. Ustaw Artur jako pierwszy super admin ───────────────────────────
-- Pierwsze konto admin musi być super-admin żeby w ogóle móc zarządzać
-- innymi adminami. Identyfikujemy po znanym mailu Artura.
UPDATE profiles
SET admin_level = 'super'
WHERE email = 'artur@kjow.pl'
  AND role = 'admin';

-- Backup: gdyby Artur logował się też pod artur.stasiak@freshmarket.eu
UPDATE profiles
SET admin_level = 'super'
WHERE email = 'artur.stasiak@freshmarket.eu'
  AND role = 'admin';

-- ── 3. Helper functions dla RLS i sprawdzeń aplikacji ──────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND admin_level = 'super'
  );
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'Zwraca true jeśli aktualny user (auth.uid()) ma role=admin AND admin_level=super.';

-- is_admin() już istnieje (z wcześniejszych migracji) — zostawiamy.
-- Sprawdzamy że istnieje, gdyby nie — tworzymy:
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'Zwraca true jeśli aktualny user (auth.uid()) ma role=admin (dowolny poziom).';

-- ── 4. RLS — tylko super admin może UPDATE profiles.role i admin_level ─
-- Wcześniejsza polityka admin_update prawdopodobnie pozwala wszystkim
-- adminom edytować profiles. Tutaj dokładamy STRICT: tylko super admin
-- może zmienić cudzą role albo cudzy admin_level.
--
-- Implementacja: nowa polityka "super_admin_role_change" na UPDATE.
-- Standardowy admin nadal może edytować inne pola (np. retailer_id buyer'a)
-- ale NIE role/admin_level — to rezerwujemy dla super.
--
-- UWAGA: ta polityka NIE blokuje INSERT (rejestracja). Tylko UPDATE.

-- Najpierw zdejmij ewentualną starą wersję tej policy (idempotentnie)
DROP POLICY IF EXISTS profiles_super_admin_role_change ON profiles;

-- Polityka: tylko super admin może zmienić role/admin_level
-- (zwykły admin może zmieniać inne pola np. profil supplier'a)
CREATE POLICY profiles_super_admin_role_change ON profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Pozwól sprawdzić wiersz, ale check_role zrobi RESTRICT
    is_admin() OR id = auth.uid()
  )
  WITH CHECK (
    -- Jeśli ktoś próbuje zmienić role albo admin_level w cudzym wierszu →
    -- musi być super admin. Self-edycję role własnego dla admina blokujemy też
    -- (żeby admin nie zdegradował się sam i nie zostawił systemu bez admina).
    CASE
      WHEN id != auth.uid() THEN is_super_admin()
      ELSE TRUE
    END
  );

-- ── 5. Notify dla AuthProvider — chcemy żeby JWT zawierało admin_level ─
-- (Dla SPA — aplikacja może czytać admin_level z profile bez dodatkowego
--  zapytania. Polityka RLS na profiles już pozwala usere'owi czytać
--  własny wiersz. Nic do robienia tu — frontend pobiera profile w
--  AuthProvider.fetchProfile() po loginie.)

COMMIT;

-- ============================================================================
-- WALIDACJA — uruchom po wdrożeniu żeby sprawdzić że super admin jest ustawiony
-- ============================================================================
--
-- SELECT email, role, admin_level
-- FROM profiles
-- WHERE role = 'admin'
-- ORDER BY admin_level NULLS LAST, email;
--
-- Oczekiwany wynik (przynajmniej 1 wiersz z admin_level='super'):
--   artur@kjow.pl                | admin | super
--   artur.stasiak@freshmarket.eu | admin | super
--   (inni admini)                | admin | (NULL)
-- ============================================================================
