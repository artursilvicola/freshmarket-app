# P2 — Plan migracji `src/legacy/PreconnectFM.jsx` na bilingual PL/EN

**Status:** **zaakceptowany przez Codexa z BINDING decyzjami** (patrz sekcja niżej). Zero zmian w kodzie w tym dokumencie.

Branch: `feat/i18n-p2-legacy-plan` · Baseline: `main` (po Krok 12 audit merge `f327025`, tag `v-i18n-nonlegacy`)

## Decyzje Codexa (BINDING)

Pytania otwarte z pierwszej wersji dokumentu (sekcja "Notes do dyskusji" niżej) zostały rozstrzygnięte. Te decyzje są wiążące dla wszystkich branchy P2-N — implementacja musi się do nich dostosować.

### 1. Namespace i18n

**Decyzja:** jeden plik `legacy.json` z sekcjami:
```
common, supplier, buyer, admin, fm, chat, errors
```

**Uzasadnienie:** najprostsze i najbezpieczniejsze. Jeden plik = jedna lista kluczy do zsynchronizowania PL↔EN. Sekcje wewnątrz pozwalają na czytelność (cały Buyer panel w jednej sekcji), ale bez podziału na osobne pliki które trzeba ładować osobno w `src/i18n/index.js`.

**Wpływ na branche P2-N:**
- Każdy branch dodaje klucze TYLKO do swojej sekcji (P2-2 → `buyer.*`, P2-3 → `supplier.*`, etc.)
- Sekcja `common` reservowana na reużywalne (np. `confirm_delete`, `loading`, `back`) używane przez wiele Page*
- Sekcja `errors` reservowana na komunikaty z `db.js` bilingualizowane razem z odpowiednią Page*
- Po każdym branchu sanity check: `pl/legacy.json` i `en/legacy.json` symetryczne

### 2. P2-6 split na P2-6a + P2-6b

**Decyzja:** **TAK, dzielimy.** Zatwierdzony podział:
- **P2-6a:** Admin Dashboard + Retailers + Firmy
- **P2-6b:** Admin Pipeline (osobny branch ze względu na rozmiar i krytyczność moderacji)

**Uzasadnienie:** Pipeline (linia 6528, ~700 linii) to najbardziej krytyczna ścieżka admina (moderacja propozycji + wysyłka batch do retailerów). Łączenie z lżejszymi Dash/Retailers/Firmy zwiększyłoby ryzyko PR-a do review.

### 3. Czat osobny branch P2-7b

**Decyzja:** **TAK, osobno.** `P2-7b: Chat` jako dedykowany branch z `FloatingChat` + `PageAdminChat`.

**Uzasadnienie:** czat ma:
- heavy state (threads, messages, unread counters)
- integration z AI (suggest reply)
- floating UI z animacjami i open/close logic

Mieszanie z brandingiem/team management to nieuzasadnione ryzyko. Czat zasługuje na własny PR z osobnym test planem.

### 4. Daty: NIE używać `Intl.DateTimeFormat` teraz

**Decyzja:** zachowujemy obecne podejście — tablice `PL_DAYS` / `PL_MONTHS` / `PL_MONTHS_SHORT` (linie 3294-3296) **dostają wersje EN obok**. Klucze w `legacy.common.*` lub osobny moduł stałych.

**Uzasadnienie:** `Intl.DateTimeFormat` to zmiana zachowania formatowania, nie tłumaczenie tekstu. To **refaktor** który wykracza poza zakres "i18n migration". Może być osobnym cleanup'em w przyszłości, ale **NIE w P2**.

**Wpływ na branche:**
- P2-1 (setup) dodaje `EN_DAYS` / `EN_MONTHS` / `EN_MONTHS_SHORT` (analogiczne tablice EN), z dispatch'em po `i18n.language`
- Funkcje formatujące daty w PreconnectFM (jest ich kilka) muszą sięgać po właściwą tablicę zależnie od locale

### 5. P2-11 (backend errors) — ODŁOŻONE

**Decyzja:** **odkładamy.** Najpierw kończymy P2-1 do P2-10 (frontend legacy + maile Resend). Decyzja o P2-11 dopiero **po zakończeniu P2-10**, w osobnym review Codexa.

**Uzasadnienie:** P2-11 (15+ Netlify functions × ~5-10 PL error stringów = ~100 zmian po stronie backendu) to duży nakład pracy o marginalnym zysku dla edge case'ów. Lepiej najpierw skończyć główny temat (frontend), zobaczyć ile rzeczywiście brakuje, potem podjąć decyzję na danych.

---

## Stan wyjściowy (przed P2)

