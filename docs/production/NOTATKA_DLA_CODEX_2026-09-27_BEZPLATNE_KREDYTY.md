# Do review (v2) — bezpłatne kredyty PreConnect przyznawane przez organizatora (27.09.2026)

Gałąź `feat/free-credit-grants` od `main` 37e90c7 (= produkcja 792a4e9 + docs). v2 = odpowiedź na review Codexa (`REVIEW_CODEX_2026-09-27_BEZPLATNE_KREDYTY.md`): wszystkie sześć ustaleń plus odziedziczone podwójne rozliczanie. **Nie wdrożone. Żadnych kredytów nie przyznano. Produkcja nietknięta.**

## Odpowiedź na review Codexa

| # | Ustalenie | Co zmieniono |
|---|---|---|
| 1 | P1 notatka wewnętrzna czytelna dla dostawcy | Kolumna `packages.grant_note` usunięta z migracji (plus `drop column if exists` na wypadek wcześniejszego uruchomienia v1), RPC nie kopiuje notatki na pakiet. Notatka żyje wyłącznie w `package_grant_batches.note` (SELECT tylko admin). Test SQL jako dostawca: brak kolumny, brak dostępu do partii, `row_to_json(packages)` i `wallet_tx` bez treści notatki. |
| 2 | P1 kolejność wdrożenia | Runbook: kopia + kontrola → **migracja** → weryfikacja → deploy. Dodatkowo funkcja Netlify jest odporna na odwrotną kolejność: rozliczanie idzie przez RPC, a gdy RPC nie istnieje (PGRST202/42883), spada na starą ścieżkę bez nowych kolumn. Każdy inny błąd RPC przerywa rozliczenie, nie zgaduje. Między migracją a deployem nie przyznawać kredytów (stary kod nie zna kolejności grant-first). |
| 3 | P2 „0 dostępnych, w tym 3 bezpłatne” | Rozdzielone trzy liczby: **dostępne do nowych wysyłek** (`pkgMax − pkgUsed`, jak dotąd), **oczekuje na odczyt sieci** (wysłane, nieodczytane — rezerwacja poza pulami) i **nierozliczone w pulach** (bezpłatne / kupione z `packages`). Pasek na stronie wysyłek: `Kredyty PreConnect: 0 z 3 · nierozliczone w pulach: bezpłatne 3, kupione 0 · oczekuje na odczyt: 3`. Karta Finanse: linia „Dostępne do nowych wysyłek: N · oczekuje na odczyt sieci: M” nad kafelkami pul. `order_hint` opisuje rezerwację i zwrot po 14 dniach. Test renderu z dokładnie tym przypadkiem (3 bezpłatne, 3 nieodczytane) dla Finanse i Wysyłek. |
| 4 | P2 trzy miesiące na końcu miesiąca | `Date.setMonth` usunięte. Front liczy tylko **podgląd** przez `addCalendarMonthsISO(businessTodayISO(), 3)` (arytmetyka na składowych, obcięcie do ostatniego dnia miesiąca, dzień biznesowy Europe/Warsaw) i **wysyła `null`**, dopóki admin nie zmieni pola — datę liczy Postgres w dniu przyznania. Testy: 31.01→30.04, 31.08→30.11, 30.11→28.02, 29.11.2027→29.02.2028, 29.02→29.05, przejście roku, 23:30 UTC = następny dzień w Warszawie. |
| 5 | P2 replay bez porównania treści | RPC: `insert … on conflict (idempotency_key) do nothing`; przy konflikcie blokuje partię (`for update`, czeka na równoległą transakcję) i **porównuje kanoniczne parametry** (posortowana, zdeduplikowana lista firm, qty, powód, wiadomość i notatka po trim, data gdy podana). Zgodne → wynik pierwotnej partii (`already_done`, `created_at`, `qty`, `company_count`). Niezgodne → 22023 „klucz idempotencji użyty z innymi parametrami”, nic nie dopisane. Front: po każdym błędzie pola formularza **zablokowane** (ten sam klucz może wyjść tylko z tą samą treścią), przycisk „Ponów” lub zamknięcie (nowe otwarcie = nowy klucz); toast powtórki pokazuje datę, liczbę i firmy pierwotnej partii; niezgodność = osobny komunikat. Testy SQL: 5 wariantów niezgodności + powtórka z inną kolejnością firm/spacjami/`null` datą; test równoległy dwóch sesji z tym samym kluczem: jedna partia, bez 23505. |
| 6 | P2 „ważne do” = MIN sugeruje wygaśnięcie całej puli | `summarizeCreditPools` zwraca `byExpiry` (pozostałe kredyty po terminach, rosnąco, bez terminu na końcu). Kafel puli pokazuje „1 kredyt wygasa 15.10.2026” i „9 kredytów wygasa 27.12.2026” zamiast jednego „ważne do”. Test jednostkowy i test renderu. |
| — | Odziedziczone podwójne rozliczanie | Rozliczanie przeniesione do **RPC `charge_legacy_send_first_seen`** (service_role): `FOR UPDATE` na wierszu wysyłki i wybranym pakiecie, idempotencja po znaczniku, kolejność grant → purchase → najbliższa ważność → najstarszy, `UPDATE` z kontrolą liczby wierszy, `wallet_tx` i znacznik na wysyłce w tej samej transakcji. Stara ścieżka (fallback) dostała kontrolę `row_count` i zwraca `charge_conflict` zamiast zapisywać „charged” na ślepo. **Test równoległy na dwóch połączeniach embedded PG**: dwa odczyty dwóch propozycji o ostatni kredyt → jedno pobranie, drugi `no_package_available`; dwa odczyty tej samej propozycji → jedno pobranie, drugi `already_charged`; liczniki `qty_used`, `wallet_tx`, znaczniki zgodne. |

