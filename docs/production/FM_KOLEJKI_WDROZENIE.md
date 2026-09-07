# Kolejki / numerki spotkań B2B — runbook wdrożenia (FM 2026, 24.09)

Stan: **kod v4.2 na gałęzi `feat/admin-instructions-announcements`, NIE wdrożony na main, migracje NIE zaaplikowane na produkcji.**
Specyfikacja i decyzje: `FM_KOLEJKI_NUMERKI_PROPOZYCJA.md` (sekcja 14). Review: v1 (odrzucona) → v2 → v3 (kolejki OK) → v4 → v4.1 → **test hostowany Codexa (7.09) na projekcie testowym + deploy preview: logowanie, 2 urządzenia, brute force, reset PIN, blokady, Realtime ✅; zalew 20× → v4.2 (fail-fast + lock_timeout)** (`NOTATKA_DLA_CODEX_2026-09-07_KOLEJKI_REVIEW_v4_2.md`). Do końcowej akceptacji: powtórka testu 20× na v4.2.

## 1. Co powstało

| Warstwa | Plik | Rola |
|---|---|---|
| Migracja | `supabase/migrations/052_staff_role.sql` | ENUM `user_role` + `staff` (osobne uruchomienie) |
| Migracja | `supabase/migrations/053_fm_queue.sql` | tabele, RLS, widok publiczny, RPC SECURITY DEFINER, granty, `handle_new_user` z `staff` |
| Testy SQL | `supabase/tests/053_fm_queue_test.sql` + `000_supabase_shim.sql` + `scripts/fm-queue-sql-test.mjs` | T0–T16 (ROLLBACK); instalacja od pustej bazy 001→053 na gołym Postgresie — **przechodzi** |
| Testy hostowane | `scripts/fm-queue-concurrency-test.mjs` | wszystkie części obowiązkowe: idem ×2, 2 stanowiska, zalew 20×, 2 urządzenia pełną ścieżką Netlify→GoTrue→RPC, brute force 40× przez endpoint + poprawny PIN przy 5. próbie, reset PIN (stare tokeny), Realtime 2 konta, block/unblock — wymaga projektu testowego Supabase + deploy preview (`TEST_SUPABASE_URL`, `TEST_SERVICE_ROLE_KEY`, `TEST_ANON_KEY`, `STAFF_LOGIN_URL`) |
| Funkcje 2.0 | `netlify/functions/_shared/netlify-modern.js` | `default export (request, context)`, `Netlify.env`, zaufane `context.ip` — tylko trzy nowe funkcje modułu |
| Algorytm | `src/lib/fm-algo.js` + `fm-algo.test.js` | czysty moduł; pojemność = **60**/stanowisko × stanowiska (2 równoległe = 120), edytowalne per grupa; `npm test` (18 testów) |
| Dane | `src/lib/fm-queue.js` | konfiguracja (RLS admin), wrappery RPC, snapshot, Realtime |
| Funkcje | `netlify/functions/staff-login.js`, `admin-staff.js`, `fm-queue-snapshot.js`, `_shared/staff-auth.js` | logowanie kod+PIN, konta obsługi, cache'owany snapshot dla telefonów |
| UI | `src/staff/*` (`/obsluga`), `src/pages/FmBoardPage.jsx` (`/tablica`), `src/components/admin/FmEventDay.jsx` (admin → Spotkania B2B → **Dzień wydarzenia**), `src/components/supplier/FmMyQueue.jsx` („Twoja kolej” u dostawcy) | |

## 2. Kolejność wdrożenia (po akceptacji review)

0. **Lista przedwdrożeniowa (poza modułem):** `npm audit --omit=dev` → 6 podatności (3 high): `sharp` (tylko CLI eksportu kart — nie w funkcjach/bundlu), `ws`, `@remix-run/router` (`npm audit fix`), `xlsx` (brak fixa upstream; eksport Excela dla admina). Osobny commit, decyzja: `sharp` 0.35 / `xlsx` → `exceljs`.

1. **Netlify env** (zrobione 6.09): `STAFF_PIN_PEPPER` (secret, production). Bez niego `staff-login`/`admin-staff` odpowiadają 500 z jasnym komunikatem.
2. **Migracja 052** — SQL Editor, osobne uruchomienie: `ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'staff';`
3. **Migracja 053** — SQL Editor, całość (BEGIN…COMMIT). Kontrola: `select proname, prosecdef from pg_proc where proname like 'fm_queue%';`
4. **Testy** — od pustej bazy: `DATABASE_URL=… node scripts/fm-queue-sql-test.mjs --shim` (goły Postgres 15+) albo na branchu Supabase z 052/053: `… --only-test`; potem `scripts/fm-queue-concurrency-test.mjs` (`TEST_SUPABASE_URL`, `TEST_SERVICE_ROLE_KEY`).
5. Merge gałęzi → `main` → Netlify deploy. Frontend jest odporny na brak tabel (przed 053 zakładka „Dzień wydarzenia” pokazuje ostrzeżenie, `/tablica` „nieaktywna”, „Twoja kolej” nie renderuje się).
6. Admin → Spotkania B2B → Dzień wydarzenia → **Stanowiska → „Utwórz grupy dla sieci FM”**, ustaw gate, liczbę stanowisk, split (Dino · Kwiaty), `spotkania/stanowisko`.
   **PRZED 17.09 (uruchomienie algorytmu)** — bez tego każda sieć liczona jest jako 1 stanowisko (ostrzeżenie `no_station_config` w planie).