- `src/legacy/PreconnectFM.jsx`: **10 866 linii**, **~75 komponentów** (Page*, modale, helpery, FM)
- `src/lib/db.js`: **32 user-facing errors w kategorii B** (z audytu Krok 12) — używane wyłącznie z PreconnectFM
- `netlify/functions/`: **9 error messages w `register-supplier-self.js`** + analogiczne w 5-6 innych funkcjach wywoływanych z UI
- `netlify/functions/_shared/supplier-email-templates.js`: **11 Resend templates** dalej tylko PL (welcome zrobiony bilingual w Kroku 6)

Razem to **3 fronty** do tłumaczenia:
1. **Frontend legacy** (PreconnectFM.jsx) — największy
2. **Backend errors** (Netlify Functions zwracające `json.error` w PL)
3. **Backend emails** (Resend templates dla offer lifecycle + account states)

## Status P2-2 — buyer flow ZAKOŃCZONY (po P2-2c)

P2-2 (buyer panel) został zrealizowany w 3 partiach. Czwarta planowana partia (P2-2d) **anulowana w obecnym zakresie** po review Codexa — patrz uzasadnienie niżej.

### Wykonane partie P2-2

| Partia | Branch (merged) | Zakres | Status |
|---|---|---|---|
| **P2-2a** | `feat/i18n-p2-2a-buyer-profile-password-preview` | `PageBuyerProfile` + `ChangePasswordSection` + `db.js` errors (buyer/supplier profile + password). `OfferPreviewModal` początkowo był w scope, **cofnięty** po review Codexa (scope bug — modal shared) | ✅ Merged `6a40711` |
| **P2-2b** | `feat/i18n-p2-2b-buyer-dashboard-offers-catalog` | `PageBuyerDashboard` + `PageBuyerOffers` + `PageBuyerCatalog` (~131 kluczy) | ✅ Merged `aaa3b88` |
| **P2-2c** | `feat/i18n-p2-2c-buyer-detail` | `PageBuyerDetail` (~99 kluczy, w tym CTA email subjects/bodies z `{{product}}` interpolation) | ✅ Merged `95fc316` |
| **P2-2d** | (nie powstał) | Planowane: `PageSupplierProfile` + `CompanyPreviewModal` | ❌ **Anulowane** — patrz niżej |

### Co działa dla buyer EN po P2-2c

- `/kupiec` (Dashboard) — bilingual
- `/kupiec/oferty` (PageBuyerOffers — lista propozycji + filtrowanie + zapisane) — bilingual
- `/kupiec/katalog` (PageBuyerCatalog — baza dostawców) — bilingual
- `/kupiec/oferta/<id>` (PageBuyerDetail — szczegóły propozycji + CTA z mailtos) — bilingual
- `/kupiec/profil` (PageBuyerProfile) — bilingual
- Zmiana hasła (ChangePasswordSection, shared z supplier profile) — bilingual
- 7 `db.js` errors dla buyer profile + password — bilingual

### Co NIE działa dla buyer EN (świadomie odłożone)

- `CompanyPreviewModal` (otwiera się przy klikach "Pełny profil dostawcy" w PageBuyerCatalog/PageBuyerDetail) — **dalej PL**
- `OfferPreviewModal` (klik podglądu w jakimś niezidentyfikowanym buyer flow) — **dalej PL**

### Dlaczego P2-2d anulowane

P2-2d miało objąć `PageSupplierProfile` + `CompanyPreviewModal`. Po audycie call-site'ów oba komponenty okazały się **shared** poza buyer flow:

**`PageSupplierProfile`** — to supplier flow (panel `/dostawca/profil`), nie buyer. Wciągnięcie tego do branchu "buyer-only" byłoby zamieszaniem scope'u. Decyzja: **przeniesione do supplier phase** (P2-3 supplier dashboard lub P2-5 supplier company/finance).

**`CompanyPreviewModal`** — używany w:
- supplier preview (`role="supplier"`)
- buyer catalog/detail (`role="buyer"`)
- admin preview (`role="admin"`)
- FM flows (też buyer-role w niektórych miejscach)
- inne shared call sites bez jednoznacznego `role`

Globalne tłumaczenie w branchu "buyer-only" powtórzyłoby błąd `OfferPreviewModal` z P2-2a (cofnięte po Codex review). Codex zaproponował 2 opcje:
- **Opcja A (wybrana):** odłożyć do osobnego, świadomego branchu po fazach supplier+admin
- Opcja B: warunkowe tłumaczenie z prop `i18nMode="buyer"` (precedens, ryzyko)

Decyzja Artura: **Opcja A**. Czystsze.

### Przeniesione na później

| Element | Nowy plan | Uzasadnienie |
|---|---|---|
| `PageSupplierProfile` | **Supplier phase** (P2-3 lub P2-5) | Należy do `/dostawca/*` flow, nie `/kupiec/*` |
| `CompanyPreviewModal` + `OfferPreviewModal` | **Nowy branch** `feat/i18n-p2-shared-modals` **po fazach supplier+admin** (P2-3 do P2-6/7) | Shared między 4+ rolami. Rekomendacja Artura: robić shared modale gdy więcej okolicznych ekranów będzie już EN, łatwiej review i mniej "samotnych" zmian |

