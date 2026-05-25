/**
 * [B2B Round prod-rollout / i18n MVP — Krok 2]
 *
 * Centralna definicja obsługiwanych języków + helpery do walidacji i detekcji.
 *
 * ZASADA KLUCZOWA: lista języków obsługiwanych jest tutaj, w jednym miejscu,
 * NIE w bazie (brak CHECK constraintu na profiles.locale). To pozwala dodać
 * trzeci/czwarty język samym deployem kodu, bez migracji DB.
 *
 * Fallback chain dla wykrywania języka:
 *   1. profiles.locale (po zalogowaniu — najwyższy priorytet)
 *   2. localStorage 'fm_locale' (zapamiętany wybór przed loginem)
 *   3. navigator.language (preferencja przeglądarki)
 *   4. DEFAULT_LOCALE = 'pl' (ostatnia deska ratunku)
 *
 * Po zalogowaniu profile.locale ZAWSZE wygrywa — synchronizujemy
 * localStorage z profilem, żeby kolejne wizyty bez zalogowania
 * trafiały na właściwy język.
 */

// Lista obsługiwanych języków.
// Dodanie nowego = jedna linia tutaj + plik pl/<kod>/*.json.
// Brak zmian w bazie.
export const SUPPORTED_LOCALES = ["pl", "en"];

// Język domyślny gdy żaden z fallbacków nie pasuje.
export const DEFAULT_LOCALE = "pl";

// Klucz localStorage dla zapamiętania wyboru przed loginem
// (po loginie używamy profiles.locale i sync'ujemy localStorage do profilu).
export const LOCALE_STORAGE_KEY = "fm_locale";

/**
 * Sprowadza dowolny input (z DB, localStorage, navigator.language)
 * do jednego z SUPPORTED_LOCALES albo DEFAULT_LOCALE.
 *
 * Obsługuje wariacje:
 *   "PL" → "pl"
 *   "en-US" → "en"
 *   "pl-PL" → "pl"
 *   null / undefined / "" → DEFAULT_LOCALE
 *   "de" (nie obsługiwany jeszcze) → DEFAULT_LOCALE
 *
 * @param {any} input — może być string, null, undefined
 * @returns {string} — gwarantowany element SUPPORTED_LOCALES
 */
export function normalizeLocale(input) {
  if (!input) return DEFAULT_LOCALE;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return DEFAULT_LOCALE;
  // Wyciągnij sam kod języka z "en-US", "pl-PL", "en_GB" itp.
  const lang = raw.split(/[-_]/)[0];
  if (SUPPORTED_LOCALES.includes(lang)) return lang;
  return DEFAULT_LOCALE;
}

/**
 * Wykryj początkowy język dla niezalogowanego usera:
 *   localStorage 'fm_locale' → navigator.language → DEFAULT_LOCALE
 *
 * Wywoływane raz przy inicjalizacji i18n (src/i18n/index.js).
 * Po zalogowaniu AuthProvider nadpisuje to profilowym locale.
 *
 * @returns {string} — gwarantowany element SUPPORTED_LOCALES
 */
export function detectInitialLocale() {
  // 1. LocalStorage — wybór z poprzedniej wizyty (też niezalogowany)
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const fromStorage = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (fromStorage) {
        const normalized = normalizeLocale(fromStorage);
        if (SUPPORTED_LOCALES.includes(normalized)) return normalized;
      }
    }
  } catch (e) {
    // SSR / disabled storage — przejdź dalej
  }

  // 2. Browser language preference (Accept-Language header)
  try {
    if (typeof navigator !== "undefined" && navigator.language) {
      const fromBrowser = normalizeLocale(navigator.language);
      if (SUPPORTED_LOCALES.includes(fromBrowser)) return fromBrowser;
    }
  } catch (e) {
    // edge case
  }

  // 3. Default
  return DEFAULT_LOCALE;
}

/**
 * Zapisz wybór języka do localStorage. Wywoływane:
 *   - po zalogowaniu (sync z profile.locale, żeby po wylogowaniu nadal pamiętać)
 *   - po manualnej zmianie przez LanguageSwitcher (Krok 3)
 *
 * @param {string} locale — będzie znormalizowane do SUPPORTED_LOCALES
 */
export function persistLocale(locale) {
  const normalized = normalizeLocale(locale);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    }
  } catch (e) {
    // ignore
  }
}
