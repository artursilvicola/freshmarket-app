/**
 * [feat/preconnect-first-tuesday-mailing-logic — Faza 1]
 * Mały, samodzielny test logiki "najbliższy pierwszy wtorek od daty".
 *
 * Mirror helperów z src/legacy/PreconnectFM.jsx:
 *   firstTuesdayOfMonth() + firstTuesdayOnOrAfter()
 * (helpery w pliku nie są eksportowane — kopia poniżej jest 1:1 z nimi).
 *
 * Uruchom: node scripts/test-mailing-first-tuesday.mjs
 * Zielono = wszystkie przypadki OK (exit 0). Czerwono = mismatch (exit 1).
 */

function firstTuesdayOfMonth(year, monthIdx) {
  const first = new Date(year, monthIdx, 1);
  const offset = (2 - first.getDay() + 7) % 7; // 2 = wtorek
  return new Date(year, monthIdx, 1 + offset);
}

function firstTuesdayOnOrAfter(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const ft = firstTuesdayOfMonth(d.getFullYear(), d.getMonth()); ft.setHours(0, 0, 0, 0);
  if (d <= ft) return ft;
  const m = d.getMonth() + 1;
  return firstTuesdayOfMonth(m > 11 ? d.getFullYear() + 1 : d.getFullYear(), m > 11 ? 0 : m);
}

function parseLocalDate(raw) {
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw);
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// sendDate → oczekiwana planowana data mailingu (najbliższy pierwszy wtorek OD sendDate)
const CASES = [
  ["2026-06-01", "2026-06-02"], // przed pierwszym wtorkiem czerwca → ten wtorek
  ["2026-06-02", "2026-06-02"], // dokładnie pierwszy wtorek → ten sam dzień
  ["2026-06-07", "2026-07-07"], // po pierwszym wtorku czerwca → pierwszy wtorek lipca
  ["2026-07-08", "2026-08-04"], // po pierwszym wtorku lipca → pierwszy wtorek sierpnia
  // dodatkowe brzegowe:
  ["2026-12-09", "2027-01-05"], // przełom roku: po pierwszym wtorku grudnia → styczeń 2027
  ["2026-01-01", "2026-01-06"], // 1 stycznia (czwartek) → pierwszy wtorek 6 stycznia
];

let failed = 0;
for (const [input, expected] of CASES) {
  const got = iso(firstTuesdayOnOrAfter(parseLocalDate(input)));
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${input} → ${got}${ok ? "" : `  (oczekiwano ${expected})`}`);
}

if (failed) {
  console.error(`\n${failed} przypadek(ów) nie przeszło.`);
  process.exit(1);
}
console.log(`\nWszystkie ${CASES.length} przypadki OK.`);
