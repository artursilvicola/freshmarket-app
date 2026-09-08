// [fix/fm-queue-day-scoping] Czysta logika karty „Twoja kolej” u dostawcy (testowalna, bez Reactu).
// Zasada: „PODEJDŹ” tylko dla spotkania faktycznie WYWOŁANEGO (status `called` z rekordu).
// Zaplanowany numer tuż za ostatnio wywołanym widzi „jesteś następny — przygotuj się”, nie „podejdź”.
// Przy dwóch równoległych stanowiskach (Auchan ×2) TERAZ pokazuje numery przy KAŻDYM otwartym
// stanowisku, nie tylko ostatnio wywołany numer grupy.

// Snapshot publiczny → grupy: { [group_id]: { ...pierwsze stanowisko, stations, anyOpen, anyFree, anyPaused } }
export function groupsFromSnapshot(stations) {
  const m = {};
  for (const s of stations || []) {
    const g = (m[s.group_id] ||= { ...s, stations: [], anyOpen: false, anyFree: false, anyPaused: false });
    g.stations.push(s);
    g.anyOpen = g.anyOpen || s.mode === "open" || s.mode === "closing";
    g.anyFree = g.anyFree || s.mode === "free_entry";
    g.anyPaused = g.anyPaused || s.mode === "paused";
  }
  return m;
}

// Numery obsługiwane TERAZ w grupie: bieżący numer każdego otwartego stanowiska (rosnąco).
// Gdy żadne stanowisko nie ma bieżącego numeru — ostatnio wywołany numer grupy (jeśli > 0).
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
  // planned
  if (!g) return { key: "closed" };
  if (g.anyFree && !g.anyOpen) return { key: "free" };
  if (!g.anyOpen) return { key: g.anyPaused ? "paused" : "closed" };
  const ahead = Number(m?.nr || 0) - Number(g.last_called_nr || 0) - 1;
  if (ahead <= 0) return { key: "next_up" };          // następny w kolejce — jeszcze NIE wywołany
  return { key: "ahead", n: ahead };
}
