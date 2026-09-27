# Do review — bezpłatne kredyty PreConnect przyznawane przez organizatora (27.09.2026)

Gałąź `feat/free-credit-grants` od `main` 37e90c7 (= produkcja 792a4e9 + docs). Migracja + front + jedna funkcja Netlify + testy. **Nie wdrożone. Żadnych kredytów nie przyznano. Produkcja nietknięta.** Wdrożenie i faktyczne przyznanie dopiero po akceptacji Artura.

## Zlecenie (Artur, 27.09)

Uniwersalny mechanizm przyznawania bezpłatnych kredytów: domyślna ważność 3 miesiące, admin wybiera firmy / liczbę / powód / wiadomość / notatkę, jednoznaczne źródło (zakup vs przyznanie) z powodem, dostawca widzi osobno pule i daty ważności zamiast „Aktywnego pakietu”, rozliczanie najpierw bezpłatne (wewnątrz puli najbliższa ważność) z zachowaniem pobrania przy pierwszym odczycie i bez obiecywania puli przed wysyłką, powiadomienie w aplikacji bez e-maili, zabezpieczenie przed podwójnym wykonaniem, historia.

## Kontrola istniejących rekompensat — NIE WYKONANA, do zrobienia przed wdrożeniem

Nie mam odczytu produkcji z tej sesji (klucz serwisowy w Netlify jest sekretem, odczyt przez sesję admina w Chrome został zablokowany przez politykę narzędzia). Gotowe zapytanie **tylko do odczytu**: `docs/production/sql/KONTROLA_REKOMPENSAT_PRZED_MIGRACJA_2026-09-27.sql` (SQL Editor). Interpretacja w pliku. Migracja **nie klasyfikuje** starych wierszy po cenie zero: wszystkie istniejące wiersze dostają `source = 'purchase'` przez DEFAULT. Jeżeli rekompensaty z 23.09 już są w bazie, oznaczenie ich jako `grant` to osobna, świadoma aktualizacja po dokładnej liście `id` z zapytania 1 (wymaga też `grant_reason`, `grant_batch_id`, `granted_by`, `granted_at` — constraint `packages_grant_fields_check` nie przepuści samego `source`). Nie przyznawać ich drugi raz.

## Model

**`packages`** (migracja `20260927120000_free_credit_grants.sql`):

| Kolumna | Znaczenie |
|---|---|
| `source` | `purchase` (DEFAULT, PayU/proforma/ręczne ustawienie limitu) lub `grant` |
| `grant_reason` | `promotion` / `compensation` / `gift` / `other` — tylko dla `grant` |
| `grant_message` | wiadomość dla odbiorcy (dostawca widzi) |
| `grant_note` | notatka wewnętrzna (front dostawcy jej nie pokazuje; kolumna jest czytelna przez RLS `packages_select_own_or_admin` — patrz „Ryzyka”) |
| `granted_by`, `granted_at`, `grant_batch_id` | kto, kiedy, jaka partia |
| `grant_seen_at` | dostawca zamknął baner |

Constrainty: `source in (purchase, grant)`; przyznanie musi mieć powód, partię, autora i czas; zakup nie może ich mieć. Plan katalogowy `grant` w `package_plans` (FK), `active = false`, cena 0 — nie pojawia się w cenniku ani selektorach, nie da się go kupić.

**`package_grant_batches`** — historia: jedna partia = jedno kliknięcie admina dla 1..N firm; `idempotency_key` UNIQUE, `company_ids`, `qty`, `reason`, `message`, `note`, `expires_at`, `created_by`. RLS: SELECT tylko admin, zapis wyłącznie przez RPC (revoke insert/update/delete od `authenticated`).

**RPC `admin_grant_free_credits(p_company_ids, p_qty, p_reason, p_idempotency_key, p_message, p_note, p_expires_at)`** — security definer, `is_admin()`:
- powtórka klucza → zwraca pierwszą partię z `already_done = true`, nic nie dopisuje;
- walidacje: qty 1..100, znany powód, istniejące firmy, klucz ≥ 8 znaków, `expires_at > dziś`; nieudana próba nie zostawia partii;
- domyślna ważność `current_date + 3 months`; **`purchase_package` bez zmian (+1 rok)**;
- jeden wiersz `packages` na firmę (duplikaty w wejściu zdeduplikowane), `payment_ref = 'grant:<batch>:<company>'` pod istniejącym unikalnym indeksem `ux_packages_payment_ref` — druga bariera przed podwójnym wstawieniem;
- ślad w `wallet_tx` (`adjustment`, kwota 0, `meta.kind = free_credit_grant`);
- zwraca `{batch_id, created, already_done, company_count, expires_at}`.

