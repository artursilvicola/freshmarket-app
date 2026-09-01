# Notatka dla Codexa — zmiany z 1.09.2026 + prośba o drugą opinię

Autor: Claude (sesja z Arturem), 1 września 2026.
Wszystko poniżej jest **zmergowane do `main` i wdrożone na produkcję** (b2b.freshmarket.eu).

---

## 1. Co zostało dzisiaj zrobione

### A. KRYTYCZNE — moduł spotkań B2B FM 2026 pracował na danych demo (commit `8b4bcf0`, merge `4ce8aab`)

Stan zastany na produkcji (wykryty dziś przed południem):

1. `fmSuppliers` filtrował firmy po `co.fmId` (= `legacy_fm_id`). **Żadna realna firma nie ma
   `legacy_fm_id`** → lista pusta → `buildFMData` po cichu podstawiał `FM_SUPPLIERS`
   (30 zaszytych firm demo: UNICA GROUP, Hazera, Bayer…). Admin widział w „Dane wejściowe"
   30 widm zamiast realnych uczestników.
2. `PageSupplierFM` dostawał `fmId={account.fmId||"s1"}` → każdy realny dostawca pracował
   pod widmowym id `"s1"` → zapis wyborów sieci szukał firmy `"s1"`, nie znajdował jej
   i **po cichu nie zapisywał nic** (`company_target_retailers` = 0 wierszy mimo otwartej
   fazy preferencji).
3. Mapping pakietów `co.pkg === "prem_10" ? "Premium" : "Standard"` + `FM_EXCLUDED_PACKAGES
   = {"Standard"}` wykluczyłby z algorytmu **wszystkie 58 firm dopuszczonych do FM** —
   bo `pkg_plan` (std_5/std_1) to pakiet KREDYTÓW PreConnect, nie pakiet eventowy.

Wprowadzone zmiany (`src/legacy/PreconnectFM.jsx`):

- `fmSuppliers`: filtr `co.fm_b2b_enabled === true && (co.account_status||"active")==="active"`,
  id = `co.fmId || co.id` (czyli w praktyce **UUID firmy**), `pkg: "Business"` na sztywno
  (uczestnictwo w FM B2B determinuje flaga admina + `fm_b2b_packages`, nie pkg_plan).
- Usunięte **wszystkie** fallbacki `...length>0 ? x : FM_SUPPLIERS/FM_CHAINS` (buildFMData
  + 6 widoków + 2 karty statusu na dashboardzie admina). Pusta lista = pusty stan, nie demo.
- Routing: `PageSupplierFM fmId={account.fmId||account.id}`, `PageBuyerFM chainId` z realnego
  `retailers.find(...).fm26ChainId` zamiast statycznej mapy `RETAILER_TO_CHAIN`/`"ch5"`.
- `sid = fmId` w PageSupplierFM (bez twardego `"s1"`).
- Merge-konflikt z równoległym usunięciem `onFMRegenerate` na main rozwiązany na korzyść
  usunięcia (randomizera demo nie ma już wcale — zgodnie z intencją obu stron).

**Weryfikacja na produkcji** (podgląd admina jako Ewa-Bis, klik w TOPAZ, odczyt REST po
każdym kliku): ⭐ → wiersz `priority=1000, retailer_id=121, note=chain:Topazfn1`;
👍 → `priority=100`; usuń → tabela pusta. „Dane wejściowe" pokazują 0/58 realnych firm
i 0/20 sieci; zero nazw demo.

### B. Incydent danych — 4 firmy straciły dzisiejsze wybory

Margoz S.L. (9:10), Mersel Foods (9:11), KlarySad (9:44), AMPLUS (10:08) potwierdziły wybór
**przed** deployem poprawki (~10:57). Ich kliknięcia przepadły (stary kod), zapisał się tylko
`fm_selection_confirmed_at` (idzie osobną, sprawną ścieżką po companyId). Zrobione:
wyczyszczone `fm_selection_confirmed_at` u tej czwórki (PATCH po UUID; wcześniej sprawdzone,
że żadna nie zdążyła wybrać ponownie — 0 wierszy w `company_target_retailers`). Artur wysyła
im prośbę o powtórny wybór (szablony PL/EN dostał).

### C. Sponsorzy w stopce + sekcja w Brandingu (commity `99038ef`, `c7dc8d8`, `0820dc2`)

- Nowy `src/components/PartnersStrip.jsx` — pasek „SPONSORZY FRESH MARKET 2026" nad
  `LegalFooter` we wszystkich 3 panelach. Dane z `fm_settings.ui_content.partners`
  (ta sama kolumna JSONB co instrukcje/komunikaty — **bez nowej migracji**).
- `db.js`: `partners` w `emptyUiContent`/`normalizeUiContent` + `uploadPartnerLogo()`
  (bucket `brand-assets`, ścieżka `partners/`).
- Branding → sekcja **Sponsorzy**: upload logo, nazwa, URL (opcjonalny), on/off,
  kolejność (strzałki), podgląd stopki. Zapis przez wspólny „Zapisz treści".
- Wgrane i opublikowane logotypy Tekasya + Redpack (z plików wektorowych, 120 px PNG).
- URL-e sponsorów **celowo puste** — Artur uzupełni w panelu.

