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
// administracyjny). Pokazuje datę następnej wysyłki (pierwszy wtorek miesiąca
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

// [feat/nip-required — Poprawki Lany #1]
// NIP firmy obowiązkowy: blokuje rejestrację dostawcy, zapis profilu firmy oraz
// zakup kredytów, dopóki pole NIP jest puste. Komunikat:
// "Podaj NIP firmy. To pole jest wymagane do rejestracji i rozliczeń."
//
// Bez migracji — kolumna companies.nip już istnieje (nullable). NIE dodajemy
// NOT NULL, bo zepsułoby historyczne rekordy bez NIP-u; egzekwujemy w aplikacji.
//
// Walidacja serwerowa w netlify/functions/register-supplier-self.js jest
// gatowana OSOBNO env-varem NIP_REQUIRED="true" (defense-in-depth) — flaga
// frontendowa jest głównym gate'em UX. Default `false`: gdy wyłączone, NIP
// pozostaje opcjonalny wszędzie (zero zmian). Flip na `true` po smoke test prod.
export const NIP_REQUIRED = true;

// [feat/credits-validity-and-expiry-ui — Poprawki Lany #4 + #5 + #7]
// Wyświetlanie ważności kredytów (12 miesięcy od zakupu):
//  - przed zakupem: linia info "Kredyty ważne przez 12 miesięcy od daty zakupu"
//  - po zakupie (ekran potwierdzenia): "Twoje kredyty są ważne do: DD.MM.RRRR"
//  - panel Finanse (karta aktywnego pakietu): data ważności w formacie DD.MM.RRRR
//
// Bez migracji — dane już istnieją (packages.expires_at, company_capacity.pkg_expiry).
// Wygasanie kredytów jest już egzekwowane przez widok company_capacity (do puli
// liczone tylko niewygasłe pakiety) — ta flaga to TYLKO warstwa prezentacji.
// Default `false`: gdy wyłączone, panel bez zmian (stary format/placeholdery).
export const CREDITS_VALIDITY_UI = true;

// [feat/bank-transfer-proforma — Poprawki Lany #2]
// Płatność przelewem generuje fakturę proforma (HTML): przycisk "Pobierz proformę",
// wysyłka mailem, zapis w historii płatności, numeracja PF/RRRR/NNNNNN. Pakiet
// pozostaje "oczekuje na płatność" — admin aktywuje ręcznie po zaksięgowaniu wpłaty.
// Wymaga NIP firmy (rozliczenia).
//
// Wymaga migracji 040 (proformas + allocate_proforma_number) zaaplikowanej ręcznie
// w Supabase ORAZ env w Netlify: PROFORMA_SELLER_NIP, PROFORMA_BANK_IBAN
// (dane prawne/finansowe sprzedawcy — domyślnie placeholdery). NIE dotyka PayU.
// Default `false`: gdy wyłączone, przelew działa jak dziś (ekran z numerem konta).
// Flip na `true` dopiero PO migracji + ustawieniu env + smoke test prod.
export const BANK_TRANSFER_PROFORMA = true;

// [feat/credit-expiry-reminder — Poprawki Lany #6]
// Przypomnienie e-mail 14 dni przed wygaśnięciem pakietu kredytów, RAZ na pakiet.
// Leniwy sweep przy wejściu do aplikacji (fire-and-forget) → funkcja Netlify
// send-expiry-reminders → RPC claim_due_expiry_reminders (atomowo oznacza
// packages.expiry_reminder_sent_at i zwraca due) → wysyłka Resend.
//
// Wymaga migracji 041 (packages.expiry_reminder_sent_at + claim_due_expiry_reminders)
// zaaplikowanej ręcznie w Supabase. Default `false`: gdy wyłączone, sweep nie
// jest wołany (zero zmian). Flip na `true` dopiero PO migracji + smoke test prod.
export const CREDIT_EXPIRY_REMINDER = false;

// [feat/account-inactivity-foundation — Poprawki Lany #8 — część BEZPIECZNA]
// Śledzenie aktywności konta + ostrzeżenia e-mail 30 i 7 dni przed progiem
// 24 miesięcy nieaktywności. Przy wejściu do aplikacji: bump last_active_at
// (RPC touch_last_active) + leniwy sweep ostrzeżeń (fire-and-forget) →
// funkcja send-inactivity-warnings → RPC claim_due_inactivity_warnings → Resend.
//
// TYLKO ostrzeżenia + śledzenie. Archiwizacja/anonimizacja/usuwanie kont to
// OSOBNY etap za flagą ACCOUNT_HARD_DELETE (poniżej, default false) — do testów
// na sandboxie i osobnej decyzji (RODO, destrukcyjne).
//
// Wymaga migracji 042 (profiles.last_active_at + markery + RPC) zaaplikowanej
// ręcznie w Supabase. Default `false`: gdy wyłączone, brak śledzenia i sweepów
// (zero zmian). Flip na `true` dopiero PO migracji + smoke test prod.
export const ACCOUNT_LIFECYCLE = false;

