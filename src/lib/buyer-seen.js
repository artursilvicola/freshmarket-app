// [fix/buyer-entry-seen] Kiedy odczyt propozycji PreConnect liczy się jako
// „kupiec zobaczył" (rozliczenie kredytu + powiadomienie dostawcy).
//
// Zasada (decyzja Artura 13.11.2026): kredyty schodzą, gdy PRAWDZIWY kupiec
// wejdzie na platformę — nie dopiero po otwarciu listy propozycji. Podgląd konta
// kupca przez administratora (pasek przełączania kont) nigdy nie jest odczytem.

const PENDING_STATUSES = ["sent", "opened"];

// Czy bieżąca sesja to kupiec oglądający WŁASNY panel?
// sessionRole = rola zalogowanego użytkownika (nie rola oglądanego konta).
export function canRegisterBuyerSeen({ sessionRole, account, currentUser }) {
  if (sessionRole !== "buyer") return false;
  if (!account || account.role !== "buyer") return false;
  if (!currentUser?.id) return false;
  return String(account.id) === String(currentUser.id);
}

// Propozycje sieci kupca, które czekają na odczyt (wysłane, jeszcze nierozliczone).
// Te same warunki widoczności co lista propozycji kupca: nieaktywna sieć albo
// nieaktywny kupiec nie widzą nic, więc nic nie jest odczytem.
export function pendingBuyerSeenSends({ sends, buyerRetailerId, retailers, buyer }) {
  if (!buyerRetailerId) return [];
  if (buyer?.active === false) return [];
  const retailer = (retailers || []).find((r) => r.id === buyerRetailerId);
  if (retailer && retailer.active === false) return [];
  return (sends || []).filter(
    (s) => s && s.retailerId === buyerRetailerId && PENDING_STATUSES.includes(s.status)
  );
}