**RPC `mark_credit_grant_seen(p_package_id)`** — dostawca zamyka baner tylko na własnym wierszu `grant` (lub admin). Bez e-maili.

**`company_capacity`** — te same kolumny co dotąd + `qty_remaining_free`, `qty_remaining_paid`, `qty_total_free`, `qty_total_paid`, `free_expiry`, `paid_expiry`. `security_invoker` i revoke z 054 ponownie nałożone po `create or replace view`.

## Rozliczanie (Netlify, `_shared/legacy-send-seen.js`)

Nowa czysta funkcja `pickPackageForCharge(packages)`: pakiety z wolnym kredytem → najpierw `source = grant`, potem `purchase`; wewnątrz puli najbliższa `expires_at` (brak daty na końcu); remis = najstarszy `purchased_at`. Pobranie nadal przy pierwszym odczycie propozycji (bez zmian w przepływie, znaczniku i optymistycznym `qty_used`). Na wierszu wysyłki i w `wallet_tx.meta` zapisywane `packageSource` / `package_source`, żeby historia mogła nazwać pulę po fakcie. **Przed wysyłką nic nie obiecujemy** — tekst u dostawcy mówi tylko „najpierw wykorzystujemy bezpłatne”.

## Front

- `src/lib/db.js`: `adminGrantFreeCredits` (walidacja + RPC), `markCreditGrantSeen`, `adminListGrantBatches`, `summarizeCreditPools(packages)` (pule liczone z wierszy `packages`, wygasłe pomijane, najbliższa ważność puli z wolnym kredytem).
- **Admin → Firmy**, rozwinięty wiersz firmy: przycisk **„Przyznaj bezpłatne kredyty”** obok „Zapisz pakiet” + dwa znaczniki pul (bezpłatne / kupione z najbliższą ważnością). Modal: lista firm (start = ta firma, dopisywanie kolejnych przez wyszukiwarkę po nazwie z `company_capacity`), liczba kredytów, powód, ważność (domyślnie +3 miesiące), wiadomość dla odbiorcy, notatka wewnętrzna, podsumowanie `qty × firm = kredytów`. **Klucz idempotencji powstaje przy otwarciu modala** — retry po błędzie sieci i dwuklik idą z tym samym kluczem; przycisk blokowany w trakcie. Toast po sukcesie lub „partia już przyznana”. Modal renderowany w obu wariantach listy (legacy i 2.0).
- **Dostawca**: 
  - App ładuje `packages` firmy (`myPackages`) i liczy `creditPools`; odświeżenie razem z `company_capacity`.
  - Baner w powłoce (jak przy zwrotach) dla każdego nieprzeczytanego przyznania: liczba, wiadomość organizatora, ważność, „Wyślij propozycję” / „Rozumiem” (`mark_credit_grant_seen`).
  - **Finanse → Saldo**: karta „Aktywny pakiet” zastąpiona kartą **„Twoje kredyty PreConnect”**: kafel „Bezpłatne od organizatora” i „Kupione” — pozostało, `x z y`, ważne do; pod spodem reguła kolejności i pobrania przy odczycie; „Dokup kredyty”.
  - Pasek kredytów na stronie wysyłek: „w tym N bezpłatnych od organizatora”.
  - Historia pakietów (Cennik i pakiety): wiersz przyznania z ikoną prezentu, etykietą „Bezpłatne kredyty od organizatora · powód” i wiadomością. `getPlanLabel('grant')` zwraca tę etykietę, więc moduł Rozliczenia admina nie pokaże surowego `grant`.
- i18n PL/EN: `admin.firmy.grant_*`, `admin.firmy.pools_*`, `supplier.finance.pools.*`, `supplier.finance.credits.bar_free_format`, `shell.grants.*`, `errors.db.grant_*`. Klucze `supplier.finance.active_pkg.*` zostają nieużywane (do sprzątnięcia przy okazji).

