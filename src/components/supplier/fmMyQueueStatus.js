// [fix/fm-queue-day-scoping] Czysta logika karty „Twoja kolej” u dostawcy (testowalna, bez Reactu).
// Zasada: „PODEJDŹ” tylko dla spotkania faktycznie WYWOŁANEGO (status `called` z rekordu).
// Zaplanowany numer tuż za ostatnio wywołanym widzi „jesteś następny — przygotuj się”, nie „podejdź”.
// Przy dwóch równoległych stanowiskach (Auchan ×2) TERAZ pokazuje numery przy KAŻDYM obsługującym
// stanowisku. [review release 9.09] „Pokazuj trwające spotkanie” (open/closing) to co innego niż
// „wolno wywołać następnego” (tylko open, dzień nie zamknięty): po „Zamknij wszystkie” następny
// dostawca NIE dostaje „przygotuj się”.

// Snapshot publiczny → grupy: { [group_id]: { ...pierwsze stanowisko, stations, anyOpen, anyClosing,
// anyFree, anyPaused, dayClosed } }. `settings.closed_all_at` = „Zamknij wszystkie” dla całego dnia.
export function groupsFromSnapshot(stations, settings = null) {
  const dayClosed = !!settings?.closed_all_at;
  const m = {};
  for (const s of stations || []) {
    const g = (m[s.group_id] ||= { ...s, stations: [], anyOpen: false, anyClosing: false, anyFree: false, anyPaused: false, dayClosed });
    g.stations.push(s);
    g.anyOpen = g.anyOpen || s.mode === "open";          // tylko open = wolno wywołać następnego
    g.anyClosing = g.anyClosing || s.mode === "closing"; // dokańczane ostatnie spotkanie
    g.anyFree = g.anyFree || s.mode === "free_entry";
    g.anyPaused = g.anyPaused || s.mode === "paused";
  }
  return m;
}

// Numery obsługiwane TERAZ w grupie: bieżący numer każdego stanowiska open/closing (rosnąco).
// Gdy żadne nie ma bieżącego numeru — ostatnio wywołany numer grupy (jeśli > 0 i coś jest otwarte).
export function nowNumbers(g) {
  if (!g) return [];
  const nums = (g.stations || [])
    .filter(s => (s.mode === "open" || s.mode === "closing") && Number(s.current_nr) > 0)
    .map(s => Number(s.current_nr))
    .sort((a, b) => a - b);
  if (nums.length) return [...new Set(nums)];
  return g.anyOpen && Number(g.last_called_nr) > 0 ? [Number(g.last_called_nr)] : [];
}

// Klucz statusu do słownika + liczba numerów przed dostawcą (dla `ahead`).
export function meetingStatusKey(m, g) {
  switch (m?.status) {
    case "called": return { key: "your_turn" };
    case "in_progress":
    case "returned_in_progress": return { key: "in_progress" };
    case "done": return { key: "done" };
    case "no_show": return { key: "no_show" };
    case "returned_waiting": return { key: "returned" };
    case "skipped": return { key: "skipped" };
    case "cancelled": return { key: "cancelled" };
    default: break;
  }
  // planned — zapowiedź tylko, gdy grupa faktycznie może wywołać następnego
  if (!g) return { key: "closed" };
  if (g.dayClosed) return { key: "closing" };
  if (g.anyOpen) {
    const ahead = Number(m?.nr || 0) - Number(g.last_called_nr || 0) - 1;
    if (ahead <= 0) return { key: "next_up" };        // następny w kolejce — jeszcze NIE wywołany
    return { key: "ahead", n: ahead };
  }
  if (g.anyClosing) return { key: "closing" };
  if (g.anyFree) return { key: "free" };
  if (g.anyPaused) return { key: "paused" };
  return { key: "closed" };
}
