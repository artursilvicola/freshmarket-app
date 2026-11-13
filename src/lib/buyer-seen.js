// [fix/buyer-entry-seen] Kiedy odczyt propozycji PreConnect liczy się jako
// „kupiec zobaczył" (rozliczenie kredytu + powiadomienie dostawcy).
//
// Zasada (decyzja Artura 13.11.2026): kredyty schodzą, gdy PRAWDZIWY kupiec
// wejdzie na platformę — nie dopiero po otwarciu listy propozycji. Podgląd konta
// kupca przez administratora (pasek przełączania kont) nigdy nie jest odczytem.

const PENDING_STATUSES = ["sent", "opened"];

// Pole wysyłki bywa na wierzchu obiektu (stan panelu) albo w `data` (wiersz z bazy).
const field = (s, k) => (s?.[k] !== undefined && s?.[k] !== null ? s[k] : s?.data?.[k]);
const isCharged = (s) => Boolean(field(s, "chargeAt") || field(s, "chargeTxId") || field(s, "billingStatus") === "charged");

// [review Codexa 13.11, 2. runda — P1] Propozycja potwierdzona RĘCZNIE przez administratora, którą kupiec
// właśnie ogląda w aplikacji. Jego odczyt trzeba zapisać, bo od niego zależy, czy późniejsze cofnięcie
// potwierdzenia zwróci kredyt. Zgłaszamy WYŁĄCZNIE propozycje już rozliczone tym potwierdzeniem
// (chargeChannel = manual) i bez zapisanego jeszcze odczytu w aplikacji:
//  * odczyt takiej propozycji nie może pobrać kredytu drugi raz (jest już rozliczona),
//  * stare albo nierozliczone `read_manual` NIE są zgłaszane — zapis odczytu nie może po cichu
//    rozszerzyć rozliczeń na historyczne pozycje.
export function isManualAwaitingBuyerRead(s) {
  return !!s && s.status === "read_manual" && field(s, "chargeChannel") === "manual" && isCharged(s) && !field(s, "buyerAppSeenAt");
}

// Czy wejście kupca / lista / szczegół mają zgłosić odczyt tej propozycji.
export function isBuyerSeenPending(s) {
  return !!s && (PENDING_STATUSES.includes(s.status) || isManualAwaitingBuyerRead(s));
}

// Czy propozycja jest dla kupca „nowa” (licznik na pulpicie): tylko nieprzeczytane, bez ręcznie potwierdzonych.
export const isNewForBuyer = (s) => !!s && PENDING_STATUSES.includes(s.status);

// Czy bieżąca sesja to kupiec oglądający WŁASNY panel?
// sessionRole = rola zalogowanego użytkownika (nie rola oglądanego konta).
export function canRegisterBuyerSeen({ sessionRole, account, currentUser }) {
  if (sessionRole !== "buyer") return false;
  if (!account || account.role !== "buyer") return false;
  if (!currentUser?.id) return false;
  return String(account.id) === String(currentUser.id);
}

// [review Codexa 13.11, P2] Zgłoszenia odczytu rozstrzygane PER POZYCJA.
// Serwer odpowiada HTTP 200 także wtedy, gdy rozliczenie konkretnej propozycji się nie udało
// (results: [{ legacy_id, ok: false, status: "error" }]). Zgłoszenie jest „załatwione” tylko dla pozycji
// z ok === true; pozostałe (błąd, brak w odpowiedzi, odpowiedź bez listy) wracają do puli i mogą zostać
// ponowione — najwyżej maxAttempts razy na pozycję w sesji, bez powtarzania udanych rozliczeń.
export function createSeenSubmissionTracker({ maxAttempts = 3 } = {}) {
  const done = new Set();
  const inFlight = new Set();
  const attempts = new Map();
  const key = (id) => String(id);
  return {
    // Pozycje do wysłania teraz: oczekujące, niezałatwione, nie w trakcie, z niewyczerpanym limitem prób.
    take(sends) {
      const out = [];
      for (const s of sends || []) {
        if (!isBuyerSeenPending(s)) continue;
        const k = key(s.id);
        if (done.has(k) || inFlight.has(k)) continue;
        const n = attempts.get(k) || 0;
        if (n >= maxAttempts) continue;
        inFlight.add(k);
        attempts.set(k, n + 1);
        out.push(s);
      }
      return out;
    },
    // Odpowiedź serwera (HTTP 200): załatwione tylko pozycje z ok === true.
    settle(taken, results) {
      const ok = new Set(
        (Array.isArray(results) ? results : [])
          .filter((r) => r && r.ok === true && r.legacy_id !== undefined && r.legacy_id !== null)
          .map((r) => key(r.legacy_id))
      );
      const failed = [];
      for (const s of taken || []) {
        const k = key(s.id);
        inFlight.delete(k);
        if (ok.has(k)) done.add(k); else failed.push(s.id);
      }
      return { failed };
    },
    // Żądanie w ogóle się nie powiodło (brak sesji, błąd sieci, HTTP ≠ 2xx): wszystko wraca do puli.
    release(taken) {
      for (const s of taken || []) inFlight.delete(key(s.id));
    },
    isDone: (id) => done.has(key(id)),
    attemptsOf: (id) => attempts.get(key(id)) || 0,
  };
}

// Propozycje sieci kupca, których odczyt trzeba zgłosić: wysłane i jeszcze nieprzeczytane oraz
// potwierdzone ręcznie, których kupiec jeszcze w aplikacji nie widział (isManualAwaitingBuyerRead).
// Te same warunki widoczności co lista propozycji kupca: nieaktywna sieć albo
// nieaktywny kupiec nie widzą nic, więc nic nie jest odczytem.
export function pendingBuyerSeenSends({ sends, buyerRetailerId, retailers, buyer }) {
  if (!buyerRetailerId) return [];
  if (buyer?.active === false) return [];
  const retailer = (retailers || []).find((r) => r.id === buyerRetailerId);
  if (retailer && retailer.active === false) return [];
  return (sends || []).filter(
    (s) => s && s.retailerId === buyerRetailerId && isBuyerSeenPending(s)
  );
}