### D. Pozostałe

- `docs/marketing/ONBOARDING_KUPIEC_EMAILE.md` — szablony maili powitalnych dla kupca
  (wariant: uczestnik FM 2026 / tylko PreConnect).
- Wcześniej tego dnia (poprzednia sesja, już na main): naprawa uploadera materiałów
  (`7841176`, `a989b57`) + autosave materiałów po wgraniu.

---

## 2. PROŚBA O DRUGĄ OPINIĘ (konkretne punkty)

1. **`pkg: "Business"` na sztywno dla wszystkich firm FM-enabled.** Uzasadnienie: o udziale
   decyduje `fm_b2b_enabled` + `fm_b2b_packages`, a `FM_EXCLUDED_PACKAGES` wyklucza tylko
   "Standard". Czy widzisz miejsce, gdzie tier "Premium" vs "Business" ma jeszcze realne
   znaczenie (poza `pkgTier` w tie-breakerze FAZY 3, który przy jednolitym "Business" jest
   neutralny)? Jeśli Premium ma dawać pierwszeństwo — skąd brać tę informację (nowa kolumna?
   `fm_b2b_packages` >= X?).
2. **UUID jako klucz modułu FM** (`id = co.fmId || co.id`). Przejrzyj, czy nie został żaden
   kod zakładający format `"sN"` — ja wyczyściłem routing, zapisy i widoki, ale druga para
   oczu mile widziana (grep po `"s1"`, `sup-`, `RETAILER_TO_CHAIN`, `CHAIN_TO_RETAILER`).
   Uwaga: `fm.buyer` zapisuje `meta.supplier_legacy_id = sid` (teraz UUID) — nazwa pola
   myląca, ale zgodna wstecz; odczyt honoruje ją w pierwszej kolejności.
3. **Usunięcie fallbacków demo.** Czy jakiś flow dev/staging na tym polegał? `genFMData`
   zostało (martwy kod poza `_fmInitData`/`resetToSeed`, oba nieaktywne na PROD).
4. **Tie-breaker daty płatności — patrz sekcja 3.** Oceń proponowany projekt.
5. **Sanity-check RLS**: zapisy `company_target_retailers` robi dostawca po swoim
   `company_id` (a admin w podglądzie przez własne uprawnienia). Upewnij się, że polityki
   pozwalają dostawcy pisać wyłącznie własne wiersze — dzisiejszy test szedł z sesji admina.

---

## 3. Tie-breaker „kto wcześniej zapłacił" — przygotowanie pod import (~16.09)

Stan: `buildFMData` FAZA 3 sortuje `score DESC → paymentDate ASC → pkgTier → sortIdx`.
Realne firmy nie miały ŻADNEJ daty → wszystkie `"9999-99-99"` → o remisach decydowała
kolejność wczytania z bazy. Merytorycznie złe (kolejność wpłat = obietnica biznesowa).

Co już przygotowałem (żeby 16.09 została tylko wgrywka):

- **`supabase/migrations/049_fm_payment_date.sql`** (w repo, NIEZAAPLIKOWANA — migracje
  aplikujemy ręcznie w Supabase SQL Editor): `companies.fm_payment_date date` + komentarz
  + szablon UPDATE'ów importu + kwerenda kontrolna.
- **Front już czyta kolumnę**: `fmSuppliers.paymentDate = co.fm_payment_date ||
  co.paymentDate || co.paidAt || null` (wdrożone; brak kolumny = undefined = zachowanie
  dotychczasowe, więc kolejność deploy/migracja obojętna).

Plan na ~16.09, gdy Artur przyśle listę firm z datami:

1. Zaaplikować `049` w SQL Editor.
2. Import: dopasowanie nazwa→UUID (`ilike`), dla niedopasowanych ręczna decyzja;
   wypisać raport: ile zaktualizowane / które bez dopasowania / które FM-enabled bez daty.
3. Kontrola: `select name, fm_payment_date from companies where fm_b2b_enabled order by
   fm_payment_date nulls last` — Artur potwierdza kolejność przed uruchomieniem algorytmu
   (algorytm i korekty: 17–21.09, publikacja planu 22.09).

Pytanie do Ciebie: czy wolisz import przez UPDATE'y w SQL Editor (najprościej, audytowalne),
czy jednorazowy skrypt Node z service-role (lepszy raport niedopasowań)? Format wejścia od
Artura będzie luźny (prawdopodobnie tabela nazwa+data z księgowości), więc dopasowanie nazw
i tak wymaga przeglądu człowieka.

---

## 4. Rzeczy otwarte / do pilnowania

- 4 firmy z sekcji B muszą powtórzyć wybory (Artur informuje mailowo).
- `fm_resps` (odpowiedzi kupców) — 0 wierszy; zacznie się zapełniać, gdy kupcy zaczną
  klikać. Ścieżka zapisu przetestowana logicznie, ale warto zerknąć po pierwszym realnym.
- URL-e sponsorów w Brandingu do uzupełnienia (Artur).
- Regulamin §7.1 (Premium-only vs Business+Premium w kodzie) — wciąż decyzja biznesowa.