### Tag

`v-i18n-buyer-flow` — annotated tag na main po P2-2c merge (commit `95fc316`). Bezpieczny punkt powrotu po zamknięciu buyer flow non-shared.

### Sugerowana kolejność dalej (zaktualizowana)

```
P2-3 supplier dashboard          ← następny kodowy etap (rekomendacja Artura)
  ↓
P2-4 supplier offers + wysyłki
  ↓
P2-5 supplier firma + finanse
  ↓
P2-6a/6b admin core
  ↓
P2-7 admin extras
  ↓
P2-7b czat
  ↓
P2-8 FM uczestnicy
  ↓
P2-9 FM admin
  ↓
*** P2-shared-modals ***          ← CompanyPreviewModal + OfferPreviewModal
*** (po większości okolicznych ekranów) ***
  ↓
P2-10 emails
  ↓
P2-11 backend errors (opcjonalne)
```

---

## Strukturalna mapa `PreconnectFM.jsx`

Linie i komponenty (z grep `^(function|const|export) [A-Z]`):

### Sekcja 1 — Konstanty i mali helpery UI (linie ~1-1200)

| Linia | Element | Co zawiera |
|---|---|---|
| 62-95 | CEMOJI, CNAMES, TYPE_LABELS, STATUS_TIPS, STATUS_MAP, CTA_MAP | Słowniki labelek (kategorie, typy firmy, statusy ofert, CTA) |
| 98-545 | RETAILERS, COMPANY_INIT, BUYER_INIT, OFFERS_INIT, SENDS_INIT, LIMITS_INIT, WALLET_INIT, PRICING_PLANS, PKG_OPTS | Seed data |
| 569-672 | Badge, Btn, Card, Stat, TagToggle, Alrt, Inp, Row, RetailerLogo, CompanyLogo, Modal, TrackingBar, OfferFilters | Małe komponenty reużywalne |
| 674-990 | FM constants (FM_CHAINS, FM_SUPPLIERS, FM_PHASES, FM_SCORE, FM_ZONE_*) | Dane dla FM B2B Meetings |
| 992-1198 | COMPANIES_DB, KNOWLEDGE_BASE | Większe seed data + baza wiedzy AI |

### Sekcja 2 — Czat (linie ~1199-3300)

| Linia | Element |
|---|---|
| 1199 | FloatingChat |
| 1303 | PageAdminChat |

**Notatka:** czat ma stan + komunikaty + tooltips + threads. Heavy stateful — ryzyko regresji wysokie.

### Sekcja 3 — Supplier Dashboard + Wysyłki (linie ~3321-5400)

| Linia | Element | Funkcja |
|---|---|---|
| 3321 | PageDashboard | Główny dashboard supplera |
| 3523 | NextStepCard | Widget "co dalej" |
| 3551 | PkgCard | Widget pakietu |
| 3580 | NextWindowCard | Widget najbliższego okna wysyłki |
| 3603 | KpiRow | KPI dashboard |
| 3630 | ActivityCard | Activity feed |
| 3667 | FmCompactCard | Skrót FM |
| 3731 | OnboardingChecklist | Checklist nowego supplera |
| 3826 | HelpStripDashboard | Pasek pomocy |
| 3862 | PageWysylki | Strona "Wysyłki" (lista propozycji wysłanych do sieci) |

### Sekcja 4 — Supplier Profil + Oferty (linie ~4205-5114)

| Linia | Element |
|---|---|
| 4205 | PageCompany — profil firmy |
| 4518 | PageOffers — lista ofert |
| 4617 | PageOfferForm — formularz tworzenia/edycji oferty |

### Sekcja 5 — Supplier Finanse (linie ~5115-5500)

| Linia | Element |
|---|---|
| 5115 | PageFinanse — finanse i wallet |
| 5253 | PageFinansePakiety — kupowanie pakietów PayU |

### Sekcja 6 — Buyer (linie ~5506-6400)

| Linia | Element |
|---|---|
| 5506 | PageBuyerDashboard |
| 5644 | PageBuyerOffers |
| 5853 | PageBuyerCatalog |
| 5953 | PageBuyerProfile |
| 5981 | PageSupplierProfile (shared) |
| 6037 | ChangePasswordSection |
| 6092 | PageBuyerDetail — szczegóły propozycji |

### Sekcja 7 — Admin (linie ~6415-7990)

| Linia | Element |
|---|---|
| 6415 | PageAdminDash |
| 6528 | PageAdminPipeline — kolejka moderacji |
| 6772 | PageAdminRetailers |
| 7287 | PageAdminFirmy |
| 7697 | EmailNewsletterModal — modal "Wyślij maila zbiorczego" |
| 7943 | ConfirmForm |
| 7987 | ProfileSection (helper) |
| 7999 | CompanyPreviewModal |
| 8185 | OfferPreviewModal |

