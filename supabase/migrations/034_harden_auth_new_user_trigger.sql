-- ============================================================================
-- 034 — hardening triggera auth.users -> profiles dla self-registration
-- [B2B Round prod-rollout / supplier-registration hotfix]
--
-- Objaw:
--   POST /.netlify/functions/register-supplier-self
--   -> auth.admin.createUser
--   -> "Database error creating new user"
--
-- Wniosek:
--   Błąd dzieje się podczas triggera AFTER INSERT ON auth.users
--   (handle_new_user), zanim kod dojdzie do Netlify Function upsertu profilu.
--
-- Fix:
--   1. handle_new_user zapisuje wersje zaakceptowanych dokumentów, jeśli
--      przyszły w user_metadata.
--   2. handle_new_user jest defensywny: jeśli profil insert/update z jakiegoś
--      powodu zawiedzie, trigger loguje WARNING i NIE przerywa tworzenia auth
--      usera. Autorytatywne utworzenie profilu robi chwilę później
--      register-supplier-self.js przez service_role.
--
-- Idempotentne.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepted_terms_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_privacy_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz DEFAULT NULL;

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
  IF v_role_text IN ('admin', 'supplier', 'buyer') THEN
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

  INSERT INTO public.profiles (
    id,
    email,
    role,
    accepted_terms_version,
    accepted_privacy_version,
    accepted_at
  )
  VALUES (
    new.id,
    new.email,
    v_role,
    v_terms,
    v_privacy,
    v_accepted_at
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    updated_at = now()
  WHERE public.profiles.email IS DISTINCT FROM EXCLUDED.email;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for auth user % (%): %', new.id, new.email, SQLERRM;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMIT;

-- WALIDACJA:
-- SELECT tgname, tgenabled, pg_get_triggerdef(oid)
-- FROM pg_trigger
-- WHERE tgname = 'on_auth_user_created';
