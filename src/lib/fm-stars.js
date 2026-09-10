// [fix/fm-stars-limit-ux] Jedno źródło prawdy dla limitów sieci głównych (⭐)
// w panelu dostawcy i widokach admina. Dwie osobne liczby:
//   • FM_STARS_MIN — minimum ⭐, od którego dostawca może potwierdzić wybór (5);
//   • fmStarsMax(company) — limit ⭐ = FM_MAX_M × liczba pakietów Business (5/10/…/25).
// Zapis wyborów, algorytm (supplierCapacity w fm-algo.js) i dane firmy pozostają
// bez zmian — moduł tylko liczy i nazywa stan wyboru dla interfejsu.
import { FM_MAX_M } from "./fm-algo.js";

export const FM_STARS_MIN = 5;
export const FM_PACKAGES_MAX = 5;

// Liczba pakietów Business firmy (1–5), tak samo jak w db.js i fm-plan/model.js.
export function fmPackagesOf(company) {
  return Math.max(1, Math.min(FM_PACKAGES_MAX, Number(company?.fm_b2b_packages) || 1));
}

// Limit sieci głównych (⭐) z wykupionych pakietów.
export function fmStarsMax(company) {
  return FM_MAX_M * fmPackagesOf(company);
}

// Stan wyboru dostawcy:
//   "pending"     — poniżej minimum, potwierdzenie zablokowane;
//   "min_reached" — minimum osiągnięte, ale w puli są jeszcze wolne ⭐;
//   "full"        — cała pula wykorzystana.
export function fmStarsState(stars, max) {
  const n = Number(stars) || 0;
  const limit = Math.max(FM_STARS_MIN, Number(max) || FM_STARS_MIN);
  if (n < FM_STARS_MIN) return "pending";
  return n >= limit ? "full" : "min_reached";
}

// Firma zalogowanego dostawcy: najpierw dokładny identyfikator konta (UUID
// firmy z profilu), dopiero potem klucze legacy. Dzięki temu dwa rekordy
// o podobnej nazwie nie mogą się pomylić, gdy profil ma poprawne company_id.
export function findSupplierCompany(companies, { accountId, fmId, legacySupplierId } = {}) {
  const list = Array.isArray(companies) ? companies : [];
  if (accountId) {
    const exact = list.find(c => c.id === accountId);
    if (exact) return exact;
  }
  if (fmId) {
    const byFm = list.find(c => c.fmId === fmId || c.legacy_fm_id === fmId || c.id === fmId);
    if (byFm) return byFm;
  }
  if (legacySupplierId) {
    const byLegacy = list.find(c => c.legacy_supplier_id === legacySupplierId);
    if (byLegacy) return byLegacy;
  }
  return null;
}