// [feat/account-inactivity-foundation — placeholder destrukcyjnej części #8]
// Steruje WYKONANIEM archiwizacji/anonimizacji/usuwania kont po 24 mc. NIE jest
// jeszcze podpięty do żadnej logiki — rezerwacja nazwy + jawny sygnał, że ta
// część wymaga osobnej implementacji, sandboxu i sign-offu (RODO). Trzymać false.
export const ACCOUNT_HARD_DELETE = false;

// [feat/admin-supplier-settlements] Nowy moduł admina "Rozliczenia" (Settlements):
// osobna zakładka z finansami dostawców — proformy (oczekujące + opłacone),
// pakiety kredytów (kupiono/wykorzystano/zostało/ważność/status), kwoty netto/VAT/brutto.
// Akcja "Oznacz opłaconą → aktywuj pakiet" przenosi się tu z zakładki Firmy.
//
// Default `false`: gdy wyłączone, zakładka Rozliczenia nie istnieje, a karta proform
// zostaje w Firmy (obecne zachowanie). Gdy `true`: zakładka Rozliczenia widoczna,
// karta proform znika z Firmy (jest tylko w Rozliczeniach). Bez migracji — czyta
// istniejące proformas/packages/company_capacity (RLS: admin widzi wszystko).
// TODO (przyszłość): rola "admin finansowy" z węższym dostępem — wymaga osobnego
// modelu ról (migracja), NIE w tym branchu.
export const ADMIN_SETTLEMENTS = true;

// [feat/admin-pipeline-cleanup] Pipeline = widok OPERACYJNY, nie finansowy.
// Gdy `true`: chowa bloki finansowe z Pipeline (credit-settlement
// "Rozliczenie kredytów PreConnect": kupione/wykorzystane/pozostałe/zwroty/
// oczekujące w PipelineTableV2, oraz charging-settlement w starym fallbacku
// PageAdminPipeline) i RELOKUJE credit-settlement do zakładki Rozliczenia
// (PageAdminSettlements), żeby nic nie zginęło. Operacyjne sekcje (moderacja,
// koszyk mailingu, wysłane/tracking, odczyty/reakcje/per-send zwroty) zostają.
//
// Bez migracji, bez zmian danych. Default `false`: Pipeline bez zmian (bloki
// finansowe tam, gdzie dziś; Rozliczenia bez relokowanej sekcji).
// [chore/flip-admin-pipeline-cleanup] ON — finanse znikają z Pipeline i żyją
// tylko w Rozliczeniach (relokowane credit-settlement + KPI przychodu).
export const ADMIN_PIPELINE_CLEANUP = true;

// [feat/admin-dashboard-polish] Wizualne/informacyjne uporządkowanie Admin Dashboard:
// kompaktowy alert akcji → ujednolicone KPI → grid modułów (Pipeline/Firmy/Rozliczenia/
// Sieci/Wiadomości) → kompaktowy status FM 2026 → danger zone (reset) na dole.
// Fork renderu PageAdminDash. Default `false`: stary układ bez zmian.
// Bez migracji, bez zmian danych. Flip na `true` po smoke test prod.
// [chore/flip-admin-dashboard-polish] ON — nowy uporządkowany Dashboard na prod.
export const ADMIN_DASHBOARD_POLISH = true;

// [feat/preconnect-first-tuesday-mailing-logic — Faza 1]
// Reguła produktowa: mailing PreConnect = WSZĘDZIE PIERWSZY WTOREK MIESIĄCA
// (nie drugi wtorek, nie czwartek). Rozdziela "w panelu kupca" (status sent)
// od "daty mailingu" (realna data wysyłki e-maila albo planowany pierwszy
// wtorek). Za flagą:
//   • pasek "następna wysyłka" w koszyku Pipeline liczy pierwszy wtorek,
//   • dostawca przed datą mailingu widzi "Zaplanowane do mailingu — DD.MM.RRRR",
//     a od daty mailingu — normalny status odczytu,
//   • przy ręcznym "Wyślij e-mail do tej sieci" stemplujemy data.mailingSentAt,
//   • data mailingu = mailingSentAt jeśli jest, inaczej planowany pierwszy wtorek.
//
// UWAGA — ZAKRES FAZY 1: TYLKO UI/widoczność + planowana data + stempel
// mailingSentAt. NIE domyka twardego wygaszania/zwrotu kredytu — RPC
// expire_legacy_sends_14d nadal liczy 14 dni od `sentAt`. Pełna zgodność
// zwrotów wymaga FAZY 2: migracji RPC, by liczyć 14 dni od mailingSentAt /
// daty mailingu, a nie od sentAt.
//
// Bez migracji, bez zmian RPC, bez zmian danych historycznych (poza zapisem
// mailingSentAt przy faktycznym wysłaniu e-maila). Default `false`: zero zmian.
// [chore/flip-preconnect-mailing-date-logic] ON — pierwszy wtorek + statusy
// "Zaplanowane do mailingu" na prod. UWAGA: Faza 2 (RPC zwrotów) wciąż otwarta.
export const PRECONNECT_MAILING_DATE_LOGIC = true;
