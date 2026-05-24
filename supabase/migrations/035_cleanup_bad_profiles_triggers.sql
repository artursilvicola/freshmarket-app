-- ============================================================================
-- 035 — usuń błędne triggery podpięte do profiles
-- [B2B Round prod-rollout / supplier-registration hotfix]
--
-- Objaw po naprawie cleanupu Netlify Function:
--   "Nie udało się utworzyć profilu: record \"new\" has no field \"status\""
--
-- Wniosek:
--   UPDATE/UPSERT public.profiles odpala w produkcyjnej bazie trigger, którego
--   funkcja odwołuje się do NEW.status. Tabela profiles nie ma kolumny status.
--   Taki trigger nie pochodzi z obecnego schematu aplikacji i blokuje
--   rejestrację dostawcy.
--
-- Na profiles powinny zostać tylko:
--   • trg_profiles_updated — aktualizacja updated_at
--   • trg_enforce_super_admin_on_role_change — ochrona role/admin_level
--
-- Wszystkie inne triggery na public.profiles usuwamy.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND NOT tgisinternal
      AND tgname NOT IN (
        'trg_profiles_updated',
        'trg_enforce_super_admin_on_role_change'
      )
  LOOP
    RAISE NOTICE 'Dropping unexpected trigger on public.profiles: %', r.tgname;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.profiles', r.tgname);
  END LOOP;
END;
$$;

COMMIT;

-- WALIDACJA po uruchomieniu:
-- SELECT
--   t.tgname,
--   p.proname AS function_name
-- FROM pg_trigger t
-- JOIN pg_proc p ON p.oid = t.tgfoid
-- WHERE t.tgrelid = 'public.profiles'::regclass
--   AND NOT t.tgisinternal
-- ORDER BY t.tgname;
--
-- Oczekiwane:
--   trg_enforce_super_admin_on_role_change | enforce_super_admin_on_role_change
--   trg_profiles_updated                  | set_updated_at
