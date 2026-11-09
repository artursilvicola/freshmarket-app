# Aktywność — plan wdrożenia produkcyjnego (przygotowany 9.11.2026)

**Status: PRZYGOTOWANE, NIEWYKONANE.** Start dopiero po „wdrażaj” Artura.
Kod: gałąź `feat/admin-activity`, odebrany niezależnie przez Codexa na `de7a63e` (36/36). Commit z tym planem zmienia tylko `docs/` — kod i migracja są identyczne z `de7a63e`.
Projekt Supabase: **`sklyfuvzjikkqerxtulo`** — sprawdzić w adresie SQL Editora przed **każdym** Run.

## Stan wyjściowy (odczyt 9.11, tylko do odczytu)

| Element | Wartość |
|---|---|
| Produkcja (`/version.json`) | `fa3dd0b`, deploy Netlify `6aeef6d2ffaecdbf9dbafc89` (= punkt wycofania frontu) |
| `main` → gałąź | `fa3dd0b` → `de7a63e`, fast-forward możliwy |
| Flagi zakładki w Netlify (production) | `VITE_ADMIN_ACTIVITY`, `VITE_APP_ACTIVITY_LOG` — **brak** |
| Wysyłka marketingowa | `MARKETING_SEND_ENABLED=false`, `MARKETING_SEND_ALLOWLIST` = 2 adresy — **bez zmian w tym wdrożeniu** |

## Kolejność

| # | Krok | Kto | Oczekiwany wynik / warunek przejścia |
|---|---|---|---|
| P | `06-kontrola-przed-wdrozeniem.sql` (odczyt) | Artur: Run | rola `postgres`; `pg_cron` z wersją; `app_visits`, `app_activity_settings`, `record_app_visit` = puste (NULL); tabele rejestrów i `is_admin()` obecne; 0 zadań retencji. **pg_cron pusty → STOP** (krok 2 nie zadziała). |
| 1 | Migracja `supabase/migrations/20261109120000_app_activity.sql` | Artur: Run | bez błędu; `select enabled from public.app_activity_settings` → `false` |
| 2 | `02-harmonogram-retencji.sql` | Artur: Run | jedno aktywne zadanie `fm-app-activity-retention`, `postgres/postgres`; funkcje modułu właściciela `postgres`, `purge_app_visits` i `app_activity_event_rows` tylko `postgres` |
| 3a | Tag wycofania `prod-rollback-2026-11-09-activity` = `fa3dd0b` | Claude | tag na zdalnym repo |
| 3b | Netlify (production, build): `VITE_ADMIN_ACTIVITY=true`, `VITE_APP_ACTIVITY_LOG=true` | Claude | `env:list` pokazuje obie; `MARKETING_SEND_ENABLED` i allowlista **niezmienione** |
| 3c | `main` ← fast-forward do gałęzi, push → build Netlify | Claude | deploy `ready`; `/version.json` = nowy commit; w bundlu jest zakładka; 403 `send_disabled` przy próbie wysyłki marketingowej (jak dotąd) |
| K | `07-kontrola-przed-wlaczeniem.sql` + przegląd zakładki | Artur: Run; Claude: panel | `enabled=false`, 0 wizyt, zadanie retencji aktywne; bezpośrednie RPC → `disabled`; zakładka widoczna u admina z napisem „Zapis wejść jest wyłączony w bazie”; brak zakładki u dostawcy/kupca |
| 4 | `03-wlaczenie-zapisu.sql` — **dopiero po zaliczonym K** | Artur: Run | `enabled=true`, `retention_jobs=1`, `visits=0` |
| 5 | Kontrola po włączeniu `05-kontrola-po-wdrozeniu.sql` + czynności § 7a (00-CZYTAJ) | Artur (logowanie kontem testowym kupca, podgląd admina) + Run | A: 1 wizyta / `hit_count` 1; B: odświeżenie → ta sama wizyta / 2; C: podgląd admina → bez zmian, 0 wizyt adminów; D: dostawca → „tylko administrator”; E: `enabled=true`, 1 zadanie |
| 6 | Oznaczenie kont testowych w zakładce (ZZZ TEST, aliasy `artur.stasiak+…`, konta próby marketingu) | Artur lub Claude w panelu | konta ukryte domyślnie, widoczne z „Pokaż konta testowe” |

W krokach P–5 adresy kont testowych w skryptach podmienia się w jednym miejscu (`KUPIEC-TESTOWY@…`, `DOSTAWCA-TESTOWY@…`). Konta testowe na produkcji: kupiec `artur.stasiak+kupiec@freshmarket.eu` (sieć ZZZ TEST 2), dostawca `artur.stasiak+dostawca@freshmarket.eu` (firma zawieszona — do bloku D wystarczy profil). Logowanie kupca testowego to magic link na Twoją skrzynkę.

## Warunki STOP

* Wynik kroku różny od oczekiwanego → nie przechodzić dalej; po kroku 4 → najpierw `04-wylaczenie-zapisu.sql`.
* Jakakolwiek zmiana `MARKETING_SEND_ENABLED` / allowlisty widoczna w `env:list` po kroku 3b → wycofać zmianę env, wyjaśnić przed buildem.

## Wycofanie

1. `04-wylaczenie-zapisu.sql` → wynik `enabled = false`.
2. Netlify → deploy `6aeef6d2ffaecdbf9dbafc89` (`fa3dd0b`) → **Publish deploy** (nie `push --force`).
3. Obiekty bazy zostają (zapis wyłączony, raport tylko dla admina); harmonogram retencji zostaje, żeby zebrane dane były usuwane po 12 miesiącach.
4. Flagi `VITE_*` można zostawić — bez nich ani z nimi nic nie jest zapisywane przy `enabled = false`; usunąć przy następnym buildzie, jeśli zakładka ma zniknąć.