### Sekcja 8 — FM B2B Meetings (linie ~8211-10374)

| Linia | Element |
|---|---|
| 8211 | AccountSwitcherBar |
| 8303 | NumBadge |
| 8318 | ZoneLegend |
| 8331 | FMAdminPreferencesView |
| 8538 | FMPhaseBanner |
| 8550 | FMVenueFooter |
| 8561 | FMLockScreen |
| 8614 | RetailerPreviewModal |
| 8645 | PageSupplierFM |
| 8920 | PageBuyerFM |
| 9554 | FMAdminCorrectionPanel |
| 9904 | AlgorithmTriggerCard |
| 10016 | PageAdminFM |

### Sekcja 9 — Admin extras (linie ~10394-10866)

| Linia | Element |
|---|---|
| 10394 | PageAdminBranding — upload brand logo (caller PhotoUploader) |
| 10598 | PageAdminTeam — super_admin management |

## Propozycja podziału na 9 branchy

Zasada: **jeden branch = jeden spójny obszar UI** + **bez refaktoru logiki**, tylko `useTranslation` + `t()` + symetryczne klucze PL/EN.

### Kolejność (od najbezpieczniejszego do najryzykowniejszego)

#### **P2-1: Setup + namespace + małe helpery wspólne** ⚡ warm-up

**Branch:** `feat/i18n-p2-1-setup`

**Zakres:**
- Stworzenie `src/i18n/{pl,en}/legacy.json` (nowy namespace `legacy`) z sekcjami **`common`, `supplier`, `buyer`, `admin`, `fm`, `chat`, `errors`** (BINDING)
- Rejestracja w `src/i18n/index.js`
- Słowniki przeniesione do JSON: `STATUS_TIPS`, `STATUS_MAP`, `CTA_MAP`, `TYPE_LABELS`, `CEMOJI`/CNAMES — **tylko display labels, nie wartości seed danych**
- Małe komponenty: `Alrt`, `TagToggle` jeśli mają hardcoded teksty (sprawdzić)
- `PL_DAYS`/`PL_MONTHS`/`PL_MONTHS_SHORT` (linie 3294-3296) — **BINDING decyzja: NIE `Intl.DateTimeFormat`**. Dodajemy obok analogiczne `EN_DAYS`/`EN_MONTHS`/`EN_MONTHS_SHORT` **in-place w `PreconnectFM.jsx`**. Funkcje formatujące daty wybierają tablicę po `i18n.language === "en" ? EN_* : PL_*` inline, w miejscu użycia.

**Wyłączone:**
- Nie ruszamy seed data structures (RETAILERS, COMPANIES_DB) — tylko display
- Nie ruszamy FM_* constants
- Nie zmieniamy zachowania formatowania dat (zostaje obecny format, tylko polskie/angielskie nazwy)
- **Nie tworzymy nowego modułu** (np. `src/legacy/date-locale.js`). W P2-1 dodajemy `EN_DAYS`/`EN_MONTHS`/`EN_MONTHS_SHORT` obok istniejących `PL_*` w `PreconnectFM.jsx` i wybieramy tablice in-place po `i18n.language`. **Bez refaktoru struktury** — żadnych nowych plików w `src/legacy/`, żadnego ekstrahowania helperów do osobnych modułów.

**Wielkość:** ~50-80 stringów. Bardzo small risk. **Cel: ustawić wzorzec dla P2.**

**Test plan:** `legacy.json` symetryczny, build OK, brak regresji wizualnej w PreconnectFM.

---

#### **P2-2: Buyer panel** 👤

**Branch:** `feat/i18n-p2-2-buyer`

**Zakres:**
- `PageBuyerDashboard` (5506)
- `PageBuyerOffers` (5644)
- `PageBuyerCatalog` (5853)
- `PageBuyerProfile` (5953)
- `PageBuyerDetail` (6092) + modale `CompanyPreviewModal` (7999) + `OfferPreviewModal` (8185)
- `ChangePasswordSection` (6037) — używa `changeOwnPassword` z db.js (5 errors do bilingual w tym kroku)
- `PageSupplierProfile` (5981) — shared między Buyer i Supplier

**Powiązany db.js:** `updateOwnBuyerProfile` (1 user-facing), `changeOwnPassword` (5), `updateOwnSupplierProfile` (1) — **łącznie 7 stringów z db.js bilingualizujemy w tym branchu**

**Wielkość:** ~250-400 stringów, ~900 linii kodu. Średnia.

**Test plan:** zaloguj się jako Buyer w EN, przejrzyj wszystkie zakładki, otwórz modale, zmień hasło.

---

#### **P2-3: Supplier dashboard + widgets** 📊

**Branch:** `feat/i18n-p2-3-supplier-dashboard`

