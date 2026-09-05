// [feat/fm-plan-export] Teksty kart spotkań B2B — jeden język na kartę.
// Reguła (Artur, 5.09.2026): kraj firmy = PL → polski; każdy inny lub brak → angielski.
// Moduł jest czysty (bez react-i18next), bo używa go też funkcja Netlify i generator CLI.
import { CNAMES, CNAMES_EN } from "../countries-data.js";

export const EVENT = {
  name: "FRESH MARKET 2026",
  date_pl: "24 września 2026",
  date_en: "24 September 2026",
  venue_pl: "MCC Mazurkas, Ożarów Mazowiecki",
  venue_en: "MCC Mazurkas, Ożarów Mazowiecki (Warsaw)",
  registration: "8:00–9:00",
  app: "b2b.freshmarket.eu",
  support: "support@freshmarket.eu",
  version_date: "22.09.2026",
  contacts: {
    pl: { name: "Oksana Kozłowska", email: "oksana@freshmarket.eu", phone: "tel. +48 509 086 949" },
    en: { name: "Jagoda Knadel", email: "jagoda.knadel@freshmarket.eu", phone: "tel./WhatsApp +48 603 811 818" },
  },
};

export function langFor(countryCode) {
  return String(countryCode || "").trim().toUpperCase() === "PL" ? "pl" : "en";
}

export function countryName(code, lang) {
  const c = String(code || "").toUpperCase();
  return (lang === "pl" ? CNAMES : CNAMES_EN)[c] || c;
}

const CAT_EN = { owoce: "fruit", warzywa: "vegetables", kwiaty: "flowers", zioła: "herbs", ziola: "herbs", inne: "other" };
export function categoryLabel(cat, lang) {
  const k = String(cat || "").toLowerCase();
  return lang === "pl" ? k : (CAT_EN[k] || k);
}

function plMeetings(n) {
  if (n === 1) return "spotkanie";
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "spotkania";
  return "spotkań";
}

