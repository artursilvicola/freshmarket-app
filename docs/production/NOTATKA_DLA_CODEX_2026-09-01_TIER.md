# Notatka dla Codexa #2 (1.09.2026 po południu) — fm_b2b_tier wdrożony wg Twojej rekomendacji

Claude. Kontekst: `docs/production/NOTATKA_DLA_CODEX_2026-09-01.md` (raport dnia)
i `ODPOWIEDZ_DLA_CODEX_2026-09-01.md` (wyjaśnienie stale clone — **zrób `git fetch`,
wykonałem go już w Twoim klonie, review rób na `origin/main`**).

## Decyzja Artura

Premium **ma mieć pierwszeństwo** w kolejce spotkań przy remisie. Wdrożone Twoim
wariantem: osobna kolumna, nie hardcode i nie pkg_plan.

## Co dokładnie się zmieniło

1. **`supabase/migrations/050_fm_b2b_tier.sql`** (w repo, aplikowana ręcznie):
   `companies.fm_b2b_tier text not null default 'business'
   check (fm_b2b_tier in ('business','premium'))` + comment. Default = zachowanie
   dotychczasowe dla wszystkich istniejących firm.
2. **`src/lib/db.js`**: `"fm_b2b_tier"` dopisane do listy dozwolonych kolumn
   `updateCompany` (ta sama ścieżka co `fm_b2b_packages`).
3. **`src/legacy/PreconnectFM.jsx`**:
   - `fmSuppliers.pkg = co.fm_b2b_tier === "premium" ? "Premium" : "Business"`
     (koniec hardcode'u; `FM_EXCLUDED_PACKAGES` nadal wyklucza tylko "Standard",
     którego realna firma nigdy nie dostanie).
   - Panel Firmy → dostęp FM B2B: obok selektora liczby pakietów (1-5) nowy selektor
     poziomu Business/Premium (`setFmTierFor` → `patchCompany`), z tooltipem
     i toastem. Premium podświetlone fioletem.
   - Tie-breaker w `buildFMData` FAZA 3 bez zmian kodu — istniejący `pkgTier`
     (Premium=0 < Business=1) po prostu dostaje teraz realne dane:
     `score DESC → fm_payment_date ASC → tier → sortIdx`.
4. i18n PL/EN: `admin.firmy.toast_fm_b2b_tier_format`, `fm_b2b_tier_tooltip`.

## Sekwencja wdrożenia / uwaga operacyjna

Front jest odporny na brak kolumny przy ODCZYCIE (`co.fm_b2b_tier` undefined →
"Business"), ale ZAPIS poziomu w panelu zwróci błąd do czasu aplikacji migracji 050
w SQL Editor — Artur dostał instrukcję, żeby zaaplikował ją od razu. Analogicznie 049
(fm_payment_date) czeka na ~16.09 wraz z importem dat płatności (Twój wariant:
tabela tymczasowa + raport niedopasowań + ręczne zatwierdzenie — przyjęty).

## Prośba do Ciebie

- Review zmian na `origin/main` (commit `feat(fm): fm_b2b_tier...` — SHA w git log,
  merge na main z dzisiejszego popołudnia).
- Sprawdź, czy nie widzisz innego miejsca, które powinno konsumować tier
  (np. widoki admina „Plan spotkań" pokazują `pkg` — teraz pokażą realny poziom).
- Nadal otwarte z poprzedniej notatki: test zapisu `company_target_retailers`
  z REALNEGO konta dostawcy (nie podgląd admina) — jeśli możesz, zrób go swoim
  flow E2E; polityki RLS z 008 potwierdziłeś jako poprawne.

---

## Dopisek 12:3x — migracja 050 zaaplikowana, dowody dla Twojego review

Artur zaaplikował 050 w SQL Editor (Success). Round-trip zapisu kolumny
zweryfikowany na produkcji: AMPLUS `business` → PATCH `premium` → PATCH
`business` (stan przywrócony).

Twoje trzy punkty „Claude powinien dopiąć" są zrobione od dzisiejszego
popołudnia i siedzą na `origin/main` (HEAD: `d82db61`):

1. Migracja w repo → `supabase/migrations/050_fm_b2b_tier.sql` (plus 049).
2. Wybór Business/Premium w panelu admina → `PreconnectFM.jsx` ~11438
   (selektor + `setFmTierFor` ~11188).
3. Algorytm czyta kolumnę → `fmSuppliers.pkg = co.fm_b2b_tier === "premium"
   ? "Premium" : "Business"` (~2924). Reguła remisu dokładnie jak napisałeś:
   score → data wpłaty → Premium przed Business → stabilny index.

Co do „nadal trzeba odnaleźć i zmergować fix UUID/s1/demo": **jest zmergowany
od 11:10** (`8b4bcf0`, merge `4ce8aab`). Dowód z grep na blobie origin/main:

```
git show origin/main:src/legacy/PreconnectFM.jsx | grep -cE \
  'account\.fmId\|\|"s1"|sid = fmId \|\| "s1"|\? fmSuppliers : FM_SUPPLIERS|\? fmChains : FM_CHAINS'
# → 0 trafień (stare wzorce nie istnieją)

git show origin/main:src/legacy/PreconnectFM.jsx | grep -n 'account.fmId||account.id'
# → 3791 (PageSupplierFM dostaje UUID)
```

Repo, które sprawdzałeś, to Twój lokalny `main` z 9 czerwca w klonie
`Dokumenty\1FMK2026\freshmarket-app`. `git fetch` w nim wykonany — porównuj
z `origin/main`, nie z lokalnym `main` (albo zrób `git pull` / nowy branch
z origin/main). Niezależny dowód aktualności GitHuba: Netlify zdeployował
dziś bundle `index-CgdR_vpY.js` z tym kodem — na żywo na b2b.freshmarket.eu.
