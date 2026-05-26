# P2-4 supplier offers + submissions — audit (FAZA A)

**Status:** audit only, **zero zmian w kodzie**. Czeka na review Codexa zanim implementacja FAZA B.

Branch: `feat/i18n-p2-4-supplier-offers-audit` · Baseline: `main` po merge P2-3bc (commit `ace7ce2`).

## Cel audytu

Po cyklu P2-3 (cały supplier dashboard zakończony) ruszamy w **offers + submissions** — najbardziej rozbudowany funkcjonalnie obszar supplier flow (formularz tworzenia propozycji, lista propozycji, lista wysyłek do retailerów).

Audyt ma odpowiedzieć na 4 pytania:
1. Które komponenty są **supplier-only** (bezpieczne do bilingualizacji w jednym branchu)?
2. Które są **shared** z buyer/admin/FM (wymagają osobnego shared branch — analogicznie do `OfferPreviewModal`/`CompanyPreviewModal`)?
3. Jaka jest orientacyjna **liczba stringów** per komponent?
4. Jak podzielić P2-4 na rozsądne **2-3 commity** (większy branch z logicznymi commitami, w stylu P2-3bc)?

## Metodologia

Grep wszystkich nazw komponentów z planu P2-4:
```
PageOffers, PageOfferForm, PageWysylki, OfferFilters, TrackingBar
```

Plus dodatkowo wewnątrz każdego komponentu — szukam wzmianek o:
- `<OfferPreviewModal />` (shared, odłożony do shared-modals branch)
- `<CompanyPreviewModal />` (shared)
- inne shared modale lub komponenty wspólne

## Wyniki audytu — call site classification

### Główne komponenty P2-4

| Komponent | Linia (def) | Liczba call sites | Lokalizacja callsite | Klasyfikacja |
|---|---|---|---|---|
| `PageOffers` | 4598 | 1 | `App()` render switch, linia 2981 (`pg==="offers"`) | **Supplier-only** — admin/buyer nie renderują tej strony |
| `PageOfferForm` | 4697 | 3 | `App()` linie 2982-2984 (create / edit / copy) | **Supplier-only** — wszystkie 3 page modes (offer-create, offer-edit, offer-copy) są dla supplera |
| `PageWysylki` | 3942 | 1 | `App()` linia 2980 (`pg==="wysylki"`) | **Supplier-only** |
| `OfferFilters` | 637 | 2 | `PageOffers` (supplier) + **`PageBuyerOffers` linia 5822 (buyer, już zmigrowany w P2-2b)** | ⚠️ **SHARED** (supplier + buyer) — analogiczne ryzyko jak `OfferPreviewModal` |
| `TrackingBar` | 628 | **0** call sites | Tylko wzmianka w komentarzu w PageBuyerDetail (linia 6841): `{/* TrackingBar only here in detail – not on list */}` | **DEAD CODE** — funkcja zdefiniowana, ale nigdzie nie wywołana |

### Wzmianka o shared components używanych wewnątrz P2-4

W trakcie audytu nie znaleziono call site'ów `<OfferPreviewModal />` ani `<CompanyPreviewModal />` w PageOfferForm / PageWysylki — sprawdzę dokładniej w FAZIE B, ale wstępnie wygląda na to że supplier offers/submissions flow **nie wywołuje shared modali** bezpośrednio. Preview modali używa **buyer flow** (PageBuyerDetail) i **admin pipeline**.

Dla pewności w FAZIE B przed Edit'ami dla każdego z 3 komponentów zrobię osobny grep.

## Rozmiary i estymacja stringów