export const T = {
  pl: {
    title: "Plan spotkań B2B", title_chain: "Kolejka spotkań", cont: "— cd.",
    page: (p, n) => `Strona ${p} z ${n}`, meetingsWord: plMeetings,
    supplier: "Dostawca", chain: "Sieć handlowa", pkg: "Pakiet", gate: "Wejście",
    th_nr: "Nr spotkania", th_chain: "Sieć handlowa", th_cat: "Kategorie", th_gate: "Wejście",
    th_sup: "Dostawca", th_person: "Osoba · telefon",
    contd: (p) => `Ciąg dalszy na stronie ${p} →`, card: "Karta", pagew: "strona",
    event_meta: `${EVENT.date_pl} · ${EVENT.venue_pl} · Rejestracja ${EVENT.registration}`,
    how_h: "Jak dotrzeć na spotkanie z siecią?",
    how_intro: "Spotkania odbywają się w wydzielonej strefie spotkań. Prowadzą do niej dwa oznaczone wejścia: GATE 1 i GATE 2. Przy każdym wejściu znajdziesz logotypy sieci obsługiwanych przez daną bramkę.",
    how_steps: [
      "Sprawdź w tabeli, z którą siecią masz spotkanie i jaki jest jego numer.",
      "Idź do wejścia z kolumny „Wejście” — logo sieci będzie przy Gate 1 albo Gate 2.",
      `Śledź numer swojego spotkania: numery aktualnie obsługiwane widać w aplikacji ${EVENT.app} i na dużym ekranie w sali spotkań.`,
    ],
    how_time_h: "Czas i kolejność",
    how_time: "Spotkanie trwa ok. 10 minut — bywa nieco krótsze lub dłuższe, dlatego obowiązuje kolejność numerów, nie godziny.",
    miss_h: "Przegapiłeś numer?",
    miss: "Podejdź do obsługi przy właściwym Gate. Wejdziesz po zakończeniu bieżącego i kolejnego spotkania — zaprowadzi Cię nasza obsługa.",
    info_h: "Informacje o dniu spotkań",
    info: [
      "Spotkania zaczynają się o 10:00. Można zacząć już od 9:00 — wystarczy powiedzieć naszej obsłudze.",
      "W recepcji nasza obsługa zaprowadzi Państwa na stanowisko do spotkań.",
      "Rozmowa trwa ok. 10 minut; kolejni dostawcy są wprowadzani według numerów.",
      "W trakcie spotkań obsługa kelnerska zapewnia napoje i przekąski.",
      "Lunch: 13:00–14:00.",
      "Koniec rozmów B2B o 17:00 — po nich zapraszamy na uroczystą kolację do części hotelowej, sala Bolero.",
    ],
    info_team: "W razie czego nasz zespół jest do Państwa dyspozycji — kontakty poniżej.",
    help: "Pomoc w dniu wydarzenia", live: "Aktualny numer spotkania na żywo", sponsors: "Sponsorzy Fresh Market 2026",
    version: `Fresh Market 2026 · Spotkania B2B · wersja z ${EVENT.version_date}`,
    email_subject: "Fresh Market 2026 — Twój plan spotkań B2B (24 września)",
    email_subject_chain: "Fresh Market 2026 — kolejka spotkań B2B dla sieci (24 września)",
    simulation: "SYMULACJA — dane robocze, nie plan finalny",
  },
  en: {
    title: "B2B meeting schedule", title_chain: "Meeting queue", cont: "— continued",
    page: (p, n) => `Page ${p} of ${n}`, meetingsWord: (n) => (n === 1 ? "meeting" : "meetings"),
    supplier: "Supplier", chain: "Retail chain", pkg: "Package", gate: "Gate",
    th_nr: "Meeting no.", th_chain: "Retail chain", th_cat: "Categories", th_gate: "Gate",
    th_sup: "Supplier", th_person: "Contact · phone",
    contd: (p) => `Continued on page ${p} →`, card: "Card", pagew: "page",
    event_meta: `${EVENT.date_en} · ${EVENT.venue_en} · Registration ${EVENT.registration}`,
    how_h: "How to get to your meeting",
    how_intro: "Meetings take place in a dedicated meeting zone with two marked entrances: GATE 1 and GATE 2. At each entrance you will find the logos of the retail chains served by that gate.",
    how_steps: [
      "Check the table for the chain you are meeting and your meeting number.",
      "Go to the entrance shown in the “Gate” column — the chain’s logo is displayed at Gate 1 or Gate 2.",
      `Follow your meeting number: the numbers currently being served are shown in the ${EVENT.app} app and on the big screen in the meeting hall.`,
    ],
    how_time_h: "Timing and order",
    how_time: "A meeting takes about 10 minutes — sometimes a little less or more, which is why the order of numbers applies, not fixed times.",
    miss_h: "Missed your number?",
    miss: "Go to the staff at the right gate. You will enter after the current and the next meeting have finished — our staff will walk you in.",
    info_h: "About the meeting day",
    info: [
      "Meetings start at 10:00. You can start as early as 9:00 — just let our staff know.",
      "At the reception our staff will walk you to your meeting station.",
      "Each meeting takes about 10 minutes; suppliers are brought in by meeting number.",
      "Waiter service provides drinks and snacks during the meetings.",
      "Lunch: 13:00–14:00.",
      "B2B meetings end at 17:00 — afterwards we invite you to the gala dinner in the hotel wing, Bolero hall.",
    ],
    info_team: "Should you need anything, our team is at your disposal — contacts below.",
    help: "Help on the day", live: "Live meeting number", sponsors: "Fresh Market 2026 sponsors",
    version: `Fresh Market 2026 · B2B meetings · version of ${EVENT.version_date}`,
    email_subject: "Fresh Market 2026 — your B2B meeting schedule (24 September)",
    email_subject_chain: "Fresh Market 2026 — B2B meeting queue for your chain (24 September)",
    simulation: "SIMULATION — working data, not the final plan",
  },
};

// Tytuł/opis nazwy pliku karty (do nazw plików w ZIP i załączników).
export function cardFileLabel(kind, lang) {
  return kind === "chain" ? (lang === "pl" ? "kolejka-spotkan" : "meeting-queue") : (lang === "pl" ? "plan-spotkan" : "meeting-schedule");
}

// Kontakty w stopce — dwie linie, język karty pierwszy.
export function contactsLines(lang) {
  const other = lang === "pl" ? "en" : "pl";
  const fmt = (c, tag) => `${c.name} (${tag}) · ${c.email} · ${c.phone}`;
  return [fmt(EVENT.contacts[lang], lang.toUpperCase()), fmt(EVENT.contacts[other], other.toUpperCase())];
}
export const contactsLine = (lang) => contactsLines(lang).join("   ·   ");
