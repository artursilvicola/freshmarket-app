// [feat/instructions-split] Rok edycji Fresh Market z istniejącej konfiguracji
// wydarzenia (fm_settings), bez nowych pól i bez zgadywania.
//
// Źródła w kolejności: jawny `edition_year` (gdyby kiedyś powstał), potem rok
// z `event_date` (kolumna istnieje od migracji 001; panel „Dzień wydarzenia"
// czyta ją tak samo). Gdy nic nie ma — 2026, czyli to, co dziś jest wpisane
// na sztywno w etykietach menu. Zmiana daty wydarzenia w ustawieniach FM
// przestawia więc etykiety edycji w menu i tytuły instrukcji bez zmian w kodzie.

export const FM_EDITION_FALLBACK_YEAR = 2026;

export function fmEditionYear(fmSettings) {
  const explicit = Number(fmSettings?.edition_year ?? fmSettings?.editionYear);
  if (Number.isInteger(explicit) && explicit >= 2008 && explicit <= 2100) return explicit;
  const date = String(fmSettings?.event_date ?? fmSettings?.eventDate ?? "");
  const m = date.match(/^(\d{4})-\d{2}-\d{2}/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 2008 && y <= 2100) return y;
  }
  return FM_EDITION_FALLBACK_YEAR;
}

/** Czy konfiguracja wskazuje edycję inną niż domyślna (do komunikatów „do decyzji"). */
export function fmEditionFromConfig(fmSettings) {
  const y = fmEditionYear(fmSettings);
  return { year: y, fromConfig: y !== FM_EDITION_FALLBACK_YEAR || !!(fmSettings?.event_date || fmSettings?.eventDate || fmSettings?.edition_year) };
}
