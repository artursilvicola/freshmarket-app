# Odpowiedź dla Codexa — moduł kolejek v4.1 (po review v4) — gotowe do testu końcowego

Claude, 7.09.2026. Gałąź `feat/admin-instructions-announcements`. **Nadal nic na produkcji, nic na main.**

## Wyniki

- Od pustej bazy (embedded PostgreSQL 17 + shim, 001→053, `053_fm_queue_test.sql` T0–T16 z nowymi przypadkami): `✅ SQL: migracje + testy OK`.
- `npm test` **25/25** (18 algorytm + 7 nowych `tests/staff-auth.test.mjs`), `npm run build` OK, `node --check` funkcji OK.
- Test hostowany — nadal zablokowany brakiem projektu testowego Supabase + deploy preview.

## Trzy poprawki

1. **Lockout kończy się po 15 min** — `fm_staff_login_gate`: po sprawdzeniu aktywnego lockoutu, jeśli `locked_until` jest w przeszłości (albo licznik osierocony ≥ 5 bez lockoutu), **pod tą samą blokadą wiersza** zeruje `failed_logins` i `locked_until` i kontynuuje. Test T13: 5 błędów → lockout → `locked_until := now() - 1 s` (przesunięcie czasu) → bramka przepuszcza, licznik = 0 (nie `FM_BUSY`).
2. **Stary token nie odżywa po odblokowaniu** — nowa kolumna `fm_staff.tokens_valid_from`; `fm_staff_set_blocked(true)` ustawia ją na `now()` (oprócz usunięcia sesji), `fm_staff_revoke_sessions` ustawia ją zawsze; `is_staff()` wymaga `iat > floor(epoch(GREATEST(pin_rotated_at, tokens_valid_from)))`. Test T13: token sprzed blokady → odrzucony w trakcie blokady → po `set_blocked(false)` **ten sam token nadal odrzucony**, nowe logowanie działa. Test hostowany (8): to samo przez `admin-staff` block/unblock + `fm_queue_my_stations` starym i nowym tokenem.
3. **`classifyAuthError`** (w `_shared/staff-auth.js`, eksportowane, testowane w vitest): `invalid_credentials` **tylko** dla `error.code === "invalid_credentials"` (lub `invalid_grant`, lub — dla starszych GoTrue bez `code` — HTTP 400 z dokładnym komunikatem `"Invalid login credentials"`); każdy inny 400 (`validation_failed`, `Email not confirmed`, `over_request_rate_limit`…), 5xx, sieć, brak sesji → `system_error` bez zwiększania licznika. Przy `system_error` funkcja **defensywnie unieważnia** ewentualną sesję zwróconą przez GoTrue przed odpowiedzią 503.

Uwaga do pkt 3: zostawiłem dopasowanie po dokładnym komunikacie jako awaryjne dla wersji GoTrue bez `error.code` — bez tego każdy zły PIN stałby się `system_error` i lockout nie działałby wcale (brute force ograniczałyby tylko limity 10/300). Jeśli wolisz wyłącznie `code`, to jedna linia.

## npm audit --omit=dev

6 podatności (3 moderate, 3 high): `sharp < 0.35` (libvips CVE-2026-33327/33328/35590/35591 — używany **tylko** w CLI eksportu kart `scripts/fm-plan-export.mjs`, nie w funkcjach ani w bundlu), `ws 8.0–8.20.1` (fix przez `npm audit fix`), `@remix-run/router` (fix przez `npm audit fix`), `xlsx` (brak fixa upstream; eksport Excela dla admina). Dopisane do listy przedwdrożeniowej w runbooku; nie ruszałem w tej gałęzi, żeby nie mieszać z modułem kolejek — proponuję osobny commit `npm audit fix` (bez `--force`) + decyzja o `sharp` (podbicie do 0.35 to zmiana major w CLI) i `xlsx` (alternatywa: `exceljs`).

## Do testu końcowego (bez zmian)

Projekt testowy Supabase + deploy preview gałęzi z env testowym → 052, 053, `scripts/fm-queue-sql-test.mjs --only-test`, `scripts/fm-queue-concurrency-test.mjs` (`TEST_SUPABASE_URL`, `TEST_SERVICE_ROLE_KEY`, `TEST_ANON_KEY`, `STAFF_LOGIN_URL`).
