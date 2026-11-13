// [fix/buyer-entry-seen] Kto może zarejestrować odczyt propozycji PreConnect
// z aplikacji (rozliczenie kredytu + powiadomienie dostawcy).
//
// Tylko kupiec przypisany do sieci, i tylko dla wysyłek swojej sieci.
// Administrator oglądający panel kupca (pasek przełączania kont) NIE jest
// czytającym: wcześniej jego wejście rozliczało kredyty dostawcom bez udziału
// kupca. Kupiec bez przypisanej sieci też nic nie odczytuje — brak sieci
// oznaczał dotąd brak ograniczenia do własnych wysyłek.
export function buyerReadScope(profile) {
  if (profile?.role !== "buyer") {
    return { counts: false, reason: profile?.role === "admin" ? "admin_preview" : "not_buyer" };
  }
  if (profile.retailer_id === null || profile.retailer_id === undefined || profile.retailer_id === "") {
    return { counts: false, reason: "buyer_without_retailer" };
  }
  return { counts: true, allowedRetailerId: profile.retailer_id };
}
