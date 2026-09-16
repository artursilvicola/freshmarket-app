// [fix/profile-impersonation-guard] Ochrona przed zapisem „Mój profil" w trybie
// podglądu cudzego konta (pasek przełączania kont u admina).
//
// Tło: `updateOwnSupplierProfile` świadomie ignoruje przekazany identyfikator
// i zapisuje do profilu z sesji (bo panel podaje company_id, nie id profilu).
// Gdy admin przełączy się na konto dostawcy i wypełni „Mój profil", zapis trafia
// na jego WŁASNE konto — tak 16.09.2026 konto admina zmieniło nazwę na dane
// osoby kontaktowej dostawcy. Ta sama pułapka dotyczy sekcji zmiany hasła:
// hasło zmienia się zawsze zalogowanemu użytkownikowi.

// Czy `account` z panelu to konto zalogowanego użytkownika (a nie podgląd cudzego)?
// supplier: account.id = companies.id  → porównujemy z profiles.company_id
// buyer:    account.retailerId         → porównujemy z profiles.retailer_id
// admin:    account.id = profiles.id   → porównujemy z id zalogowanego
export function isOwnAccount(account, currentUser) {
  if (!account) return false;
  if (!currentUser) return true; // brak danych sesji (testy/demo) — nie blokujemy
  const same = (a, b) => String(a ?? "") === String(b ?? "") && String(a ?? "") !== "";
  if (account.role === "supplier") return same(account.id, currentUser.company_id);
  if (account.role === "buyer") return same(account.retailerId, currentUser.retailer_id);
  return same(account.id, currentUser.id);
}

// Czy zapis „Mój profil" może dotknąć profilu zalogowanego użytkownika?
// argId to identyfikator podany przez UI (dla dostawcy = company_id, dla admina = id profilu).
export function isOwnProfileTarget({ argId, uid, companyId }) {
  const v = String(argId ?? "");
  if (!v) return true; // brak wskazania = zapis do siebie (stare wywołania)
  return v === String(uid ?? "") || (!!companyId && v === String(companyId));
}