**Zakres:**
- `PageDashboard` (3321)
- Widgety: `NextStepCard`, `PkgCard`, `NextWindowCard`, `KpiRow`, `ActivityCard`, `FmCompactCard`, `OnboardingChecklist`, `HelpStripDashboard`

**Powiązany db.js:** brak (dashboard tylko czyta)

**Wielkość:** ~150-200 stringów, ~500 linii. Średnia.

**Test plan:** Supplier login w EN, dashboard pokazuje EN strings.

---

#### **P2-4: Supplier — oferty + wysyłki** 📦

**Branch:** `feat/i18n-p2-4-supplier-offers`

**Zakres:**
- `PageOffers` (4518)
- `PageOfferForm` (4617) — duży formularz, modały, walidacje
- `PageWysylki` (3862) — lista wysyłek do sieci
- Komponenty pomocnicze: `OfferFilters`, `TrackingBar`

**Powiązany db.js:** `saveOffer` w `db.js` (linia 481 — sprawdzić czy ma user-facing throw — jeśli tak, bilingualizujemy)

**Wielkość:** ~300-400 stringów, ~1100 linii. Duża.

**Test plan:** Supplier — utwórz ofertę, edytuj, wyślij do sieci, zobacz na liście wysyłek.

---

#### **P2-5: Supplier — profil firmy + finanse + pakiety** 💰

**Branch:** `feat/i18n-p2-5-supplier-company-finance`

**Zakres:**
- `PageCompany` (4205) — profil firmy + AI generator opisu
- `PageFinanse` (5115)
- `PageFinansePakiety` (5253) — kupowanie pakietów przez PayU

**Powiązany db.js:** `saveCompanyContacts` (1), `generateCompanyDescriptionAI` (2), `createPayuOrder` (3) — **6 stringów**

**Wielkość:** ~200-300 stringów, ~800 linii. Średnia/duża.

**Test plan:** edycja profilu firmy + AI opis + zakup pakietu (test mode).

---

#### **P2-6: Admin core** 👮

**Branch:** `feat/i18n-p2-6-admin-core`

**Zakres:**
- `PageAdminDash` (6415)
- `PageAdminPipeline` (6528) — najbardziej rozbudowana strona admina
- `PageAdminRetailers` (6772)
- `PageAdminFirmy` (7287)
- `ConfirmForm` (7943)
- `ProfileSection` helper (7987)

**Powiązany db.js:** `createBuyerAccount` (3), `adminUpdateBuyerAccount` (3), `validateBuyerAccountPayload` (5), `sendRetailerBatch` (1) — **12 stringów**

**Wielkość:** ~400-600 stringów, ~1500 linii. Bardzo duża — **podzielony na 2 branche (BINDING decyzja Codexa)**:
- **P2-6a:** Dash + Retailers + Firmy (~800 linii, lżejsza część)
- **P2-6b:** Pipeline (moderacja, ~700 linii, najbardziej krytyczna ścieżka)

**Test plan:** admin moderuje ofertę, dodaje kupca, edytuje firmę, dodaje sieć handlową.

---

#### **P2-7: Admin extras + email newsletter** 🛠

**Branch:** `feat/i18n-p2-7-admin-extras`

**Zakres (po BINDING decyzji Codexa — czat WYJĘTY do P2-7b):**
- `EmailNewsletterModal` (7697) — modal wysyłki zbiorczej
- `PageAdminBranding` (10394) — upload brand logo
- `PageAdminTeam` (10598) — super_admin management

**Powiązany db.js:** `uploadBrandLogo` (5), `notifySupplier` (3), `promoteToAdmin` (4), `demoteFromAdmin` (3), `setSuperAdmin` (3) — **18 stringów**

**Wielkość:** ~200-300 stringów, ~700 linii. Średnia (mniejsza po wyjęciu czata).

---

#### **P2-7b: Czat (Floating + Admin)** 💬

**Branch:** `feat/i18n-p2-7b-chat`

**Zakres (osobny branch — BINDING decyzja Codexa):**
- `FloatingChat` (1199) — floating UI dla supplier/buyer z threads
- `PageAdminChat` (1303) — admin chat panel z AI suggest reply

**Powiązany db.js:** `suggestAdminChatReplyAI` (2 errors), `getFmMessages`, `saveFmMessage`, `markFmMessageRead`

**Wielkość:** ~200-300 stringów, ~2000 linii (od 1199 do ~3300). Średnia/duża.

**Ryzyko:** heavy state (threads, unread counters), animacje open/close, integracja AI suggest. Osobny PR pozwala na dedykowany test plan: open/close, send message, mark read, AI suggest button.

---

#### **P2-8: FM Buyer + FM Supplier (uczestnicy)** 🤝

**Branch:** `feat/i18n-p2-8-fm-participants`

**Zakres:**
- `PageSupplierFM` (8645) — supplier wybiera retailerów na meetings
- `PageBuyerFM` (8920) — buyer akceptuje/odrzuca supplierów
- Wspólne: `RetailerPreviewModal` (8614), `FMPhaseBanner`, `FMVenueFooter`, `FMLockScreen`, `NumBadge`, `ZoneLegend`, `AccountSwitcherBar`