| Komponent | Linie kodu (JSX) | Estymacja stringów PL | Powód |
|---|---|---|---|
| `PageOffers` | ~100 | **~25-35** | Header, lista propozycji, "Moje propozycje asortymentowe", description, status badges (Opublikowana/Szkic/Premium), Edytuj/Duplikuj/Wyślij/Usuń buttons, "Tylko Ty"/"Dla kupca" badges, sieci/przeczytane counts labels, delete modal (header, body, Anuluj/Tak,usuń), tooltips |
| `PageOfferForm` | ~499 | **~120-180** | **NAJWIĘKSZY** komponent supplier flow. 3-step form: identyfikacja produktu + szczegóły + zdjęcia/certyfikaty/finalize. Każda sekcja ma ~10-20 field labels + hints + validation messages + section headers. Plus header/breadcrumb, save buttons (Zapisz szkic / Opublikuj / Podgląd), confirmation flow |
| `PageWysylki` | ~344 | **~60-90** | Lista wysyłek do sieci. 3 widoki (sieci / new / list), tabs (all/sent/queued/etc), filtrowanie, akcje wysyłki, status badges, retailer cards, plurality dla "X wysłanych do Y sieci" |
| `OfferFilters` (shared, odłożone) | ~25 | ~15 | Header "Filtry"/"Aktywne"/"Wyczyść", 5 select labels (Kategoria/Kraj/Certyfikat/Opakowanie/Wolumen), "Wszystkie", "Ciekawe" |
| `TrackingBar` (dead code) | ~6 | 4 | "Tracking 14 dni", "✅ Potwierdzona", "{daysLeft} dni", "⚠ Wygasła" |
| **RAZEM P2-4 supplier-only** | **~943** | **~205-305** | (bez OfferFilters i TrackingBar) |

## Decyzje scope

### ✅ `PageOffers` + `PageOfferForm` + `PageWysylki` — IN scope P2-4

Wszystkie 3 są **supplier-only**. Bezpieczne do bilingualizacji w P2-4. Brak ryzyka shared component.

### ⚠️ `OfferFilters` — OUT of P2-4, do shared branch

OfferFilters jest używany w:
- `PageOffers` (supplier, P2-4)
- `PageBuyerOffers` (buyer, już zmigrowane w P2-2b — ale OfferFilters tam też pozostał PL bo Codex zatrzymał OfferFilters wcześniej)

Globalne tłumaczenie OfferFilters w branchu "supplier offers" **powtórzyłoby błąd** z OfferPreviewModal/CompanyPreviewModal scope bug.

**Decyzja:** OfferFilters dołącza do listy shared komponentów dla osobnego branchu `feat/i18n-p2-shared-controls` lub `feat/i18n-p2-shared-modals` (razem z OfferPreviewModal + CompanyPreviewModal):
- `OfferFilters` (shared supplier + buyer)
- `OfferPreviewModal` (shared supplier + admin + buyer)
- `CompanyPreviewModal` (shared supplier + buyer + admin + FM)

Konsekwencja dla EN supplier (P2-4) i EN buyer (P2-2b — już merged):
- Lista propozycji ma EN header + EN buttons, ale **filtry OfferFilters po PL** dopóki shared branch nie wjedzie. Akceptowalne — pasek filtrów to dodatkowy widget, nie blocker.

### 🗑 `TrackingBar` — DEAD CODE, do osobnej decyzji

`TrackingBar` jest **zdefiniowany ale nigdzie nie wywołany**. Wzmianka tylko w komentarzu PageBuyerDetail (linia 6841): `{/* TrackingBar only here in detail – not on list */}`. To wygląda na "planowane do wstawienia, ale jeszcze nie wstawione".

**Decyzja:** w P2-4 **nie tłumaczyć** TrackingBar — to martwy kod. Po zakończeniu P2 (lub osobno) warto rozważyć:
- A) usunąć TrackingBar jako dead code (cleanup), albo
- B) wstawić go w docelowym miejscu w PageBuyerDetail i wtedy bilingualizować

To nie jest temat dla i18n branchu — decyzja produktowa, nie tłumaczeniowa.

## Propozycja podziału P2-4

Codex zasugerował 3 partie w stylu P2-3bc (większy branch z 2-3 logicznymi commitami) **lub** osobne branche.

### Wariant A (rekomendowany): **1 branch, 3 commity** — `feat/i18n-p2-4-supplier-offers`

Analogicznie do P2-3bc, jeden branch z 3 logicznymi commitami:

```
Commit 1 (P2-4a): PageOffers — lista propozycji supplier
  - ~25-35 stringów
  - Header, action buttons, status badges, delete modal
  - Ryzyko: ⚡ low (samowystarczalny widok)

Commit 2 (P2-4b): PageOfferForm — formularz tworzenia/edycji
  - ~120-180 stringów (NAJWIĘKSZY)
  - 3-step form, sekcje, field labels, hints, validation, save flow
  - Ryzyko: 🟠 high — najwięcej stringów + złożona logika formularza
  - Wewnątrz: użycie PhotoUploader (już bilingual z P0/P1) + SimplePhotoUploader (też bilingual)

Commit 3 (P2-4c): PageWysylki — lista wysyłek do sieci
  - ~60-90 stringów
  - 3 widoki (sieci/new/list), tabs, status badges, plurals dla counts
  - Ryzyko: 🟡 medium — większy niż PageOffers, mniejszy niż PageOfferForm
```

