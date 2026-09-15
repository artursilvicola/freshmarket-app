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
