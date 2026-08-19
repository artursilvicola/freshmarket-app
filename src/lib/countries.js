// [feat/shared-countries] JEDNO ŹRÓDŁO listy krajów dla całej aplikacji:
//   • panel (src/legacy/PreconnectFM.jsx) — pola KRAJ sieci, firmy, filtry,
//   • publiczna rejestracja dostawcy (src/auth/RegisterSupplierPage.jsx).
// Dodanie kraju TUTAJ pojawia się automatycznie WSZĘDZIE (panel + rejestracja).
// DB trzyma kody ISO-3166 alpha-2; etykiety PL/EN są display-only.
import i18n from "../i18n";

export const FLAGS = { AT:"🇦🇹",BA:"🇧🇦",BY:"🇧🇾",BE:"🇧🇪",BR:"🇧🇷",BG:"🇧🇬",CL:"🇨🇱",CO:"🇨🇴",CR:"🇨🇷",HR:"🇭🇷",CY:"🇨🇾",CZ:"🇨🇿",DE:"🇩🇪",DK:"🇩🇰",EC:"🇪🇨",EG:"🇪🇬",EE:"🇪🇪",FI:"🇫🇮",FR:"🇫🇷",GR:"🇬🇷",ES:"🇪🇸",NL:"🇳🇱",IE:"🇮🇪",IN:"🇮🇳",IT:"🇮🇹",KE:"🇰🇪",LV:"🇱🇻",LT:"🇱🇹",LU:"🇱🇺",MD:"🇲🇩",MT:"🇲🇹",MA:"🇲🇦",NO:"🇳🇴",PE:"🇵🇪",PL:"🇵🇱",PT:"🇵🇹",RO:"🇷🇴",SK:"🇸🇰",SI:"🇸🇮",ZA:"🇿🇦",SE:"🇸🇪",TR:"🇹🇷",UA:"🇺🇦",HU:"🇭🇺" };

export const CNAMES = { AT:"Austria",BA:"Bośnia i Hercegowina",BY:"Białoruś",BE:"Belgia",BR:"Brazylia",BG:"Bułgaria",CL:"Chile",CO:"Kolumbia",CR:"Kostaryka",HR:"Chorwacja",CY:"Cypr",CZ:"Czechy",DE:"Niemcy",DK:"Dania",EC:"Ekwador",EG:"Egipt",EE:"Estonia",FI:"Finlandia",FR:"Francja",GR:"Grecja",ES:"Hiszpania",NL:"Holandia",IE:"Irlandia",IN:"Indie",IT:"Włochy",KE:"Kenia",LV:"Łotwa",LT:"Litwa",LU:"Luksemburg",MD:"Mołdawia",MT:"Malta",MA:"Maroko",NO:"Norwegia",PE:"Peru",PL:"Polska",PT:"Portugalia",RO:"Rumunia",SK:"Słowacja",SI:"Słowenia",ZA:"Republika Południowej Afryki",SE:"Szwecja",TR:"Turcja",UA:"Ukraina",HU:"Węgry" };

export const CNAMES_EN = { AT:"Austria",BA:"Bosnia and Herzegovina",BY:"Belarus",BE:"Belgium",BR:"Brazil",BG:"Bulgaria",CL:"Chile",CO:"Colombia",CR:"Costa Rica",HR:"Croatia",CY:"Cyprus",CZ:"Czechia",DE:"Germany",DK:"Denmark",EC:"Ecuador",EG:"Egypt",EE:"Estonia",FI:"Finland",FR:"France",GR:"Greece",ES:"Spain",NL:"Netherlands",IE:"Ireland",IN:"India",IT:"Italy",KE:"Kenya",LV:"Latvia",LT:"Lithuania",LU:"Luxembourg",MD:"Moldova",MT:"Malta",MA:"Morocco",NO:"Norway",PE:"Peru",PL:"Poland",PT:"Portugal",RO:"Romania",SK:"Slovakia",SI:"Slovenia",ZA:"South Africa",SE:"Sweden",TR:"Turkey",UA:"Ukraine",HU:"Hungary" };

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