**Powiązany db.js:** `saveFmPrefs`, `getFmPrefs`, `saveFmWishlist`, `saveFmSelectionConfirmation`, `setCompanyTargetRetailers` — **~4 stringów (większość to dev-only)**

**Wielkość:** ~300-400 stringów, ~1100 linii. Duża, ale spójna funkcjonalnie.

**Test plan:** supplier i buyer przeszedłszy preferences phase.

---

#### **P2-9: FM Admin (algorytm + korekta + harmonogram)** 🧮

**Branch:** `feat/i18n-p2-9-fm-admin`

**Zakres:**
- `FMAdminPreferencesView` (8331)
- `FMAdminCorrectionPanel` (9554) — manualne korekty harmonogramu
- `AlgorithmTriggerCard` (9904) — odpalanie pairing algo
- `PageAdminFM` (10016)

**Powiązany db.js:** `saveFmResp`, `saveFmSchedule` — **~2 stringów (głównie dev-only)**

**Wielkość:** ~400-600 stringów, ~1400 linii. **Najbardziej ryzykowny — pairing algo logic**, ale i18n dotyczy tylko UI tekstów, nie samego algorytmu.

**Test plan:** admin uruchamia pairing, robi korekty, publikuje harmonogram.

---

### Backend (frontend P2 zakończone)

#### **P2-10: Resend templates EN — offer lifecycle** ✉️

**Branch:** `feat/i18n-p2-10-emails-offer-lifecycle`

**Zakres:** 8 templates locale-aware (`payload.locale` → EN/PL):
- `account_activated`, `account_rejected`, `account_suspended`
- `offer_to_moderation`, `offer_approved`
- `offers_sent_to_retailer`, `offers_read_by_buyer`
- `offer_expired`

**Założenia:** te maile potrzebują `locale` w payloadzie z miejsca wywołania. Callerzy (Netlify functions + admin actions) muszą przekazywać `profile.locale` zalogowanego supplera.

**Wyłączone:**
- `admin_new_registration` zostaje PL (zespół FM)
- newsletter batch (email do retailerów) — to inny adresat, osobno

**Wielkość:** ~12 plików (template + caller per typ).

**Test plan:** supplier w EN dostaje wszystkie 8 typów maili po angielsku; PL supplier dostaje PL (bez regresji).

---

### Pomocnicze / opcjonalne

#### **P2-11 (opcjonalny): Netlify functions error i18n** 🛡️

**Branch:** `feat/i18n-p2-11-backend-errors`

**Zakres:**
- `register-supplier-self.js` — 9 polskich error strings (P0 RegisterSupplierPage)
- `admin-create-user.js`, `send-offer.js`, `send-retailer-batch.js`, `ai-*` — analogicznie
- Strategia: function odczytuje `payload.locale` (lub Header `Accept-Language`), zwraca error string w odpowiednim języku

**Decyzja do Codexa:** czy to robić? Argumenty:
- ZA: anglojęzyczny user P0 onboardingu dalej dostaje PL error jeśli backend padnie (np. email już istnieje)
- PRZECIW: rzadkie ścieżki, duży nakład pracy w 15+ functions

**Alternatywa:** wymaga decyzji: zwracać `error_code` zamiast `error_message`, a translacja po stronie frontu (mapper kod→klucz i18n).

---

## Kryteria wejścia i wyjścia dla każdego branchu P2-N

### Wejście (przed startem)

- [ ] Branch tworzy się z aktualnego `main` (`git checkout main && git pull --ff-only`)
- [ ] Wszystkie poprzednie branche P2-* zmerge'owane do `main`
- [ ] Build na `main` zielony
- [ ] Smoke test produkcji ostatniego merge'a przeszedł

### Wyjście (przed merge'em)

- [ ] `npm run build` zielony
- [ ] `legacy.json` PL i EN symetryczne (skrypt sanity check, jak w poprzednich krokach)
- [ ] Inne JSON i18n nietknięte (chyba że specyficznie dla danego branchu)
- [ ] `git diff main..HEAD --stat` pokazuje tylko zakładany zakres (żadnych zmian poza skopem)
- [ ] PL teksty BEZ regresji (smoke test PL flow)
- [ ] EN strings widoczne w przełączonym EN
- [ ] Brak `console.warn` o brakujących kluczach przy normalnym użyciu
- [ ] PR opis ma listę plików, kategorię test plan, zakaz refaktoru

### Zasady ogólne

