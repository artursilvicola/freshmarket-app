// [feat/staff-meeting-list] Czyste helpery listy spotkań operatora (/obsluga → „Lista spotkań”).
// Bez Reactu i bez Supabase — testowalne (meetingList.test.js). Zasada: STATUS POCHODZI
// Z REKORDU SPOTKANIA. Niższy numer NIE oznacza „zakończone” — przy dwóch równoległych
// stanowiskach (Auchan) numer 11 może trwać, gdy 12 jest już wywołany.

export const MEETING_FILTERS = ["all", "waiting", "active", "done", "dropped", "absent"];

// Filtry są PRZEGLĄDOWE, nie rozłączne: `returned_in_progress` celowo pojawia się w dwóch
// (powracający właśnie obsługiwany interesuje operatora w obu widokach), więc liczniki nie
// sumują się do „Wszystkie”. „Odbyte” = wyłącznie `done` (review Codexa 8.09: pominięte
// i anulowane NIE są spotkaniami, które się odbyły — mają własny filtr).
const FILTER_STATUSES = {
  waiting: ["planned"],
  active: ["called", "in_progress", "returned_in_progress"],
  done: ["done"],
  dropped: ["skipped", "cancelled"],
  absent: ["no_show", "returned_waiting", "returned_in_progress"],
};

export const MEETING_STATUSES = ["planned", "called", "in_progress", "done", "no_show", "skipped", "cancelled", "returned_waiting", "returned_in_progress"];

export function filterStatuses(filter) {
  return filter === "all" ? null : (FILTER_STATUSES[filter] || null);
}

// Wyszukiwanie odporne na polskie znaki i wielkość liter („zoltek” znajdzie „Żółtek”).
export function normalizeText(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").trim();
}

export function meetingName(m) {
  return m?.companies?.name || m?.company_name || m?.exception_name || "";
}

export function isException(m) {
  return m?.source === "exception" || (!m?.company_id && !!m?.exception_name);
}

// Numer: dopasowanie dokładne lub prefiksowe („1” → 1, 10, 11…); tekst: fragment nazwy firmy.
export function matchesQuery(m, query) {
  const q = normalizeText(query);
  if (!q) return true;
  if (/^\d+$/.test(q)) {
    const nr = String(m?.nr ?? "");
    return nr === q || nr.startsWith(q);
  }
  return normalizeText(meetingName(m)).includes(q);
}

export function filterMeetings(meetings, { filter = "all", query = "" } = {}) {
  const st = filterStatuses(filter);
  return [...(meetings || [])]
    .filter(m => (!st || st.includes(m.status)) && matchesQuery(m, query))
    .sort((a, b) => (a.nr || 0) - (b.nr || 0));
}

export function countByFilter(meetings) {
  const out = {};
  for (const f of MEETING_FILTERS) {
    const st = filterStatuses(f);
    out[f] = (meetings || []).filter(m => !st || st.includes(m.status)).length;
  }
  return out;
}

// Etykieta stanowiska dla spotkania (wspólna kolejka Auchan ×2: „na którym stanowisku”).
// Zwraca null, gdy spotkanie nie ma stanowiska (zaplanowane) lub stanowisko jest nieznane.
export function stationLabelFor(stationId, stations) {
  if (!stationId) return null;
  const s = (stations || []).find(x => (x.id || x.station_id) === stationId);
  if (!s) return null;
  return s.label || s.station_label || String(s.idx ?? s.station_idx ?? "");
}

export function fmtClock(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// [review 8.09] Wiek danych i limit czasu odczytu — wspólne z kartą dostawcy (src/lib/fm-read.js).
export { LIST_STALE_AFTER_MS, LIST_TIMEOUT_MS, isDataStale, withReadTimeout } from "../lib/fm-read.js";
