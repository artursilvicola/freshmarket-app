// [fix/retailer-create-with-buyer] Kto liczy się jako kupiec sieci.
//
// Panel admina dokleja sieci bez ŻADNEGO profilu kupca jeden wiersz zastępczy,
// zbudowany z retailer_contacts, oznaczony `active: true`. Dla sieci założonych
// dawno temu ten wiersz niesie prawdziwy kontakt i ma sens. Dla sieci świeżo
// utworzonej, której kupiec nigdy nie powstał, jest pusty — a mimo to liczył się
// jako „1 aktywny kupiec". Panel pokazywał wtedy komplet, a mailing odmawiał
// wysyłki („sieć nie ma aktywnego kupca z e-mailem") i nic tego nie łączyło.
//
// Rozróżnienie jest więc takie: zastępczy wiersz BEZ e-maila nie jest kupcem,
// bo nie ma do kogo wysłać. Zastępczy z e-mailem zostaje — to realny kontakt
// starej sieci i odebranie mu statusu zablokowałoby edycję istniejących sieci.

export function isPlaceholderBuyer(buyer) {
  return Boolean(buyer && buyer.isPlaceholder === true);
}

export function buyerEmail(buyer) {
  return String((buyer && buyer.email) || "").trim();
}

// Czy ten wiersz liczy się jako aktywny kupiec sieci.
export function countsAsActiveBuyer(buyer) {
  if (!buyer) return false;
  if (buyer.active === false) return false;
  if (isPlaceholderBuyer(buyer) && !buyerEmail(buyer)) return false;
  return true;
}

export function activeBuyers(buyers) {
  return (buyers || []).filter(countsAsActiveBuyer);
}

export function countActiveBuyers(buyers) {
  return activeBuyers(buyers).length;
}

// Czy sieć da się zapisać jako aktywna (mailing i tak odmówi bez kupca z e-mailem).
export function retailerHasUsableBuyer(retailer) {
  return countActiveBuyers(retailer && retailer.buyers) > 0;
}

// Utworzenie sieci = sieć + konto kupca. Kolejność jest wymuszona: konto kupca
// potrzebuje istniejącego retailer_id, więc sieć musi powstać pierwsza. Jeśli
// sieć się nie zapisze, konta NIE próbujemy zakładać — inaczej zostałby osierocony
// profil wskazujący na nieistniejącą sieć.
//
// Zwraca { retailerCreated, buyerCreated }. Wołający pokazuje sukces dopiero gdy
// oba są true; przy buyerCreated=false zostawia kartę otwartą do ponowienia i NIE
// tworzy drugiej sieci (ta już istnieje).
export async function createRetailerWithBuyer({ entry, upsertRetailers, saveBuyer }) {
  try {
    await upsertRetailers([entry]);
  } catch (error) {
    return { retailerCreated: false, buyerCreated: false, error };
  }
  const buyerCreated = Boolean(await saveBuyer(entry.id, entry));
  return { retailerCreated: true, buyerCreated };
}
