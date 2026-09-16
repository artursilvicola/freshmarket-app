// [fix/security-hotfix] Szeregowanie zapisów jednego zasobu (np. wybory sieci
// firmy): szybkie kliknięcia nie wysyłają równoległych żądań, które mogłyby
// dotrzeć do bazy w innej kolejności niż kliknięcia. Zawsze zapisywany jest
// OSTATNI stan; pośrednie stany są pomijane. `flush()` czeka na koniec zapisu
// (np. przed „Potwierdź wybór”).
export function createSerialSaver(saveFn, { onError, onSettled } = {}) {
  let inFlight = null;   // Promise bieżącego zapisu
  let pending = null;    // { payload } — najnowszy stan czekający na zapis
  let lastError = null;

  async function run() {
    while (pending) {
      const { payload } = pending;
      pending = null;
      try {
        await saveFn(payload);
        lastError = null;
      } catch (e) {
        lastError = e;
        pending = null; // po błędzie nie ponawiamy automatycznie starszych stanów
        onError?.(e, payload);
      }
    }
    inFlight = null;
    onSettled?.(lastError);
  }

  return {
    save(payload) {
      pending = { payload };
      if (!inFlight) inFlight = run();
      return inFlight;
    },
    // czeka, aż nic nie będzie w toku; zwraca ostatni błąd albo null
    async flush() {
      while (inFlight) await inFlight;
      return lastError;
    },
    get busy() { return !!inFlight; },
    get lastError() { return lastError; },
  };
}
