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
// Sterowanie right-side drawer'em z 5 subtabami (Podgląd / Czat / Pakiet /
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

// [Admin Companies 2.0 / Branch 3 — feat/admin-companies-contact-actions]
// Pole wyszukiwania firm + pasek multi-filtrów (Kraj / Pakiet / Flagi dostępu /
// AI status) nad listą firm w nowym tab-based renderze (ADMIN_COMPANIES_2_0_LIST).
//
// Default `false`: gdy wyłączone, lista renderuje się dokładnie jak dziś —
// 5 tabów po statusie, bez paska search/filtrów. Flip na `true` dopiero po
// smoke test prod (ten sam wzorzec co ADMIN_COMPANIES_2_0_DRAWER).
//
// Zakres Branch 3 to TYLKO szukanie + filtrowanie. Quick contact actions
// (copy email/phone, mailto/tel) już istnieją z Branch 1 i są niezależne od
// tej flagi. Wejście w wątek czatu z firmą to osobny Branch 4.
export const ADMIN_COMPANIES_2_0_FILTERS = false;

// [Admin Pipeline 2.0 / Branch 1 — feat/admin-pipeline-table-shell]
// Spec: docs/admin/ADMIN_PIPELINE_2_0_PLAN.md (Część II — Table plan).
// Zastępuje kolorowe karty w PageAdminPipeline jedną operacyjną TABELĄ
// odporną na setki rekordów: indeksacja danych przez Map (offersById /
// retailersById / companiesByLegacyKey / plansById → O(1) lookup zamiast N²),
// paginacja klient-side 50/100, search (sieć / dostawca / produkt), filtry
// (status panelu / status e-maila / odczyt / rozliczenie / sieć / dostawca /
// data) oraz CSV export aktualnego widoku.
//
// Default `false`: gdy wyłączone, PageAdminPipeline renderuje stary widok
// kart (2 taby: Moderacja / Tracking) bez zmian. Flip na `true` dopiero po
// smoke test prod.
//
// UWAGA zakres Branch 1 = TYLKO widok (tabela + szukanie/filtry/paginacja/CSV).
// Akcje (moderacja, koszyk mailingu, wysyłka, rozliczenia) NIE są w tym
// branchu — żyją dalej w starym widoku (fallback) i wejdą w kolejnych
// branchach Pipeline (drawer szczegółów = Branch 2 itd.). Dlatego flagi NIE
// wolno flipować na `true` zanim akcje nie trafią do tabeli/drawera.
export const ADMIN_PIPELINE_2_0_TABLE = true;

// [Admin Pipeline 2.0 / Branch — feat/admin-pipeline-mailing-basket]
// Spec: docs/admin/ADMIN_PIPELINE_2_0_PLAN.md (Część II — koszyk wariant A JSONB).
// Koszyk mailingu: admin wybiera (checkbox w tabeli Pipeline) które propozycje
// — już widoczne w panelu kupca, ale jeszcze bez wysłanego e-maila — trafią do
// miesięcznego e-maila danej sieci. Rozdziela DWA stany: "w panelu kupca"
// (status legacy_sends) vs "w koszyku e-mail" (s.inEmailBasket, marker
// administracyjny). Pokazuje datę następnej wysyłki (drugi wtorek miesiąca),
// grupy per sieć i ręczny przycisk "Wyślij e-mail do tej sieci".
//
// Bez migracji: marker trzymany na obiekcie sendu (top-level inEmailBasket),
// który round-trippuje przez data JSONB (bulkUpsertLegacySends zapisuje cały
// send jako data). Wysyłka = ręczna (admin klika), zero auto-wysyłki/cron.
//
// Default `false`: gdy wyłączone, tabela Pipeline nie pokazuje checkboxów,
// chipa koszyka, paska daty ani grup per sieć — działa jak w table-shell/polish.
// Flip na `true` dopiero po review + smoke test prod.
export const ADMIN_PIPELINE_2_0_MAILING_BASKET = true;

// [Kredyty PreConnect / Etap 2 — feat/preconnect-credits-ui-copy]
// Spec: docs/billing/PRECONNECT_CREDITS_PLAN.md.
// Prezentacja w panelu DOSTAWCY: zamiast operacyjnego "saldo EUR / portfel"
// główną jednostką są "Kredyty PreConnect" (1 kredyt = 1 wysyłka do 1 sieci).
// Czyste display/copy — pokazuje qty_remaining (pkgMax - pkgUsed) zamiast
// wallet.balance, zamienia EUR→kredyty w Finanse/Wysyłki/Dashboard. EUR zostaje
// TYLKO przy zakupie pakietu / PayU / historii płatności.
//
// Bez zmian: algorytmu zużycia kredytów, qty_used, wallet_tx, RPC, PayU,
// migracji, statusów, historii EUR. Tylko warstwa prezentacji.
//
// Default `false`: gdy wyłączone, panel dostawcy pokazuje stare EUR/portfel
// (zero zmian). Flip na `true` dopiero po review + smoke test prod.
export const CREDITS_UI_SUPPLIER = true;

// [feat/retailer-supplier-requirements]
// Uwagi admina per sieć handlowa ("wymagania sieci") widoczne dla DOSTAWCY
// przed wysłaniem oferty + wymagane potwierdzenie zapoznania (checkbox).
// Admin: textarea "Uwagi dla dostawcy" przy edycji sieci (osobne od wewnętrznej
// notatki `description`). Dostawca: blok z uwagami + checkbox blokujący wysyłkę
// (tylko gdy sieć ma niepuste uwagi). Potwierdzenie zapisywane w
// legacy_sends.data.requirementsAck (bez migracji legacy_sends).
//
// Wymaga migracji 039 (retailers.supplier_requirements) zaaplikowanej ręcznie
// w Supabase. Default `false`: gdy wyłączone, panel admina i dostawcy bez zmian.
// Flip na `true` dopiero PO zaaplikowaniu migracji + smoke test prod.
export const RETAILER_REQUIREMENTS = true;