7. Obsługa → utwórz konta (`OBSLUGA-1…`), zapisz PIN-y (pokazywane raz), przypisz sieci.
8. **23.09** po zatwierdzeniu planu: **Tablica i dzień → „Otwórz dzień (import planu)”**. Stanowiska zostają ZAMKNIĘTE.
9. **24.09**: obsługa loguje się na `/obsluga`, otwiera swoje stanowiska ręcznie; rzutnik: `/tablica?gate=1` i `/tablica?gate=2`; 17:00 → „Zamknij wszystkie stanowiska”.

## 3. Reguły egzekwowane w bazie (nie w UI)

- numer publiczny grupy (`last_called_nr`) idzie tylko do przodu — **trigger w bazie**, nie do obejścia nawet przez admina; „Cofnij” (≤ 30 s): rozpoczęcie zawsze, nieobecny/zakończenie **tylko gdy przywracany numer jest nadal ostatnio wywołanym w grupie** (stanowiska równoległe nie pokażą starszego numeru); wywołania numeru nie da się cofnąć; jedyny reset: „Reset dnia testowego” — **super admin, tylko dzień w trybie testowym, nigdy data produkcyjna** (`fm_settings.event_date`), potwierdzenie `RESET YYYY-MM-DD`, wpis w logu;
- „Zamknij wszystkie” (17:00): stanowisko z trwającym spotkaniem przechodzi w **`closing`** — tablica pokazuje TERAZ bez NASTĘPNY, operator kończy normalnie, potem stanowisko zamyka się samo; nowych numerów nie wolno wywoływać, stanowisk otwierać (`FM_DAY_CLOSED`); omyłkę cofa „Otwórz dzień ponownie” (stanowiska w `closing` wracają do `open`, zamknięte zostają zamknięte);
- przeniesienie spotkania między grupami tej samej sieci (split, np. Dino Owoce → Dino Kwiaty): zakładka **Spotkania**, tylko zaplanowane i niewywołane, numer zachowany gdy wolny, inaczej kolejny wolny, wpis `move_meeting`;
- „Zakończ i wywołaj następny” = jedna transakcja z blokadą wiersza stanowiska i grupy (parallel ×2 bezpieczne);
- powracający: `no_show → returned_waiting` z barierą `return_after_nr` = większy z dwóch najbliższych numerów (bieżący + kolejny); obsługa poza tablicą (`active_returnee_id`), `last_called_nr` bez zmian;
- wyjątek = `max(nr)+1`; walk-inów brak;
- `free_entry`/`closed` tylko gdy stanowisko wolne;
- każda operacja: rola + przypisanie (`fm_queue_assignments`), blokady grupa → stanowisko → spotkanie z `lock_timeout` 3 s (`FM_BUSY` → tablet ponawia raz z tym samym kluczem), **fail-fast**: nieaktualna `version` odrzucana przed czekaniem na blokadę (`FM_CONFLICT` bez zajmowania puli połączeń) i ponownie pod blokadą, **obowiązkowy** klucz idempotencji sprawdzany przed pre-checkiem i pod blokadą (powtórka zawsze zwraca stan), wpis w `fm_queue_log` (append-only, INSERT tylko z RPC);
- „Otwórz dzień” importuje plan tylko z `fm_settings` dla tej daty w fazie opublikowanej; raportuje `missing_supplier/missing_chain/unrouted/nr_conflict/locked_status/group_changed`; „Synchronizuj (force)” aktualizuje numery tylko spotkań jeszcze niewywołanych.

## 4. Dane publiczne vs prywatne

- `fm_queue_public_snapshot` (anon; SECURITY DEFINER): sieć, etykieta grupy, gate, stanowisko, tryb, `last_called_nr`, `current_nr`, `next_nr`, `busy_private`. **Zero nazw firm, zero company_id, zero operatorów.** anon nie ma żadnych grantów na tabele modułu ani na widok `fm_queue_board_v` (widok z `security_invoker = true`, czytany przez zalogowanych pod RLS — Supabase Advisor).
- `fm_queue_station_state` (nazwy firm): tylko admin lub operator przypisany do grupy; wersja `_unsafe` bez grantów (tylko z wnętrza RPC).
- `fm_queue_groups` / `fm_stations`: SELECT dla wszystkich zalogowanych (konfiguracja, bez danych wrażliwych) — potrzebne, żeby algorytm liczył tę samą pojemność u admina, dostawcy i kupca.
- `fm_queue_meetings`: admin wszystko; staff tylko przypisane grupy; dostawca tylko `company_id = app_company_id()`; anon nic.
- `fm_queue_log`: SELECT admin; `fm_staff`: admin + własny wiersz.

