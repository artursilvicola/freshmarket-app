# Kolejki / numerki spotkań B2B — runbook wdrożenia (FM 2026, 24.09)

Stan: **kod v2 (po kontrpropozycji Codexa z 6.09) na gałęzi `feat/admin-instructions-announcements`, NIE wdrożony na main, migracje NIE zaaplikowane.**
Specyfikacja i decyzje: `FM_KOLEJKI_NUMERKI_PROPOZYCJA.md` (sekcja 14). Review: `NOTATKA_DLA_CODEX_2026-09-06_KOLEJKI_REVIEW.md` (v1, odrzucona) → odpowiedź `NOTATKA_DLA_CODEX_2026-09-06_KOLEJKI_REVIEW_v2.md` (co poprawiono, wyniki testów).

## 1. Co powstało

| Warstwa | Plik | Rola |
|---|---|---|
| Migracja | `supabase/migrations/052_staff_role.sql` | ENUM `user_role` + `staff` (osobne uruchomienie) |
| Migracja | `supabase/migrations/053_fm_queue.sql` | tabele, RLS, widok publiczny, RPC SECURITY DEFINER, granty, `handle_new_user` z `staff` |
| Testy SQL | `supabase/tests/053_fm_queue_test.sql` + `000_supabase_shim.sql` + `scripts/fm-queue-sql-test.mjs` | T0–T14 (ROLLBACK); instalacja od pustej bazy 001→053 na gołym Postgresie — **przechodzi** |
| Test współbieżności | `scripts/fm-queue-concurrency-test.mjs` | ten sam klucz idempotencji ×2 równocześnie, 2 stanowiska, zalew 20× — wymaga branchu Supabase |
| Algorytm | `src/lib/fm-algo.js` + `fm-algo.test.js` | czysty moduł; pojemność = **60**/stanowisko × stanowiska (2 równoległe = 120), edytowalne per grupa; `npm test` (18 testów) |
| Dane | `src/lib/fm-queue.js` | konfiguracja (RLS admin), wrappery RPC, snapshot, Realtime |
| Funkcje | `netlify/functions/staff-login.js`, `admin-staff.js`, `fm-queue-snapshot.js`, `_shared/staff-auth.js` | logowanie kod+PIN, konta obsługi, cache'owany snapshot dla telefonów |
| UI | `src/staff/*` (`/obsluga`), `src/pages/FmBoardPage.jsx` (`/tablica`), `src/components/admin/FmEventDay.jsx` (admin → Spotkania B2B → **Dzień wydarzenia**), `src/components/supplier/FmMyQueue.jsx` („Twoja kolej” u dostawcy) | |

## 2. Kolejność wdrożenia (po akceptacji review)

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

- numer publiczny grupy (`last_called_nr`) idzie tylko do przodu — **trigger w bazie**, nie do obejścia nawet przez admina; „Cofnij” (≤ 30 s) dotyczy tylko statusu spotkania (rozpoczęcie / nieobecny / zakończenie), wywołania numeru nie da się cofnąć; jedyny reset: „Reset dnia testowego” (potwierdzenie `RESET YYYY-MM-DD`, zablokowany gdy w tym dniu były wywołania);
- „Zakończ i wywołaj następny” = jedna transakcja z blokadą wiersza stanowiska i grupy (parallel ×2 bezpieczne);
- powracający: `no_show → returned_waiting` z barierą `return_after_nr` = większy z dwóch najbliższych numerów (bieżący + kolejny); obsługa poza tablicą (`active_returnee_id`), `last_called_nr` bez zmian;
- wyjątek = `max(nr)+1`; walk-inów brak;
- `free_entry`/`closed` tylko gdy stanowisko wolne;
- każda operacja: rola + przypisanie (`fm_queue_assignments`), blokady grupa → stanowisko → spotkanie, `version` (409 → `FM_CONFLICT`), **obowiązkowy** klucz idempotencji sprawdzany ponownie pod blokadą (powtórka zwraca stan bez drugiej operacji), wpis w `fm_queue_log` (append-only, INSERT tylko z RPC);
- „Otwórz dzień” importuje plan tylko z `fm_settings` dla tej daty w fazie opublikowanej; raportuje `missing_supplier/missing_chain/unrouted/nr_conflict/locked_status/group_changed`; „Synchronizuj (force)” aktualizuje numery tylko spotkań jeszcze niewywołanych.