1. **Jeden branch = jeden obszar UI** (nie mieszać Buyer + Admin w jednym branchu)
2. **Bez refaktoru** — tylko zamiana stringów na `t()`. Żadne wynoszenia stałych, ekstrakcji komponentów, zmian struktury JSX
3. **Backward-compatible** — gdy komponent ma defaults (np. `label="..."`), zmieniamy na `label ?? t(...)`
4. **Interpolacje** — wszystkie wartości dynamiczne (`${name}`, `${count}`) zamieniane na `{{name}}`, `{{count}}` w kluczach JSON
5. **Trans dla HTML** — tylko gdzie naprawdę potrzebne (`<strong>`, `<code>`); w innych przypadkach plain `t()`
6. **fallbackLng: false** zostaje — brakujący klucz EN pokaże klucz, nie maskuje PL
7. **PreconnectFM.jsx tłumaczone w miejscu** — żadnego wynoszenia komponentów do osobnych plików (to refaktor)
8. **db.js bilingualizujemy razem z odpowiednią Page*** — nie osobno

## Strategia łączenia z `db.js`

Dla każdego branchu P2-N: bilingualizacja `db.js` ograniczona do **funkcji wywoływanych z migrowanych Page***. Np.:
- P2-2 (Buyer) → `changeOwnPassword` + `updateOwnBuyerProfile` + `updateOwnSupplierProfile`
- P2-4 (Supplier offers) → `saveOffer` (jeśli ma user-facing throw)
- P2-5 (Finanse) → `createPayuOrder`, `saveCompanyContacts`, `generateCompanyDescriptionAI`
- P2-6 (Admin core) → `createBuyerAccount`, `adminUpdateBuyerAccount`, `validateBuyerAccountPayload`, `sendRetailerBatch`
- P2-6a (Admin Dash/Retailers/Firmy) → wybrane fragmenty admin operacji bez Pipeline
- P2-6b (Admin Pipeline) → moderacja + batch
- P2-7 (Admin extras bez czata) → `uploadBrandLogo`, `notifySupplier`, `promoteToAdmin`, `demoteFromAdmin`, `setSuperAdmin`
- P2-7b (Czat) → `suggestAdminChatReplyAI`
- P2-8/9 (FM) → `saveFm*` series (większość to dev sanity)

Razem: po zakończeniu P2-2 do P2-9 → **wszystkie 32 user-facing errors z `db.js` bilingual**.

## Strategia maili (P2-10)

**Wzorzec z Kroku 6** (`tplRegistrationAccepted` locale-aware):
- Caller (Netlify function lub `db.js`) przekazuje `payload.locale`
- `pickTemplate(name, payload)` dispatch'uje na `tpl<X>PL` albo `tpl<X>EN`
- Fallback do PL gdy `locale` brak/nieznane

**Skąd brać `locale`?**
- Dla maili wysyłanych z UI: `profile.locale` zalogowanego supplera (z context)
- Dla maili z webhooków/batch (Resend webhook, payu-notify): z DB `profiles.locale` dla user_id z payloadu
- Dla maili admin-facing (admin_new_registration): zostaje PL — adresat to zawsze zespół FM

## Strategia backend errors (P2-11, opcjonalne)

**Argumenty ZA wdrożeniem:**
- P0 RegisterSupplierPage w EN: anglojęzyczny user może zobaczyć `"Podaj poprawny adres email."` zamiast EN
- Profesjonalizm — pełny EN UX od ekranu do błędu backendu

**Argumenty PRZECIW:**
- 15+ functions × średnio 5-10 polskich error stringów = ~100 zmian
- Wymaga zmiany strategii callerów (przekazywanie `Accept-Language` header lub `payload.locale`)
- Częściowo rozwiązane przez `fallbackLng: false` po stronie frontu (jeśli backend zwracałby `error_code`, front mapuje na klucz)

**Decyzja:** zostawiamy do Codexa po zakończeniu P2-1 do P2-10.

## Szacunek wielkości całkowitej P2

| Branch | Pliki | Linie kodu | Stringów ~ | Ryzyko |
|---|---|---|---|---|
| P2-1 Setup | 4-5 | ~150 | 50-80 | ⚡ low |
| P2-2 Buyer | 1+JSON | ~900 | 250-400 | 🟡 med |
| P2-3 Supplier Dash | 1+JSON | ~500 | 150-200 | 🟡 med |
| P2-4 Supplier Offers | 1+JSON | ~1100 | 300-400 | 🟠 high |
| P2-5 Supplier Co/Finance | 1+JSON | ~800 | 200-300 | 🟡 med |
| **P2-6a Admin (Dash+Retailers+Firmy)** | 1+JSON | ~800 | 250-350 | 🟠 high |
| **P2-6b Admin Pipeline** | 1+JSON | ~700 | 150-250 | 🔴 very high |
| P2-7 Admin Extras (bez czata) | 1+JSON | ~700 | 200-300 | 🟡 med |
| **P2-7b Czat (Floating + Admin)** | 1+JSON | ~2000 | 200-300 | 🟠 high |
| P2-8 FM Participants | 1+JSON | ~1100 | 300-400 | 🟠 high |
| P2-9 FM Admin | 1+JSON | ~1400 | 400-600 | 🔴 very high |
| P2-10 Emails | ~8+JSON | ~600 | 8 templates × 2 = 16 wersji | 🟡 med |
| P2-11 Backend (ODŁOŻONE) | ~15+ | ~200 | 100+ | 🟠 high — decyzja po P2-10 |

