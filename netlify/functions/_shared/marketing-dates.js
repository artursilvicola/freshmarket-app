/**
 * [feat/marketing-activation] Daty dla treści marketingowych.
 *
 * Reguła produktowa mailingu do kupców: PIERWSZY WTOREK miesiąca (ta sama, którą
 * panel dostawcy pokazuje jako „Najbliższe okno wysyłki” — upcomingFirstTuesday
 * w src/legacy/PreconnectFM.jsx). Liczona po dacie kalendarzowej: dziś == pierwszy
 * wtorek → to jeszcze „najbliższy” mailing.
 *
 * Czysty moduł bez zależności — testowalny deterministycznie (`from`).
 */
function firstTuesdayOfMonth(year, month0) {
  const firstDow = new Date(year, month0, 1).getDay(); // 0 = niedziela … 2 = wtorek
  const firstTue = 1 + ((2 - firstDow + 7) % 7);
  return new Date(year, month0, firstTue);
}

export function nextBuyerMailingDate(from = new Date()) {
  const y = from.getFullYear(), m = from.getMonth();
  const today = new Date(y, m, from.getDate());
  const thisMonth = firstTuesdayOfMonth(y, m);
  if (thisMonth >= today) return thisMonth;
  return firstTuesdayOfMonth(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1);
}

const MONTHS_PL = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 2026-12-01 → „1 grudnia 2026” / „1 December 2026” */
export function formatLongDate(d, locale = "pl") {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return locale === "en"
    ? `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`
    : `${d.getDate()} ${MONTHS_PL[d.getMonth()]} ${d.getFullYear()}`;
}

/** 'YYYY-MM-DD' → Date (lokalnie, bez przesunięcia strefy); inne → null */
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