## 4. Dane publiczne vs prywatne

- `fm_queue_board_v` / `fm_queue_public_snapshot` (anon): sieć, etykieta grupy, gate, stanowisko, tryb, `last_called_nr`, `current_nr`, `next_nr`, `busy_private`. **Zero nazw firm, zero company_id, zero operatorów.** anon nie ma żadnych grantów na tabele modułu.
- `fm_queue_station_state` (nazwy firm): tylko admin lub operator przypisany do grupy; wersja `_unsafe` bez grantów (tylko z wnętrza RPC).
- `fm_queue_groups` / `fm_stations`: SELECT dla wszystkich zalogowanych (konfiguracja, bez danych wrażliwych) — potrzebne, żeby algorytm liczył tę samą pojemność u admina, dostawcy i kupca.
- `fm_queue_meetings`: admin wszystko; staff tylko przypisane grupy; dostawca tylko `company_id = app_company_id()`; anon nic.
- `fm_queue_log`: SELECT admin; `fm_staff`: admin + własny wiersz.

## 5. Logowanie obsługi

- Konto Auth z e-mailem `<kod>@obsluga.freshmarket.eu`, rola `staff` nadana przez `app_metadata` (tylko service_role; `handle_new_user` ignoruje role uprzywilejowane z `user_metadata`). Hasło GoTrue = `HMAC-SHA256(STAFF_PIN_PEPPER, "KOD:PIN")` — klient nigdy nie woła GoTrue z PIN-em.
- Bramka w bazie (`fm_staff_login_gate`, service_role): limit >30 prób/15 min per IP, blokada, lockout, **konto działa tylko w dniu `event_date` (Europe/Warsaw)**, `device_id` wymagany i zgodny z przypiętym. Wynik (`fm_staff_login_result`): atomowy licznik — 5 błędów → 15 min; sukces zeruje i przypina tablet.
- `is_staff()` przy każdym RPC/RLS: `active AND NOT blocked AND event_date = dziś AND token wydany po ostatniej rotacji PIN-u`.
- PIN: `crypto.randomInt`, bez trywialnych ciągów, zwracany **raz** (create/reset_pin), nie zapisywany, nie logowany. Reset PIN-u / blokada = unieważnienie wszystkich sesji (`fm_staff_revoke_sessions`) + odpięcie tabletu. Kontami zarządza **tylko super admin**.

## 6. Kiosk (rzutnik 1024×768)

- Windows: Edge/Chrome `msedge.exe --kiosk "https://b2b.freshmarket.eu/tablica?gate=1" --edge-kiosk-type=fullscreen` (lub Windows „Dostęp przypisany” z Edge). Parametry: `?rotate=8`, `?perPage=10`, `?page=2` (stała strona, drugi ekran).
- Tablica odpytuje `/.netlify/functions/fm-queue-snapshot` co 5 s (CDN cache 5 s), fallback RPC anon. Brak sieci > 20 s → czerwony pasek.
- Telefony uczestników: ta sama strona (`/tablica`) w układzie mobilnym + „Twoja kolej” w panelu dostawcy (co 8 s).

## 7. Test przed eventem (próba generalna 21–22.09)

1. Test SQL (pkt 2.4). 2. Utwórz 2 konta obsługi **z datą próby** (konto działa tylko w swoim dniu), przypisz sieci, zaloguj na tablecie (Chrome/Safari). 3. Otwórz dzień na dniu testowym (`fm_settings.event_date` = data próby, faza opublikowana); po próbie „Reset dnia testowego”. 4. Przejdź scenariusz: otwórz → wywołaj → rozpocznij → zakończ+następny → nieobecny → wrócił → obsłuż powracającego → wyjątek → cofnij → przerwa → wolne wejście → zamknij. 5. Rzutnik 1024×768: czytelność z 10 m, rotacja stron, GATE. 6. Test obciążeniowy snapshotu (300 klientów × 8 s ≈ 40 req/s na CDN, ~0.2 req/s na Supabase).