**Łączny budżet:** ~10 866 linii do przejrzenia + nowe legacy.json ~2000 linii kluczy.

## Notes do dyskusji z Codexem

> **STATUS: ROZSTRZYGNIĘTE.** Wszystkie 5 pytań poniżej dostały BINDING decyzje — patrz sekcja "Decyzje Codexa (BINDING)" na górze dokumentu. Lista zostaje jako historyczny zapis pytań.

1. **Czy zachować jeden namespace `legacy` dla całego PreconnectFM** czy podzielić na `legacy.buyer`, `legacy.supplier`, `legacy.admin`, `legacy.fm`?
   - **Rekomendacja:** jeden `legacy.json` z sekcjami `buyer.*`, `supplier.*`, `admin.*`, `fm.*`, `common.*`. Łatwiej zarządzać, mniej duplikatów (np. `confirm_delete` może być reużywany).
   - **Decyzja Codexa:** ✅ jeden `legacy.json` z sekcjami `common`, `supplier`, `buyer`, `admin`, `fm`, `chat`, `errors` (dodane `chat` i `errors`).

2. **Czy P2-6 dzielić na 6a/6b?**
   - Admin Pipeline (6528) to ~700 linii i najbardziej krytyczna ścieżka. Rekomendacja: **TAK**, podział pomaga przy review Codexa.
   - **Decyzja Codexa:** ✅ TAK — P2-6a (Dash + Retailers + Firmy) + P2-6b (Pipeline).

3. **Czy P2-7 zawiera czat?**
   - Czat ma heavy state + threads + tooltips. Rekomendacja: **NIE**, czat dostaje osobny **P2-7b**.
   - **Decyzja Codexa:** ✅ NIE — czat jako osobny P2-7b.

4. **PL_DAYS / PL_MONTHS / PL_MONTHS_SHORT:**
   - Można użyć natywnego `Intl.DateTimeFormat(locale, ...)` zamiast hardcoded tablic. To **refaktor**, ale w pełni izolowany do funkcji formatowania dat. Decyzja do Codexa: refaktor czy zostawić tablice w obu językach?
   - **Decyzja Codexa:** ✅ NIE `Intl` — tablice EN obok PL, formatery wybierają wg `i18n.language`.

5. **Decyzja o P2-11 (backend errors)** — implementacja czy odłożenie?
   - **Decyzja Codexa:** ✅ ODŁOŻONE do decyzji po P2-10.

## Sugerowana kolejność wykonania

```
P2-1 (warm-up)
  ↓
P2-2 (Buyer — najprostszy duży panel)
  ↓
P2-3 (Supplier dashboard)
  ↓
P2-4 (Supplier offers — drugi największy)
  ↓
P2-5 (Supplier finance)
  ↓
P2-6a (Admin Dash + Retailers + Firmy)
  ↓
P2-6b (Admin Pipeline)
  ↓
P2-7 (Admin extras + branding + team — bez czata)
  ↓
P2-7b (Czat — osobny branch, BINDING decyzja)
  ↓
P2-8 (FM Buyer + Supplier)
  ↓
P2-9 (FM Admin — algorytm)
  ↓
P2-10 (Resend emails)
  ↓
P2-11 (Backend errors — opcjonalne, decyzja po P2-10)
```

Po każdym branchu: review Codexa → merge do `main` → smoke test produkcji → następny branch.

## Tagi pośrednie (sugestia)

- `v-i18n-p2-buyer` po P2-2
- `v-i18n-p2-supplier` po P2-5
- `v-i18n-p2-admin` po P2-7
- `v-i18n-p2-fm` po P2-9
- `v-i18n-p2-emails` po P2-10
- `v-i18n-p2-complete` po P2-10 (lub P2-11 jeśli zrobione)

Decyzja o tagach: do Codexa/Artura. Można nie tagować w trakcie, tylko `v-i18n-complete` na końcu.

## Czego ten plan NIE robi

- ❌ Nie zmienia ani jednej linii w `src/legacy/PreconnectFM.jsx`
- ❌ Nie zmienia ani jednej linii w `src/lib/db.js`
- ❌ Nie zmienia ani jednej linii w `netlify/functions/`
- ❌ Nie dodaje nowych namespace'ów i18n (tylko proponuje `legacy`)
- ❌ Nie wprowadza nowych dependencies
- ❌ Nie zmienia konfiguracji buildowej

To jest tylko **mapa terenu + propozycja kolejności**. Implementacja zaczyna się dopiero po akceptacji Codexa.
