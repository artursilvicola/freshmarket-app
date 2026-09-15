# Do review — podgląd firmy przez kupca w module FM pokazywał ubogi fallback (15.09.2026)

Gałąź `fix/fm-buyer-preview-full` od `main` ec1fa1c (= produkcja 7626b4c + docs). Zmiana: **jedna funkcja** w panelu kupca (dopasowanie rekordu firmy). Bez migracji, RLS, zmian w bazie, bez nowych danych w UI. Nie wdrożone.

## Zgłoszenie (Artur, 15.09)

W „Spotkania FM 2026" kupiec klika **Podgląd** przy dostawcy i widzi prawie nic (nazwa, kraj, jedno zdanie „nazwa — produkty", znacznik Producent). W zakładce **Dostawcy → Zobacz profil** ta sama firma ma opis, kategorie, certyfikaty, rynki, materiały i kontakty. Kupcy decydują o spotkaniach na podstawie uboższego widoku.

## Diagnoza

Oba miejsca używają **tego samego** komponentu `CompanyPreviewModal` z `role="buyer"`. Różnica jest wyłącznie w obiekcie `co`:

- katalog (`PageBuyerCatalog`, linia ~7828) przekazuje pełny rekord z `companies`;
- moduł FM (`PageBuyerFM.openFirmPreview`, linia ~14110) szukał firmy tak:
  `companies.find(c => c.fmId === s.id || c.id === "sup-" + s.id)`.

Klucz firmy w module FM to `co.fmId || co.id`, a **żadna realna firma nie ma `legacy_fm_id`** (to pozostałość po seedach) — czyli `s.id` jest UUID-em, `c.fmId` jest `null`, a `"sup-<UUID>"` nie istnieje. Dopasowanie nigdy nie trafiało dla realnych firm → zawsze szedł fallback:
`{ name, country, description: "<nazwa> — <produkty>", types:["producent"], contacts:[], certs:[] }`.
To dokładnie to, co widać na zrzucie („Adam Gabler Ferment Garlic — Czarny czosnek…", brak HACCP/GHP/GMP, które firma ma w katalogu).

## Zmiana

`openFirmPreview` używa istniejącego helpera `findSupplierCompany` (`src/lib/fm-stars.js`, już zaimportowany w pliku): dokładne `company_id` (`s.companyId || s.id`) → klucze legacy (`fmId`, `legacy_fm_id`, `id`) → `legacy_supplier_id` (`sup-<id>`). Fallback zostaje bez zmian dla firm spoza `companies` (seed/demo).

**Zakres danych się nie zmienia** — kupiec widzi w module FM dokładnie to, co dziś widzi w zakładce „Dostawcy" (ten sam komponent, ta sama rola, ten sam rekord). Nie dokładamy żadnego pola, nie ruszamy RLS ani zapytań. Dotyczy obu podglądów w panelu kupca (faza 1–2 „Dostawcy, którzy wybrali Twoją sieć" oraz faza 4+ lista spotkań).

## Testy

`src/legacy/FmBuyerPreview.test.jsx` (3, react-test-renderer): klik „Podgląd" → modal zawiera opis firmy, certyfikaty (HACCP/GHP), wolumeny z `profile_data.trade` i kontakt, a fallback („nazwa — produkty") **nie** występuje; firma spoza `companies` nadal otwiera podgląd (fallback, bez wywrotki); dopasowanie po `companyId`, gdy klucz FM to legacy `fmId`.

`npm test` **148/148**, `npm run build` OK, `git diff --check` OK. Bez podglądu w przeglądarce (wymaga zalogowanego konta kupca) — render sprawdzony testem, a komponent jest identyczny z tym z katalogu, który działa na produkcji.

## Do decyzji

Wdrożenie dziś (osobny deploy, bez migracji) — wybory kupców trwają do **16.09 23:59**, więc pełny profil jest przydatny właśnie teraz. Po wdrożeniu wystarczy odświeżyć panel kupca.

---

## Uzupełnienie po review Codexa (15.09, commit 2)

Dołączony patch Codexa (`fm-buyer-preview-2026-09-15-followup.patch`, zastosowany czysto na `73ab36e`): oba wywołania modala w `PageBuyerFM` dostają `buyerRetailerId={resolveRetailerIdFromChain(chainId, retailers)}` zamiast `CHAIN_TO_RETAILER[chainId]||null`. Helper jest już używany w tym samym komponencie przy zapisie odpowiedzi kupca (linie 14048/14063/14085) i zachowuje starą mapę jako drugi krok, więc niczego nie odbiera.

**Weryfikacja tezy — problem jest szerszy, niż zakładała notatka.** Statyczna `CHAIN_TO_RETAILER` ma 27 kluczy i brakuje w niej m.in.: `ch39` (Biedronka), `umaigroup26` (Umai), `ch36` (Makro), `ch31` (Rohlik), `ch41` (Albert CZ), `ch35` (Mega Image), `ch38` (Fantastico), `ch44` (PROMO), `ch46` (AIBĖ). Z 13 sprawdzonych sieci mapa zna tylko 5 (`ch2` Auchan, `ch9` Carrefour, `ch11` Dino, `ch19` Stokrotka + pozostałe stare). Czyli kupcy większości sieci widzieli w podglądzie „Brak przypisanej sieci detalicznej" i nie widzieli własnych propozycji — także ci z 12 sieci wpisanych 15.09 dla „Orange for Agricultural Crops".

Testy Codexa (5) sprawdzają: Biedronka i Umai w fazach 2 i 4 (własna oferta widoczna, oferta innej sieci ukryta, sekcja operatora konta ukryta, otwarcie podglądu nie zapisuje odpowiedzi kupca) oraz nierozpoznaną sieć (oferty nadal ukryte).

`npm test` **153/153**, `npm run build` OK, `git diff --check` OK.
