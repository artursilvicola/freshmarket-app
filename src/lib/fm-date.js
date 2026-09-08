// [fix/fm-queue-day-scoping] Dzień eventu w strefie Europe/Warsaw — liczony TAK SAMO jak w bazie
// (`is_staff()`: `event_date = (now() AT TIME ZONE 'Europe/Warsaw')::date`). Konto obsługi działa
// wyłącznie w swoim dniu, więc panel obsługi pyta o stanowiska z DZISIEJSZEGO dnia, a nie o
// „najnowszy dzień w bazie” (RPC bez daty bierze max(event_date) = 24.09 — operator dnia
// testowego 21.09 dostałby pustą listę).
export const FM_TZ = "Europe/Warsaw";

export function warsawToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// 2026-09-21 → 21.09.2026 (etykiety w panelu)
export function fmtDatePL(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
}