## 5. Logowanie obsługi

- Konto Auth z e-mailem `<kod>@obsluga.freshmarket.eu`, rola `staff` nadana przez `app_metadata` (tylko service_role; `handle_new_user` ignoruje role uprzywilejowane z `user_metadata`). Hasło GoTrue = `HMAC-SHA256(STAFF_PIN_PEPPER, "KOD:PIN")` — klient nigdy nie woła GoTrue z PIN-em.
- Bramka w bazie (`fm_staff_login_gate`, service_role, IP z zaufanego `context.ip`): limit **IP + kod + urządzenie** (10/15 min; tablety mogą wychodzić jednym IP Wi-Fi) + globalny IP 300/15 min, blokada, lockout, **konto działa tylko w dniu `event_date` (Europe/Warsaw)**, `device_id` wymagany i zgodny z przypiętym, **rezerwacja próby (`attempt_id`)**: równolegle tyle prób, ile zostało do lockoutu (nadmiar → `FM_BUSY`), nierozliczone wygasają po 60 s. Rozliczenie (`fm_staff_login_result(attempt_id, outcome)`), każda próba raz: `success` zeruje licznik i przypina tablet jednym `UPDATE` (drugi tablet naraz → `FM_DEVICE_MISMATCH`, funkcja unieważnia jego świeżą sesję); `invalid_credentials` +1, **5. faktycznie błędny PIN = lockout 15 min**; `system_error` (awaria GoTrue/sieci) **nie liczy się** — obsługa nie zostanie zablokowana przez awarię.
- `is_staff()` przy każdym RPC/RLS: `active AND NOT blocked AND event_date = dziś AND iat > pełna sekunda progu unieważnienia` (`GREATEST(pin_rotated_at, tokens_valid_from)` — próg ustawia rotacja PIN-u **i blokada**, więc po odblokowaniu stare tokeny nie odżywają; bez tolerancji; token bez `iat` = odrzucony). Lockout wygasa po 15 min: bramka zeruje licznik pod blokadą wiersza.
- Klasyfikacja wyniku GoTrue: zły PIN tylko przy jednoznacznym `error.code = invalid_credentials` (lub dokładnym „Invalid login credentials” przy 400); inne 400/5xx/sieć = awaria, bez wpływu na lockout.
- Blokada konta (`admin-staff` block) jest **fail-closed**: najpierw `fm_staff_set_blocked` w bazie (blocked + sesje w jednej transakcji), potem ban w Auth; przy częściowym błędzie konto zostaje zablokowane, panel pokazuje błąd.
- PIN: `crypto.randomInt`, bez trywialnych ciągów, zwracany **raz** (create/reset_pin), nie zapisywany, nie logowany. Reset PIN-u / blokada = unieważnienie wszystkich sesji (`fm_staff_revoke_sessions`) + odpięcie tabletu. Kontami zarządza **tylko super admin**.

## 6. Kiosk (rzutnik 1024×768)

- Windows: Edge/Chrome `msedge.exe --kiosk "https://b2b.freshmarket.eu/tablica?gate=1" --edge-kiosk-type=fullscreen` (lub Windows „Dostęp przypisany” z Edge). Parametry: `?rotate=8`, `?perPage=10`, `?page=2` (stała strona, drugi ekran).
- Tablica odpytuje `/.netlify/functions/fm-queue-snapshot` co 5 s (CDN cache 5 s), fallback RPC anon. Brak sieci > 20 s → czerwony pasek.
- Telefony uczestników: ta sama strona (`/tablica`) w układzie mobilnym + „Twoja kolej” w panelu dostawcy (co 8 s).

## 7. Test przed eventem (próba generalna 21–22.09)

1. Test SQL (pkt 2.4). 2. Super admin: **Włącz tryb testowy** dla daty próby (nie dla 24.09). 3. Utwórz 2 konta obsługi **z datą próby** (konto działa tylko w swoim dniu), przypisz sieci, zaloguj na tablecie (Chrome/Safari). 4. „Otwórz dzień” (w trybie testowym bierze najnowszy opublikowany plan, nie rusza produkcyjnych ustawień FM); po próbie „Reset dnia testowego”, potem „Wyłącz tryb testowy”. 5. Przejdź scenariusz: otwórz → wywołaj → rozpocznij → zakończ+następny → nieobecny → wrócił → obsłuż powracającego → wyjątek → cofnij → przerwa → wolne wejście → „Zamknij wszystkie” przy trwającym spotkaniu (closing) → dokończ. 6. Rzutnik 1024×768: czytelność z 10 m, rotacja stron, GATE. 7. Test obciążeniowy snapshotu (300 klientów × 8 s ≈ 40 req/s na CDN, ~0.2 req/s na Supabase).