Usunięty: `tests/free-credit-charge-order.test.js` i JS-owa `pickPackageForCharge` (kolejność żyje w SQL, testowana w SQL i równolegle).

## Kontrola istniejących rekompensat — do wykonania przed migracją

Zapytanie tylko do odczytu: `docs/production/sql/KONTROLA_REKOMPENSAT_PRZED_MIGRACJA_2026-09-27.sql`. Migracja nadaje wszystkim starym wierszom `source = 'purchase'` przez DEFAULT i **nie klasyfikuje po cenie zero** — także ewentualne historyczne prezenty zostaną „kupione”, dopóki nie zostaną oznaczone świadomą aktualizacją po liście `id` (wymaga `grant_reason`, `grant_batch_id`, `granted_by`, `granted_at` — constraint nie przepuści samego `source`). Rekompensat z 23.09 nie przyznawać drugi raz.

## Model (migracja `20260927120000_free_credit_grants.sql`)

- `packages`: `source` (purchase DEFAULT / grant), `grant_reason`, `grant_message`, `granted_by`, `granted_at`, `grant_batch_id`, `grant_seen_at`; constrainty spójności; plan katalogowy `grant` (`active = false`, cena 0).
- `package_grant_batches`: historia partii z `note` (tylko admin), `idempotency_key` UNIQUE, `company_ids` kanoniczne. RLS SELECT admin, revoke zapisu od `authenticated`.
- RPC `admin_grant_free_credits(p_company_ids, p_qty, p_reason, p_idempotency_key, p_message, p_note, p_expires_at)` — opis wyżej (p. 5). Domyślna ważność `current_date + 3 months` w bazie.
- RPC `mark_credit_grant_seen(p_package_id)` — tylko własna firma lub admin.
- RPC `charge_legacy_send_first_seen(p_send_id, p_company_id, p_now)` — tylko `service_role`; zwraca `charged/already_charged/no_package_available` z polami znacznika. Kwota informacyjna jak dotąd (`data.price` → `data.chargeAmount` → cena/kredyt), nienumeryczne wartości ignorowane.
- `company_capacity` + `qty_remaining_free/paid`, `qty_total_free/paid`, `free_expiry`, `paid_expiry`; `security_invoker` i revoke z 054 ponowione.

