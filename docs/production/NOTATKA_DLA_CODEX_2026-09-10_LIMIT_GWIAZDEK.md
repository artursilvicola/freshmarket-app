# Do review — limit sieci głównych (⭐) z pakietów: minimum 5 vs limit 5 × N (10.09.2026)

Gałąź `fix/fm-stars-limit-ux` od `main` 2c2e2c0 (= produkcja d8a4b01 + docs). Wyłącznie frontend panelu dostawcy i widoków admina + teksty PL/EN. Bez zmian zapisu wyborów, algorytmu (`supplierCapacity` w `fm-algo.js`), migracji, RLS, danych firm. Nie wdrożone.

## Zgłoszenie

KRZYŚ-MAR (2 × Business, `fm_b2b_packages = 2`) mówi, że może wybrać tylko 5 sieci. Dane w bazie są poprawne (konto `agnieszka.p@…` → firma z 2 pakietami, `fm_b2b_enabled = true`, aktywna); limit w kodzie liczył się dobrze (10), ale interfejs po piątej ⭐ mówił „5/5”, „Gotowe ✓”, „Gotowe! 5 głównych sieci wybranych” i „max 5” — dostawca kończył na pięciu. To samo dotyczyło każdej firmy z >1 pakietem (przy 3 pakietach Chania i Agrocenter zatrzymały się na 10 z 15).

## Zmiana

- `src/lib/fm-stars.js` (nowy): `FM_STARS_MIN = 5` (minimum do potwierdzenia), `fmPackagesOf(company)` (1–5), `fmStarsMax(company)` = `FM_MAX_M × pakiety`, `fmStarsState(stars, max)` → `pending | min_reached | full`, `findSupplierCompany(companies, { accountId, fmId, legacySupplierId })` — dokładne `company_id` konta zawsze przed kluczami legacy (duplikat o podobnej nazwie nie może wygrać, gdy profil ma poprawne `company_id`).
- Panel dostawcy (`PageSupplierFM`):
  - licznik `{{count}}/{{max}}` (5/10 zamiast 5/5); kolor: bursztyn < min, morski min..max-1, zielony = max;
  - kafelek statusu: `⏳ Wybierz 5 sieci` → `Minimum ✓` z podpisem „możesz dodać jeszcze N ⭐” → `Gotowe ✓`;
  - zielony „Gotowe! {{max}} głównych sieci wybranych” tylko przy pełnej puli; po minimum z wolnymi ⭐ jeden niebieski komunikat: „Minimum osiągnięte — 5 wybranych, możesz już potwierdzić. Z pakietów (2 × Business) możesz wskazać łącznie 10 — dodaj jeszcze 5 ⭐, jeśli chcesz”; stary klucz `stars_remaining_hint` usunięty;
  - blok potwierdzenia: `Wybierz najpierw {{min}}` / `Możesz potwierdzić — albo dodać jeszcze {{count}} ⭐` / `Gotowe — kliknij Potwierdź wybór`; przycisk aktywny od minimum jak dotąd;
  - podpowiedź pod listą: `⭐ główna (min. 5, max {{max}} z Twoich pakietów)`; szóste kliknięcie przy 2 pakietach nadal daje ⭐, jedenaste 👍 (bez zmian logiki `toggle`).
- Admin: podgląd preferencji pokazuje `⭐5/10` na liście i `Główne sieci (5/10)` w szczegółach; gotowość (≥ 5) nazwana `FM_STARS_MIN` w pięciu miejscach (ta sama wartość); ostrzeżenie „ma min. 5 głównych sieci ale nie potwierdził”.
- Pasek pomocy na pulpicie dostawcy: „wybierasz 5 sieci głównych na każdy pakiet Business (min. 5)”.
- `PageSupplierFM` ma `export` (tylko na potrzeby testu renderu).

## Testy

- `src/lib/fm-stars.test.js` (6): przycięcie pakietów, limit 5/10/25, stany min/max, dokładne id przed legacy, brak firmy = 5.
- `src/legacy/FmStarsLimit.test.jsx` (8, react-test-renderer): 5 ⭐ przy 2 pakietach → 5/10, „minimum”, komunikat (min=5, count=5, max=10, packages=2), bez zielonego „Gotowe”, potwierdzenie dostępne; szóste kliknięcie = ⭐ przy 2 pakietach, 👍 przy 1; 10/10 → „Gotowe” z max=10, jedenaste = 👍; 4 ⭐ → potwierdzenie zablokowane; 1 pakiet 5/5 → od razu „Gotowe” bez komunikatu; duplikat firmy z 1 pakietem (nawet z tym samym kluczem legacy) nie obniża limitu; admin `⭐5/10` + nagłówek (5/10); teksty PL/EN mają `{{min}}`/`{{max}}`, stary klucz nie istnieje.

`npm test`: **132/132**. `npm run build`: OK. `git diff --check`: OK. Bez podglądu w przeglądarce — panel dostawcy wymaga zalogowanego konta dostawcy w fazie 2; renderowanie sprawdzone testami komponentu.

## Do decyzji (Artur)

1. Wdrożenie przed 16.09 (koniec wyborów) — osobny deploy, bez migracji, po review Codexa i osobnej zgodzie.
2. KRZYŚ-MAR: potwierdzić, że logują się na `agnieszka.p@…` (konto `d.przybyszewski@…` jest przy zawieszonej firmie „P.W. KRZYŚ-MAR” bez FM B2B); ewentualnie posprzątać duplikat — decyzja o danych po stronie Artura, bez zmian z tej gałęzi.
3. Po wdrożeniu krótka wiadomość do firm z >1 pakietem, które stanęły na 5 lub 10 ⭐ (lista z zapytania z 10.09: m.in. Chania, Agrocenter, Margoz, Nowalijka), że mogą dobrać sieci do końca wyborów.
