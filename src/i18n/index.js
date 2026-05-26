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
import plPanel from "./pl/panel.json";
import enCommon from "./en/common.json";
import enAuth from "./en/auth.json";
import enPanel from "./en/panel.json";
import { detectInitialLocale } from "./locale";

const resources = {
  pl: {
    common: plCommon,
    auth: plAuth,
    panel: plPanel,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    panel: enPanel,
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
    // [Krok 4] Wyłączamy fallback PL→EN i EN→PL. Jeśli klucz brakuje
    // w wybranym języku, i18next pokaże surowy klucz (np. 'login.title')
    // zamiast maskować innym językiem. Symetrię pl/en wymuszamy świadomie,
    // a CI guard w końcówce P0 dopilnuje że pliki nie rozjeżdżają się.
    fallbackLng: false,
    // [Krok 8 P1] Dodany namespace "panel" dla PanelTopBar (admin/supplier/buyer).
    // Wnętrza paneli zostaną dodane w Krokach 9-11 (lub osobnym namespace).
    ns: ["common", "auth", "panel"],
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
