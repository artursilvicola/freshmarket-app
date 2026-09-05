// [feat/shared-countries] JEDNO ŹRÓDŁO listy krajów dla całej aplikacji:
//   • panel (src/legacy/PreconnectFM.jsx) — pola KRAJ sieci, firmy, filtry,
//   • publiczna rejestracja dostawcy (src/auth/RegisterSupplierPage.jsx).
// Dodanie kraju TUTAJ pojawia się automatycznie WSZĘDZIE (panel + rejestracja).
// DB trzyma kody ISO-3166 alpha-2; etykiety PL/EN są display-only.
import i18n from "../i18n";
import { FLAGS, CNAMES, CNAMES_EN } from "./countries-data";
export { FLAGS, CNAMES, CNAMES_EN };

// Nazwa kraju wg aktualnego języka UI (fallback: kod).
export const getCountryName = (code) => ((i18n.language || "pl").startsWith("en") ? CNAMES_EN : CNAMES)[code] || code || "";

// Lista [code, label] posortowana alfabetycznie wg języka UI — do <select>/dropdown.
export const getSortedCountries = () => {
  const lang = (i18n.language || "pl").startsWith("en") ? "en" : "pl";
  const dict = lang === "en" ? CNAMES_EN : CNAMES;
  return Object.entries(dict).sort((a, b) => a[1].localeCompare(b[1], lang));
};

// Zgodność wstecz — używane przez kod nie-render (np. inicjalizacje stanu).
export const CNAMES_SORTED = Object.entries(CNAMES).sort((a, b) => a[1].localeCompare(b[1], "pl"));
