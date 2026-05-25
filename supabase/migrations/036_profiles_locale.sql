-- ============================================================================
-- 036 — profiles.locale: preferowany język użytkownika
-- [B2B Round prod-rollout / i18n MVP — Krok 2]
--
-- Cel:
--   Każdy user ma zapisany preferowany język UI + maili transakcyjnych.
--   Aplikacja po zalogowaniu czyta to pole przez AuthProvider i wywołuje
--   i18n.changeLanguage(profile.locale).
--
-- Zakres tej migracji:
--   • Dodać kolumnę profiles.locale (text, default 'pl')
--   • Backfill: istniejący userzy → 'pl'
--   • Idempotentne (ADD COLUMN IF NOT EXISTS)
--
-- ŚWIADOMA DECYZJA: brak CHECK constraintu na wartości pl/en.
--   Powód: w przyszłości chcemy dodawać kolejne języki (de, fr, es, ...)
--   bez migracji bazy. Walidacja w aplikacji przez SUPPORTED_LOCALES
--   w src/i18n/locale.js — jeśli locale z DB nie jest w supported list,
--   normalizeLocale() upadnie z powrotem na DEFAULT_LOCALE='pl'.
--
-- RLS:
--   User może edytować WŁASNE pole locale (standardowa polityka na profiles
--   z poprzednich migracji — user może update swojego wiersza z auth.uid()=id).
--   Migracja 033 dodała trigger blokujący zmianę role/admin_level przez
--   non-super-admina — locale tego nie dotyczy.
-- ============================================================================

BEGIN;

-- ── 1. Kolumna locale (text, default 'pl') ────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'pl';

COMMENT ON COLUMN profiles.locale IS
  'Preferowany język użytkownika (UI + maile). Walidowany w aplikacji '
  'przez SUPPORTED_LOCALES w src/i18n/locale.js. Default: pl. '
  'Brak CHECK constraintu — pozwala na dodanie nowych języków bez migracji.';

-- ── 2. Backfill: istniejący userzy ────────────────────────────────────
-- Wszystkim którzy mają NULL (mogą się trafić, jeśli DEFAULT 'pl' nie
-- zadziałał na ALTER w niektórych edge cases) — ustaw 'pl'.
UPDATE profiles
SET locale = 'pl'
WHERE locale IS NULL;

COMMIT;

-- ============================================================================
-- WALIDACJA — uruchom po migracji
-- ============================================================================
--
-- 1. Sprawdź że kolumna istnieje + wszyscy mają locale:
--    SELECT
--      COUNT(*)                          AS total,
--      COUNT(locale)                     AS with_locale,
--      COUNT(*) FILTER (WHERE locale='pl') AS pl,
--      COUNT(*) FILTER (WHERE locale='en') AS en,
--      COUNT(*) FILTER (WHERE locale NOT IN ('pl','en')) AS other
--    FROM profiles;
--
--    Oczekiwane: total = with_locale (zero NULL), pl = total (wszyscy mają pl).
--
-- 2. Sprawdź że default 'pl' działa dla nowych rejestracji:
--    Zarejestruj testowego dostawcę przez /zarejestruj-dostawce (UI),
--    następnie:
--      SELECT email, locale FROM profiles
--      WHERE email = 'twoj-test@example.com';
--    Oczekiwane: locale='pl' (automatycznie z DEFAULT 'pl').
--    Po Kroku 3 (LanguageSwitcher) — można też zarejestrować z aktywnym
--    EN w UI i zweryfikować że locale='en' zostało zapisane do bazy.
-- ============================================================================
