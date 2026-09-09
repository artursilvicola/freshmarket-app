// Wspólne zabezpieczenia odczytów „na żywo” (panel obsługi, karta „Twoja kolej” dostawcy).
// Odczyt musi mieć limit czasu (wiszące API przy działającym Wi-Fi = błąd, nie „aktualne dane”),
// a ostatnie udane odświeżenie musi się starzeć samo. Spóźnione wyniki odrzuca sekwencjonowanie
// po stronie komponentu — tu tylko wyścig z limitem czasu i ocena wieku.
export const LIST_STALE_AFTER_MS = 25_000;   // ~2,5 × cykl pollingu (10 s)
export const LIST_TIMEOUT_MS = 10_000;       // jak RPC_TIMEOUT_MS

export function isDataStale(at, now = Date.now(), maxAgeMs = LIST_STALE_AFTER_MS) {
  if (at == null) return false;
  const ts = at instanceof Date ? at.getTime() : Number(at);
  if (!Number.isFinite(ts)) return false;
  return now - ts > maxAgeMs;
}

export function withReadTimeout(promise, ms = LIST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error("list read timeout");
      e.network = true; e.timeout = true;
      reject(e);
    }, ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}
