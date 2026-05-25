/**
 * [B2B Round prod-rollout / i18n MVP — Krok 1: fundament]
 *
 * Inicjalizacja react-i18next dla aplikacji Fresh Market B2B.
 *
 * Strategia językowa (zatwierdzona w docs/i18n/TERMINOLOGY_PL_EN.md v1.1):
 *   - Wersje PL i EN są RÓWNORZĘDNE (obie oficjalne)
 *   - Domyślny język: pl (do czasu wdrożenia detekcji/persistence)
 *   - Fallback: pl (jeśli klucz brakuje w en, pokazujemy PL — nie key)
 *
 * UWAGA: Krok 1 to TYLKO fundament — żaden komponent jeszcze nie używa
 * useTranslation(). Aplikacja działa identycznie jak dotąd (hardcoded PL).
 * Następne kroki dodadzą:
 *   - profiles.locale (Krok 2)
 *   - LanguageDetector + LocalStorage persist (Krok 3)
 *   - LanguageSwitcher w PanelTopBar (Krok 4)
 *   - useTranslation() w auth pages (Krok 5)
 *
 * Pliki tłumaczeń: src/i18n/{pl,en}/{common,auth}.json
 * Po każdym kroku trzeba pamiętać: pl/*.json i en/*.json muszą mieć
 * identyczne klucze (CI guard będzie sprawdzać w P0 końcówce).
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Static imports — w MVP wystarczy. Jeśli bundle urośnie, później
// można przejść na dynamic imports + i18next-http-backend.
import plCommon from "./pl/common.json";
import plAuth from "./pl/auth.json";
import enCommon from "./en/common.json";
import enAuth from "./en/auth.json";
import { detectInitialLocale, DEFAULT_LOCALE } from "./locale";

const resources = {
  pl: {
    common: plCommon,
    auth: plAuth,
  },
  en: {
    common: enCommon,
    auth: enAuth,
  },
};

// [Krok 2] Wykrywanie początkowego języka dla niezalogowanego usera:
// localStorage 'fm_locale' → navigator.language → DEFAULT_LOCALE ('pl').
// Po zalogowaniu AuthProvider nadpisze przez i18n.changeLanguage(profile.locale).
const initialLocale = detectInitialLocale();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLocale,         // Krok 2: detect z localStorage / navigator.
    fallbackLng: DEFAULT_LOCALE, // Brakujący klucz w en → pokazujemy pl (nie key).
    ns: ["common", "auth"],     // Aktywne namespace'y w P0. Reszta w P1/P2.
    defaultNS: "common",
    interpolation: {
      escapeValue: false,       // React sam escapuje
    },
    react: {
      useSuspense: false,       // Nie używamy Suspense — synchroniczne ładowanie
    },
    // Debug w dev, off w prod (Vite ustawia import.meta.env.DEV)
    debug: typeof import.meta !== "undefined" && import.meta.env?.DEV === true,
  });

export default i18n;
