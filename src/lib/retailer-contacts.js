// [fix/security-hotfix] Kontakt awaryjny sieci (gdy sieć nie ma konta kupca).
//
// Od migracji 054 kontakty kupców żyją w tabeli `retailer_contacts` (RLS: tylko
// admin) i przychodzą w `getRetailers()` jako `r.contacts` — u dostawcy/kupca
// PostgREST zwraca null. Kolumny `retailers.buyer_*` są zawsze puste (trigger),
// ale stare wiersze / stary bundle mogą je jeszcze nieść, stąd fallback.
export function retailerContact(r) {
  const raw = Array.isArray(r?.contacts) ? r.contacts[0] : r?.contacts;
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    name: String(c.buyer_name ?? r?.buyer_name ?? ""),
    email: String(c.buyer_email ?? r?.buyer_email ?? ""),
    phone: String(c.buyer_phone ?? r?.buyer_phone ?? ""),
  };
}

export function hasRetailerContact(r) {
  const c = retailerContact(r);
  return Boolean(c.name || c.email || c.phone);
}