### Wariant B: **3 osobne branche** — `feat/i18n-p2-4a/4b/4c-...`

Jeśli Codex woli mniejsze paczki do review:
- `feat/i18n-p2-4a-supplier-offers-list`
- `feat/i18n-p2-4b-supplier-offer-form`
- `feat/i18n-p2-4c-supplier-wysylki`

### Rekomendacja: Wariant A

Codex wcześniej zaakceptował styl P2-3bc ("większy branch z 2-3 logicznymi commitami"). P2-4 ma podobną wielkość — 3 supplier-only komponenty łącznie ~205-305 stringów. Idziemy tym samym wzorcem.

**Jeśli Commit 2 (PageOfferForm) okaże się za duży / build padnie / kontekst nie wystarczy**, zatrzymujemy branch po Commit 1 (PageOffers) i Codex decyduje co dalej.

## Kolejność wykonania (sugerowana)

```
Commit 1: PageOffers (warm-up, low risk)
  ↓ build sanity
Commit 2: PageOfferForm (najtrudniejszy)
  ↓ build sanity
Commit 3: PageWysylki
  ↓ final build + symmetry + diff scope
Push branch
```

## Zakaz dla P2-4 (proponowany)

- ❌ Bez `OfferFilters` (shared supplier + buyer — osobny branch later)
- ❌ Bez `TrackingBar` (dead code — decyzja produktowa, nie i18n)
- ❌ Bez `OfferPreviewModal` / `CompanyPreviewModal` (shared, czekają)
- ❌ Bez `PageCompany` / `PageFinanse*` (P2-5)
- ❌ Bez `PageSupplierProfile` (P2-5 lub osobno)
- ❌ Bez Admin / FM / chat
- ❌ Bez maili / Netlify functions / migracji
- ❌ Bez `db.js` poza opcjonalnym 1-2 errorami z `saveOffer` (jeśli ma user-facing throw używany przez PageOfferForm — sprawdzę przy implementacji)
- ❌ Bez refaktoru struktury JSX poza minimalnymi zmianami dla `<Trans>` markupu

## Pytania otwarte do Codex

1. **Wariant A czy B** — 1 branch z 3 commitami czy 3 osobne branche? Rekomendacja: A.

2. **`OfferFilters` i `TrackingBar`** — potwierdzam decyzję że oba zostają poza P2-4? OfferFilters → shared branch later. TrackingBar → decyzja produktowa.

3. **`PageOfferForm` rozmiar** — czy estymacja 120-180 stringów jest akceptowalna jako jeden commit? Jeśli okaże się w trakcie że to >200 stringów, czy mam podzielić na 2 mniejsze commity (np. step 1+2 / step 3)?

4. **`db.js` errors w P2-4** — czy bilingualizujemy razem z PageOfferForm jeśli `saveOffer` lub inna funkcja używana w formularzu ma user-facing throw, czy zostawiamy na osobny branch backend errors?

## Statystyki audytu

- Plików zmienionych: **1** (nowy `docs/i18n/P2_4_SUPPLIER_OFFERS_AUDIT.md`)
- Komponenty zaaudytowane: **5** (PageOffers, PageOfferForm, PageWysylki, OfferFilters, TrackingBar)
- Komponenty supplier-only: **3** ✅
- Komponenty shared: **1** ⚠️ (OfferFilters)
- Komponenty dead code: **1** 🗑 (TrackingBar)
- Estymacja stringów w P2-4 supplier-only: **~205-305**

## Czego ten dokument NIE robi

- ❌ Nie zmienia ani jednej linii w `src/legacy/PreconnectFM.jsx`
- ❌ Nie zmienia ani jednej linii w `src/i18n/{pl,en}/legacy.json`
- ❌ Nie zmienia ani jednej linii w `db.js`
- ❌ Tylko nowy plik audit doc

Implementacja zaczyna się dopiero po akceptacji Codexa decyzji na 4 pytania otwarte powyżej.
