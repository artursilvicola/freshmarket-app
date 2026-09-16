// [fix/security-hotfix] Rejestr „niedokończonej pracy" w otwartej karcie: zapisy
// w toku / w kolejce (wybory sieci) i niezapisane formularze. Pasek „nowa wersja —
// odśwież" pyta ten rejestr, zanim przeładuje stronę (review Codexa c3c1e66 P2/3:
// przeładowanie w trakcie kolejki gubiło niewysłane kliknięcie).
const checks = new Set();

// fn() → true, gdy komponent ma coś niezapisanego. Zwraca funkcję wyrejestrowania.
export function registerPendingWork(fn) {
  if (typeof fn !== "function") return () => {};
  checks.add(fn);
  return () => { checks.delete(fn); };
}

export function hasPendingWork() {
  for (const fn of checks) {
    try { if (fn()) return true; } catch { /* zepsuty check nie blokuje odświeżenia */ }
  }
  return false;
}

// Czeka (do timeoutMs), aż nic nie będzie w toku. Zwraca true = bezczynnie, false = nadal coś trwa.
export async function waitForIdle(timeoutMs = 15000, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (hasPendingWork()) {
    if (Date.now() >= deadline) return false;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return true;
}

// tylko do testów
export function _resetPendingWork() { checks.clear(); }
