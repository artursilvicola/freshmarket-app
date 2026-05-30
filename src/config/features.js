// Per-branch feature flags for the Admin Companies 2.0 redesign.
// Spec: docs/admin/ADMIN_COMPANIES_2_0_PLAN.md
//
// Branch 1 (feat/admin-companies-tabs-and-list) — tabs + visible contact row.
// Toggle to `false` to fall back to the legacy `PageAdminFirmy` render path
// (status filter "all" / "pending" + collapsed/expanded card layout).
//
// Each subsequent Admin Companies 2.0 branch ADDS exactly one flag here:
//   - Branch 2 → ADMIN_COMPANIES_2_0_DRAWER
//   - Branch 3 → ADMIN_COMPANIES_2_0_FILTERS
//   - Branch 4 → ADMIN_COMPANIES_2_0_CHAT
//   - Branch 5 → ADMIN_COMPANIES_2_0_BULK
//
// Per plan §8.7 there is exactly one flag system — do NOT introduce
// alternative names (e.g. *_ENABLED) here or anywhere else in the codebase.

export const ADMIN_COMPANIES_2_0_LIST = true;

// [Admin Companies 2.0 / Branch 2 — feat/admin-companies-detail-drawer]
// Sterownie right-side drawer'em z 5 subtabami (Podgląd / Czat / Pakiet /
// Historia / Notatki) + footer status actions + Prev/Next nav.
//
// Default `false`: branch wprowadza reusable AdminRightDrawer + integrację
// w PageAdminFirmy, ale stary CompanyPreviewModal pozostaje aktywną ścieżką
// dla "Szczegóły". Flip na `true` dopiero po smoke test prod.
//
// UWAGA: gdy `true`, drawer rządzi tylko buttonem "Szczegóły" w nowym
// layoutcie (Branch 1 — ADMIN_COMPANIES_2_0_LIST=true). Stary legacy render
// (gdy ADMIN_COMPANIES_2_0_LIST=false) używa starego CompanyPreviewModal
// niezależnie od tej flagi.
export const ADMIN_COMPANIES_2_0_DRAWER = false;
