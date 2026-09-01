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