## Front

- `db.js`: `adminGrantFreeCredits` (walidacja + RPC, `null` dla domyślnej daty), `markCreditGrantSeen`, `adminListGrantBatches`, `summarizeCreditPools` (+ `byExpiry`), `addCalendarMonthsISO`, `businessTodayISO`.
- Admin → Firmy: przycisk i modal jak w v1 + blokada po niepewnym wyniku, „Ponów”, data „dotknięta” vs domyślna z bazy, toast powtórki ze szczegółami partii, znaczniki pul przy firmie.
- Dostawca: baner o przyznaniu (bez e-maila), karta „Twoje kredyty PreConnect” z rozbiciem terminów i linią dostępne / oczekujące, pasek wysyłek z pulami i oczekującymi, historia pakietów z powodem. `getPlanLabel('grant')` = etykieta przyznania.
- i18n PL/EN: `admin.firmy.grant_*` (+ `grant_locked_hint`, `grant_retry_btn`, `grant_mismatch_error`), `supplier.finance.pools.*` (+ `available_format`, `awaiting_format`, `nearest_expiry_*`, `no_expiry_format`), `supplier.finance.credits.bar_free_format` (treść z pulami i oczekującymi), `shell.grants.*`, `errors.db.grant_*`.

## Testy

- **SQL** `supabase/tests/free_credit_grants_test.sql` + runner `scripts/free-credit-grants-sql-test.mjs` (embedded PG 17, 127.0.0.1:54329): wszystkie migracje od zera, nowa migracja dwa razy, ROLLBACK; faza 2 na osobnych połączeniach (równoległe przyznanie z tym samym kluczem, ostatni kredyt z dwóch odczytów, ta sama propozycja z dwóch sesji). **PASS 27.09 (v2)**.
- **Vitest**: `tests/free-credit-pools.test.js` (pule, `byExpiry`, miesiące, dzień biznesowy, wrapper RPC — 10), `src/legacy/FreeCreditPools.test.jsx` (Finanse PL/EN, przypadek 3+3, dwa terminy, brak pul, pasek Wysyłek — 6). Pełny przebieg 27.09 (v2): **69 plików, 545/545** bez zmiennych Supabase; `npm run build` PASS.

## Wdrożenie (po akceptacji) — kolejność obowiązkowa

1. Zapytanie kontrolne (tylko odczyt) w SQL Editorze, wynik do notatki; kopia tabel `packages`, `wallet_tx`, `legacy_sends` (DPAPI, jak przy poprzednich wdrożeniach).
2. **Migracja** w SQL Editorze w jednej transakcji. Kontrola: kolumny `grant*` na `packages`, brak `grant_note`, `package_plans.grant` nieaktywny, `reloptions` widoku, `\df charge_legacy_send_first_seen` z grantem tylko dla `service_role`.
3. Tag `prod-rollback-2026-09-27-grants` na `main`, merge, deploy Netlify (front + funkcje). Do tego momentu **nie przyznawać** kredytów.
4. Test kontrolowany na firmie testowej: przyznanie 1 kredytu, drugi klik tym samym formularzem (toast „już przyznana …”), baner u dostawcy testowego, karta pul, historia, odczyt propozycji testowej → `packageSource = grant` na wysyłce.
5. Dopiero potem faktyczne przyznania (rekompensaty: powód `compensation`, lista firm z KROK 1 skryptu z 23.09, ważność domyślna 3 miesiące, chyba że Artur zdecyduje inaczej).

## Ryzyka pozostałe

- Duża liczba „Kredyty PreConnect: N z M” dalej liczy rezerwacje z wysyłek (semantyka sprzed zmiany); kafelki pul liczą z `packages`. Obie liczby są teraz podpisane i wyjaśnione, ale to nadal dwa źródła. Ujednolicenie (rezerwacja liczona w bazie) = osobny temat.
- Fallback starej ścieżki rozliczania istnieje tylko na wypadek odwrotnej kolejności wdrożenia; po potwierdzeniu migracji na produkcji można go usunąć w kolejnej gałęzi.