## Testy

- **SQL**: `supabase/tests/free_credit_grants_test.sql` + runner `scripts/free-credit-grants-sql-test.mjs` (embedded Postgres 17 na 127.0.0.1:54329 jak pozostałe runnery): wszystkie migracje od zera, nowa migracja **dwa razy** (idempotencja), ROLLBACK. Sprawdza: kolumny i constrainty, stary wiersz z ceną 0 zostaje `purchase`, dostawca/anon nie przyznają (42501), walidacje (22023) bez śladu w partiach, przyznanie 2 firmom z duplikatem wejścia, 3 miesiące domyślnie, `payment_ref` `grant:…`, `wallet_tx`, historia, **powtórka klucza nic nie dopisuje**, jawna data, pule w `company_capacity` (przed i po zużyciu), dostawca widzi swoje / nie widzi cudzych / nie widzi partii, `mark_credit_grant_seen` tylko na własnym wierszu, admin nie modyfikuje historii. **PASS** 27.09 (dwukrotnie po poprawkach).
- **Vitest**: `tests/free-credit-charge-order.test.js` (kolejność zużycia, 5), `tests/free-credit-pools.test.js` (pule + walidacja/normalizacja wrappera RPC, 6), `src/legacy/FreeCreditPools.test.jsx` (karta pul PL/EN, bez pul, 3). Pełny przebieg 27.09 13:47: **70 plików, 543/543** (bez zmiennych Supabase).
- `npm run build`: PASS (27.09).

## Ryzyka / do decyzji w review

1. **`grant_note` czytelna dla dostawcy przez RLS** (`packages_select_own_or_admin` daje SELECT na cały wiersz; front jej nie renderuje, ale w devtools ją widać). Jeśli notatka ma być naprawdę wewnętrzna: przenieść ją wyłącznie do `package_grant_batches.note` (już tam jest) i **nie kopiować** do `packages.grant_note` — jedna linia w RPC + usunięcie kolumny. Rekomenduję to zrobić przed wdrożeniem; zostawiłem kolumnę, bo zlecenie mówiło o notatce na przyznaniu, a decyzja o widoczności jest Artura.
2. `company_capacity` przez `create or replace view` — kolumny dopisane na końcu, stare bez zmian; test sprawdza `security_invoker`. W SQL Editorze uruchomić całą migrację w jednej transakcji (jest `begin/commit`).
3. Wersja produkcyjna Postgresa: `on conflict (payment_ref) where payment_ref is not null` wymaga inferencji indeksu częściowego — działa na PG15+ (embedded 17 OK; produkcja Supabase = 15/17).
4. Liczba w nagłówku „Kredyty PreConnect” (duża liczba) dalej = `pkgMax − pkgUsed` z wysyłek (rezerwacja przy wysyłce), a kafelki pul = `packages` (pobranie przy odczycie). Te dwie liczby mogą się różnić o wysłane, nieodczytane propozycje — to istniejąca semantyka, opisana w `order_hint`. Nie zmieniałem.
5. Brak e-maila przy przyznaniu — zgodnie ze zleceniem. Wysyłka wymaga osobnej zgody.

## Wdrożenie (po akceptacji)

1. Zapytanie kontrolne z `docs/production/sql/…` w SQL Editorze, wynik do notatki.
2. Tag `prod-rollback-2026-09-27-grants` na `main`, merge, deploy Netlify.
3. Migracja w SQL Editorze (jedna transakcja), kontrola: `select column_name from information_schema.columns where table_name='packages' and column_name like 'grant%'`; `select id, active from package_plans where id='grant'`; `select relname, reloptions from pg_class where relname='company_capacity'`.
4. Test w panelu admina na firmie testowej: przyznanie 1 kredytu, drugi klik tym samym formularzem (toast „już przyznana”), baner u dostawcy testowego, karta pul, historia.
5. Dopiero potem faktyczne przyznania (rekompensaty: powód `compensation`, lista firm z KROK 1 skryptu z 23.09, ważność wg decyzji Artura — domyślnie 3 miesiące).
