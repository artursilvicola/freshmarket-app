// [fix/security-hotfix] Blokada zapisów wyborów po zamknięciu fazy (migracja 054).
//
// Trigger `fm_inputs_phase_lock` na company_target_retailers / fm_resps rzuca
// `fm_inputs_locked` (SQLSTATE P0001), gdy algo_phase ≠ preferences_open i sesja
// nie jest adminem. PostgREST oddaje to jako { code: "P0001", message:
// "fm_inputs_locked", hint: "…" }. UI ma wtedy cofnąć lokalną zmianę i pokazać
// komunikat, zamiast udawać, że zapis się udał.
export function isFmInputsLockedError(e) {
  if (!e) return false;
  const parts = [e.message, e.hint, e.details, e.error, e.code === "P0001" ? e.message : ""];
  return parts.some(p => typeof p === "string" && p.includes("fm_inputs_locked"));
}
