# Kolejki / numerki spotkań B2B — runbook wdrożenia (FM 2026, 24.09)

Stan na 8.09.2026: **kolejki v4.4 są na produkcji od 7.09 (Micro, migracje 052/053 — historia w §8). Lista spotkań obsługi z commitu `a7e87db` została wdrożona 8.09 po wyraźnej zgodzie Artura.** Deploy produkcyjny `6a9ff29d50868c000867539e`, publikacja 11:34:18 UTC / 13:34:18 Europe/Warsaw. Poprawka listy nie wymagała migracji ani zmian danych uczestników. Szczegóły i ograniczenia kontroli: §9. Płatna gałąź testowa Supabase z wcześniejszego testu została usunięta.
Specyfikacja i decyzje: `FM_KOLEJKI_NUMERKI_PROPOZYCJA.md` (sekcja 14). Review: v1 (odrzucona) → v2 → v3 (kolejki OK) → v4 → v4.1 → v4.2 → v4.4. T0–T16, logowanie 2 operatorów, idempotencja, 2 stanowiska równolegle, Realtime 2 tablety, 2 urządzenia naraz, brute force 40× + lockout, reset PIN + stare tokeny, block/unblock — **wszystko ✅**. Zalew 5×: 1 sukces w 69 ms + 4 konflikty, całość 212 ms. Zalew 20×: 1 sukces w 83 ms + 19 konfliktów, całość 261 ms; **0 `PGRST003`, 0 timeoutów, dokładnie jedna wykonana operacja**.

Warunek testu 20× jest spełniony. Wcześniejszy timeout nie wynikał z pojemności puli: `FM_CONFLICT` używał SQLSTATE `40001`, a PostgREST 14.5 automatycznie ponawia błędy serializacji. v4.4 używa oficjalnego kodu `PT409` (HTTP 409), więc konflikt wraca natychmiast i nie uruchamia retry infrastruktury.

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
| UI | `src/staff/*` (`/obsluga`), `src/pages/FmBoardPage.jsx` (`/tablice`; stare `/tablica` przekierowuje z parametrami), `src/components/admin/FmEventDay.jsx` (admin → Spotkania B2B → **Dzień wydarzenia**), `src/components/supplier/FmMyQueue.jsx` („Twoja kolej” u dostawcy) | |

## 2. Kolejność wdrożenia (po akceptacji review)

0. **Lista przedwdrożeniowa (poza modułem):** `npm audit --omit=dev` → 6 podatności (3 high): `sharp` (tylko CLI eksportu kart — nie w funkcjach/bundlu), `ws`, `@remix-run/router` (`npm audit fix`), `xlsx` (brak fixa upstream; eksport Excela dla admina). Osobny commit, decyzja: `sharp` 0.35 / `xlsx` → `exceljs`.

1. **Netlify env** (zrobione 6.09): `STAFF_PIN_PEPPER` (secret, production). Bez niego `staff-login`/`admin-staff` odpowiadają 500 z jasnym komunikatem.
2. **Migracja 052** — SQL Editor, osobne uruchomienie: `ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'staff';`
3. **Migracja 053** — SQL Editor, całość (BEGIN…COMMIT). Kontrola: `select proname, prosecdef from pg_proc where proname like 'fm_queue%';`
4. **Testy** — od pustej bazy: `DATABASE_URL=… node scripts/fm-queue-sql-test.mjs --shim` (goły Postgres 15+) albo na projekcie testowym Supabase z 052/053: `… --only-test`; potem `scripts/fm-queue-concurrency-test.mjs` (`TEST_SUPABASE_URL`, `TEST_SERVICE_ROLE_KEY`, `TEST_ANON_KEY`, `STAFF_LOGIN_URL`). **Test (3) zalew 20× powtórzyć na projekcie z pulą jak produkcja** (free tier: `PGRST003`).
5. Merge gałęzi → `main` → Netlify deploy. Frontend jest odporny na brak tabel (przed 053 zakładka „Dzień wydarzenia” pokazuje ostrzeżenie, `/tablice` „nieaktywna”, „Twoja kolej” nie renderuje się).
6. Admin → Spotkania B2B → Dzień wydarzenia → **Stanowiska → „Utwórz grupy dla sieci FM”**, ustaw gate, liczbę stanowisk, split (Dino · Kwiaty), `spotkania/stanowisko`.
   **PRZED 17.09 (uruchomienie algorytmu)** — bez tego każda sieć liczona jest jako 1 stanowisko (ostrzeżenie `no_station_config` w planie).
7. Obsługa → utwórz konta (`OBSLUGA-1…`), zapisz PIN-y (pokazywane raz), przypisz sieci.
8. **23.09** po zatwierdzeniu planu: **Tablica i dzień → „Otwórz dzień (import planu)”**. Stanowiska zostają ZAMKNIĘTE.
9. **24.09**: obsługa loguje się na `/obsluga`, otwiera swoje stanowiska ręcznie; rzutnik: `/tablice?gate=1` i `/tablice?gate=2`; 17:00 → „Zamknij wszystkie stanowiska”.

## 2a. Archiwalny plan testu przed pierwszym wdrożeniem — tymczasowa gałąź Supabase (7.09)

Stan przed wdrożeniem 7.09: plan **Pro**, compute **Nano** (`t4g.nano`, ~21/60 połączeń, 62–65% RAM). Poniższy plan jest historyczny: upgrade do **Micro** wykonano 7.09, a zmierzona przerwa wyniosła około 4 minut (szczegóły §8). Diagnoza problemu zalewu i jej rozwiązanie przez `PT409` są opisane na początku dokumentu; nie przypisywać dawnych timeoutów wyłącznie małej puli.

1. Utworzyć tymczasową gałąź Supabase w organizacji Pro (0,01344 USD/h) — compute Micro.
2. Na gałęzi: `052_staff_role.sql` (osobno) → `053_fm_queue.sql`; kontrola: `select proname from pg_proc where proname like 'fm_queue%';`.
3. Netlify → Deploy Preview gałęzi `feat/admin-instructions-announcements` (v4.3+) z env gałęzi Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_PIN_PEPPER` (testowy, ≥ 32 znaki) — **tylko kontekst Deploy Preview**.
4. Testy (PowerShell, w repo):
   ```
   $env:TEST_SUPABASE_URL="https://<ref-galezi>.supabase.co"; $env:TEST_SERVICE_ROLE_KEY="…"; $env:TEST_ANON_KEY="…"
   $env:DATABASE_URL="postgres://…galaz…"; node scripts/fm-queue-sql-test.mjs --only-test        # T0–T16 (ROLLBACK)
   $env:STAFF_LOGIN_URL="https://deploy-preview-…--freshmarketb2b.netlify.app/.netlify/functions/staff-login"
   $env:FLOOD_N="5";  node scripts/fm-queue-concurrency-test.mjs
   $env:FLOOD_N="20"; node scripts/fm-queue-concurrency-test.mjs
   ```
   Skrypt drukuje czas zwycięzcy i rozkład `FM_CONFLICT`/`FM_BUSY`/inne. Interpretacja: **zwycięzca < 500 ms i reszta `FM_CONFLICT`** = OK; **inne = `PGRST003`** przy szybkim zwycięzcy = sufit puli Data API dla tego compute (test dla 5/10 pokaże, ile równoczesnych żądań mieści pula); **zwycięzca > 2 s** = wolna transakcja po stronie bazy — zgłosić, to nie jest problem puli.
5. Zielono na Micro → zgoda „wdrażaj” → upgrade produkcji Nano → Micro w spokojnym oknie (< 2 min przerwy, poza godzinami pracy kupców) → wdrożenie wg pkt 2 → próba generalna 21–22.09 z 6–8 prawdziwymi tabletami (tryb testowy) → usunąć gałąź.
6. Jeśli 20× nie przejdzie na Micro: **Small na tydzień eventu** (Codex), albo uznać 20× za test platformy — realne obciążenie w dniu eventu to ≤ 10 równoczesnych RPC (tablet wysyła jedno naraz; od v4.3 z limitem 10 s i ponowieniem).

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

## 5a. Weryfikacja dostawcy przez obsługę (wdrożone na produkcję 8.09, `a7e87db`; szczegóły §9)

Operator jest osobą zewnętrzną i nie zna dostawców. Sam numer NIE jest weryfikacją. Przebieg przy stanowisku:

1. Dostawca podaje firmę, sieć i numer oraz pokazuje kartę spotkania (lub ekran „Twoja kolej”).
2. Operator ma wybrane właściwe stanowisko (sieć / grupa — Dino · Owoce i Dino · Kwiaty to osobne kolejki). Przy **TERAZ** widzi: „Sieć · stanowisko N”, **„Numer 12 — pełna nazwa firmy”** (zawijana, nigdy ucięta), status („Wywołany — oczekujemy na dostawcę”, „W trakcie — spotkanie trwa”) i wskazówkę weryfikacyjną.
3. Jeśli osoba nie jest przy TERAZ: **„☰ Lista spotkań”** → szukanie po numerze lub nazwie (bez polskich znaków), filtry Wszystkie / Oczekujące / Wywołane–w trakcie / **Odbyte** (tylko zakończone) / **Pominięte–anulowane** / Nieobecni–powracający, kolumna **Stanowisko** (Auchan ×2 = wspólna kolejka), wiersz → godziny wywołania / rozpoczęcia / zakończenia. **Status pochodzi z rekordu spotkania** — niższy numer nie oznacza „zakończone”. Filtry są przeglądowe, nie rozłączne (powracający w trakcie liczy się w dwóch), więc liczniki nie sumują się do „Wszystkie”.
4. Zgadza się → skierowanie do kupca i istniejący przycisk „Rozpocznij spotkanie”. Nie zgadza się (inna firma, spotkanie już zakończone/nieobecny) → administrator. Lista nie ma żadnych akcji zmieniających stan; bez automatycznego wyjątku i bez „rozpocznij ponownie”.
5. Lista odświeża się po każdej operacji, z Realtime (drugi tablet), co 10 s oraz po powrocie łącza i powrocie do karty. Wiersze są **związane z grupą z nagłówka** — po zmianie sieci nigdy nie widać listy poprzedniej; gdy danych tej sieci jeszcze nie ma, panel pokazuje „wczytywanie” albo błąd, nie starą listę i nie „brak spotkań”. Odczyt ma limit 10 s, a dane starsze niż 25 s są oznaczane jako nieaktualne — samo działające Wi-Fi nie oznacza aktualnych danych. Odczyty, Realtime, wyniki operacji i zasiew ze stanowisk przechodzą przez jedną bramkę: **generacja wyboru + wersja stanowiska/grupy + kolejność rozpoczęcia żądania przy równych wersjach**. Wersje nie maleją, ale nie obejmują wszystkich zmian pochodnych (np. gotowość powracającego po zakończeniu spotkania na drugim stanowisku). Opóźnione żądanie o tych samych wersjach nie może nadpisać wyniku nowszego żądania. Cache zachowuje pierwotną generację i kolejność; wynik operacji rozpoczętej na innym stanowisku nie zmienia ekranu, listy ani „Cofnij”.

Widoczność: RLS 053 bez zmian (admin + obsługa przypisana do sieci); `/tablice` i snapshot nadal bez nazw dostawców. Podgląd z danymi testowymi (tylko dev): `/obsluga-demo?station=s-au-2&view=list`; zrzuty 1024×768: `docs/production/img/obsluga-lista/`. Notatki review: `NOTATKA_DLA_CODEX_2026-09-08_OBSLUGA_LISTA_SPOTKAN.md` → `_v2.md` → `_v3.md`.

Uzupełnienie Codexa: `NOTATKA_DLA_CLAUDE_CODEX_2026-09-08_OBSLUGA_LISTA_FINAL.md`. Testy lokalne: **54/54**, oryginalne testy review **9/9**, build OK; powtórzone przed wdrożeniem 8.09. **Poprawka jest już na main i produkcji — §9.** Test hostowany wykonany wcześniej 8.09: `node scripts/fm-staff-list-hosted-test.mjs`, wyłącznie projekt `uowpixwtewrmmvkyooec` i istniejący testowy Deploy Preview. Logowanie kod/PIN, nazwy firm pod RLS, brak cudzej listy i dwie sesje Realtime: **3 kolejne pełne przebiegi OK**, ostatnie dwa po 25/25 kontroli. Raport: `NOTATKA_DLA_CLAUDE_CODEX_2026-09-08_OBSLUGA_LISTA_HOSTED.md`, surowe wyniki: `evidence/2026-09-08-staff-list/`. Zachowano też wcześniejszy niezaliczony przebieg Realtime (oczekiwana zmiana nie dotarła w 15 s; przyczyna niepotwierdzona). Nie usuwać pollingu awaryjnego 10 s i ostrzeżenia o nieaktualnych danych. Tymczasowe konta, sesje i fixtures posprzątane; audyt zachowany. Nie zastępuje próby na fizycznych tabletach ani klikania nowej listy na zalogowanym koncie w docelowym środowisku.

## 6. Kiosk (rzutnik 1024×768)

- Windows: Edge/Chrome `msedge.exe --kiosk "https://b2b.freshmarket.eu/tablice?gate=1" --edge-kiosk-type=fullscreen` (lub Windows „Dostęp przypisany” z Edge). Parametry: `?rotate=8`, `?perPage=10`, `?page=2` (stała strona, drugi ekran).
- Tablica odpytuje `/.netlify/functions/fm-queue-snapshot` co 5 s (CDN cache 5 s), fallback RPC anon. Brak sieci > 20 s → czerwony pasek.
- Telefony uczestników: ta sama strona (`/tablice`) w układzie mobilnym + „Twoja kolej” w panelu dostawcy (co 8 s). Stary adres `/tablica` przekierowuje na `/tablice`, zachowując query i hash.

## 7. Test przed eventem (próba generalna 21–22.09)

1. Test SQL (pkt 2.4). 2. Super admin: **Włącz tryb testowy** dla daty próby (nie dla 24.09). 3. Utwórz 2 konta obsługi **z datą próby** (konto działa tylko w swoim dniu), przypisz sieci, zaloguj na tablecie (Chrome/Safari). 4. „Otwórz dzień” (w trybie testowym bierze najnowszy opublikowany plan, nie rusza produkcyjnych ustawień FM); po próbie „Reset dnia testowego”, potem „Wyłącz tryb testowy”. 5. Przejdź scenariusz: otwórz → wywołaj → rozpocznij → zakończ+następny → nieobecny → wrócił → obsłuż powracającego → wyjątek → cofnij → przerwa → wolne wejście → „Zamknij wszystkie” przy trwającym spotkaniu (closing) → dokończ. 6. Rzutnik 1024×768: czytelność z 10 m, rotacja stron, GATE. 7. Test obciążeniowy snapshotu (300 klientów × 8 s ≈ 40 req/s na CDN, ~0.2 req/s na Supabase).

## 8. Wykonano na produkcji — 7.09.2026 (wdrożenie v4.4, zgoda Artura, 14 kroków)

| Krok | Czas (UTC) | Wynik |
|---|---|---|
| 1. Stan wyjściowy | 14:0x | `origin/main` 7f06dc2, feat c3742bd (zawiera 1ea67d2 = PT409); tag rollback `prod-rollback-2026-09-07` = 7f06dc2; Auth/REST 200; Realtime SUBSCRIBED 745 ms |
| 2. Compute Nano → Micro | 14:26–14:30 | dashboard „Free upgrade” (+0 USD), restart ~4 min (REST 521 → 200 o 14:29:58); po restarcie `t4g.micro`, Auth 200, REST 200, Storage 200, Realtime SUBSCRIBED 808 ms |
| 3. Kontrola 053 v4.4 | — | `PT409` ×11, `ERRCODE '40001'` = 0 (tylko komentarz), `/tablice` kanoniczna, `/tablica` przekierowuje z parametrami |
| 4. Merge | 14:27 | worktree main: `5901af2` = merge `feat/admin-instructions-announcements` (--no-ff); drzewo identyczne z feat (cherry-pick 7f06dc2 bez konfliktu) |
| 5. Testy na zmergowanym main | 14:29 | migracje 001→053 od zera + `053_fm_queue_test.sql` T0–T16 na embedded Postgres 17 ✅; `npm test` 25/25 ✅; `npm run build` ✅ (24,7 s) |
| 6. Push + Netlify | 14:31:51 | deploy produkcyjny **`6a9ecad899e8850008683109`** (ready 14:32:20, 27 s, 24 funkcje, 8 przekierowań); bundle `index-Dn_vRZ-X.js` zawiera `/obsluga`, `/tablice`, chunki `FmBoardPage`, `StaffPanel`, `FmEventDay` |
| 7. Kontrole przed migracją | 14:34 | `/tablice` renderuje (snapshot 502 → „Brak połączenia” — oczekiwane przed 053); `/tablica?gate=1#x` → `/tablice?gate=1#x` (GATE 1); `/obsluga` ekran logowania PL/EN; `/admin` → `/login` (kontrola panelu admina wymaga sesji Artura) |
| 8. `052_staff_role.sql` | 14:36 | osobne uruchomienie → `enum_range(user_role)` = `{admin,supplier,buyer,staff}`; PostgreSQL 17.6 |
| 9. `053_fm_queue.sql` | 14:44 | treść pobrana z GitHub raw commitu 5901af2, SHA-256 zgodne z blobem (`045d539e…`, 92 317 B); dialog „destructive operations” (= `DROP … IF EXISTS`) → Run → **Success** |
| 10. `053_fm_queue_test.sql` na prod | 14:47–14:49 | `BEGIN … ROLLBACK`, dialog „Run without RLS” → **„✅ OK — wszystkie testy 053_fm_queue_test (T0–T16) przeszly”**; po teście: 0 wierszy w 8 tabelach modułu, 0 firm/sieci `TEST %`, `fm_settings` 1 wiersz (2026-09-24 / preferences_open), companies 79, retailers 43, auth.users 150, profiles 147 |
| 11. Kontrole po wdrożeniu | 14:45–14:52 | 39 funkcji `fm_queue*`/`fm_staff*`/`is_staff`, 14 polityk, RLS 8/8 tabel, publikacja `supabase_realtime` = fm_queue_groups + fm_stations, anon 0 grantów; `fm_queue_public_snapshot` (anon) 200; Netlify `fm-queue-snapshot` 200; `staff-login` zły kod → 401 `FM_BAD_CREDENTIALS` (wpis `TEST-NOPE:rejected` w `fm_login_attempts` = ta kontrola, nie test); `/tablice` bez błędów konsoli; 0 aktywnych backendów poza edytorem |
| 12. Stanowiska | 14:56 | `docs/production/sql/2026-09-07_fm_queue_konfiguracja_stanowisk.sql` (odpowiednik „Utwórz grupy”): **23 grupy / 24 stanowiska** (Dino · Owoce + Dino · Kwiaty `{kwiaty}`, Auchan ×2, reszta ×1), 60 spotk./stan., wszystkie `closed`, **gate NULL** (do decyzji); snapshot: 24 stanowiska, bez nazw firm; tablica pokazuje sieci jako ZAMKNIĘTE |
| 13. Konta obsługi | — | **nie wykonane** — wymaga sesji super admina w UI (PIN pokazywany raz Arturowi) |
| 14. `chore/npm-audit-2026-09` | — | osobno, po stabilizacji kolejek |

Dzień produkcyjny NIE został otwarty, plan NIE został zaimportowany. Nie sprawdzono z zewnątrz: logowanie istniejących użytkowników i panel admina (brak sesji), Realtime z tokenem obsługi (próba generalna), logi Netlify/Supabase w dashboardzie (strona logów nie renderowała się w automatyzacji — do zerknięcia ręcznie).

## 9. Lista spotkań obsługi — wdrożona 8.09.2026

Po zgodzie Artura „ok, sprawdz i wdróż to” wykonano fast-forward `origin/main`: `b901bf4` → **`a7e87db`**. Netlify production **`6a9ff29d50868c000867539e`**, `ready`, publikacja 11:34:18 UTC / 13:34:18 Europe/Warsaw. Nie uruchamiano migracji, nie zmieniano sekretów ani danych w bazie. Poprzedni deploy do ewentualnego przywrócenia: `6a9ed12ae1077c00081aa455` (`b901bf4`).

Powtórzono 54/54 testy aplikacji, 9/9 niezależne testy review, build i `git diff --check`. Najpierw sprawdzono draft `6a9ff1d90223d0ff506d415d` z testowym Supabase, następnie potwierdzono produkcyjny commit i produkcyjny projekt w bundlu. Logowanie PL/EN, publiczna tablica i przekierowanie `/tablica` z query/hash działają. Snapshot: 24 stanowiska, wszystkie zamknięte, bez pól z nazwami dostawców. Lokalny podgląd z danymi w pamięci potwierdził listę, historię, wyszukiwanie, zmianę Auchan → Dino i ostrzeżenie po błędzie odczytu.

Pełny raport z granicami testów: **`NOTATKA_DLA_CLAUDE_2026-09-08_LISTA_WDROZONA.md`**. Nie wykonano w tej turze testu zalogowanego operatora na nowej produkcji ani fizycznych tabletów. Nadal potrzebne są przypisania GATE, konta/przypisania obsługi, aktualizacja instrukcji PDF i próba generalna. Przy filtrze `?gate=1` tablica pokazuje obecnie nieaktywność; bez filtra widoczne są stanowiska. Nie zmieniać GATE bez potwierdzonego planu sali.

## 9. Wdrożenie release/2026-09-09 — 9.09.2026 (zgoda Artura, akceptacja techniczna Codexa)

| Element | Wartość |
|---|---|
| main | `48dd1b4` → **`7819e62`** (fast-forward; kod: e58e9d1 dni testowe/„Twoja kolej”, 78bc617 automatyczna szansa, c64d8a4 npm audit, 4c9f981 karta dostawcy po review) |
| Netlify prod | **`6aa126c7e333bc0008a3d330`** (ready 09:29:06 UTC, 20 s, 24 funkcje) |
| Punkt powrotu | deploy `6a9ff29d50868c000867539e` (a7e87db) = tag `prod-rollback-2026-09-09` (48dd1b4); przywracać deploy, nie cofać bazy |
| Migracje / plan / kolejki | brak migracji; plan NIE przeliczany ani publikowany; dzień NIE otwarty; 24 stanowiska `closed`, `closed_all_at` null |
| Kontrole po deployu | `/login`, `/obsluga`, `/tablice`, `/tablica?gate=1`, `/admin` 200; serwowane paczki zawierają znaczniki release (data stanowisk, „kolejka zamykana”, „JESTEŚ NASTĘPNY”, snapshot `?date=`, „Daj szansę — automatycznie”, `FM_INPUTS_INCOMPLETE`), 0× demo/test-renderer/skrypt hostowany; ekrany: `/obsluga` PL↔EN, `/tablica?gate=1#kontrola` → `/tablice?gate=1#kontrola` (GATE 1, „nieaktywna” bo bramy nieprzypisane), `/tablice` 24 wiersze, `/login` PL; konsola bez błędów |
| Niewykonane | karta „Twoja kolej” na prawdziwym koncie dostawcy (brak planu w kolejkach 24.09); logowanie obsługi na nowym buildzie (konta tworzy super admin); próba na fizycznych tabletach 21–22.09; dwie uwagi eksploatacyjne Codexa (timeout nie anuluje transportu; pierwszy błąd odczytu bez komunikatu) — osobna poprawka przed próbą |

## 10. Wdrożenie fix/fm-my-queue-transport — 9.09.2026 (zgoda Artura, akceptacja Codexa d8a4b01)

| Element | Wartość |
|---|---|
| main | `fc34f80` → **`d8a4b01`** (fast-forward; kod 9fb91eb: AbortController na odczyty karty „Twoja kolej” + komunikat pierwszego błędu PL/EN z linkiem `/tablice?date=`) |
| Netlify prod | **`6aa12daac2bb9e0007629034`** (ready 09:58 UTC) |
| Punkt powrotu | deploy `6aa126c7e333bc0008a3d330` (7819e62) = tag `prod-rollback-2026-09-09b` (fc34f80) |
| Migracje / plan / kolejki | brak migracji; plan nie przeliczany ani publikowany; dzień nie otwarty; 24 stanowiska `closed` |
| Pozostaje | konfiguracja wydarzenia (stanowiska/GATE/konta obsługi), próba na prawdziwych kontach i tabletach 21–22.09, instrukcja PDF |


## 11. Wdrożenie fix/fm-stars-limit-ux — 10.09.2026 (zgoda Artura, akceptacja Codexa dcfd60b)

Poza modułem kolejek — panel wyboru sieci dostawcy. Zgłoszenie KRZYŚ-MAR (2 × Business): ekran po piątej ⭐ pokazywał „5/5”, „Gotowe ✓”, „max 5”, choć limit w kodzie i algorytmie wynosił 10.

| Element | Wartość |
|---|---|
| main | `2c2e2c0` → **`dcfd60b`** (fast-forward; cc35c6b: `src/lib/fm-stars.js` — minimum 5 vs limit 5 × pakiety, licznik `{{count}}/{{max}}`, „Minimum ✓ · możesz dodać jeszcze N ⭐”, zielone „Gotowe” tylko przy pełnej puli, admin ⭐5/10, firma po dokładnym `company_id`; dcfd60b: FAQ „minimum 5, maksymalnie 5 na każdy pakiet Business”) |
| Netlify prod | **`6aa2af37de9af70008257cf0`** (ready 13:23 UTC); smoke test paczki: nowe teksty PL/EN obecne, stare (`{{count}}/5`, `stars_remaining_hint`) nieobecne |
| Punkt powrotu | deploy `6aa12daac2bb9e0007629034` (d8a4b01) = tag `prod-rollback-2026-09-10` (2c2e2c0) |
| Migracje / dane / algorytm | brak migracji; zapis wyborów, algorytm (`supplierCapacity`), dane firm bez zmian; kolejki nietknięte |
| Testy | 132/132 (nowe: `fm-stars.test.js` 6, `FmStarsLimit.test.jsx` 8); notatka `NOTATKA_DLA_CODEX_2026-09-10_LIMIT_GWIAZDEK.md` |
| Pozostaje | wiadomość do firm z >1 pakietem (mogą dobrać sieci główne do 16.09); KRZYŚ-MAR — potwierdzić konto (`agnieszka.p@…`), duplikat „P.W. KRZYŚ-MAR” do decyzji |

## 12. Wdrożenie fix/fm-supplier-profile-prefill — 11.09.2026 (zgoda Artura, akceptacja Codexa 943e130)

Poza modułem kolejek — strona „Mój profil” dostawcy. Zgłoszenie KRZYŚ-MAR: po każdym logowaniu puste imię/telefon/stanowisko mimo poprawnego zapisu w `profiles` (formularz czytał `account`, który dla dostawcy nie miał `phone/position`, a `account.name` = nazwa firmy).

| Element | Wartość |
|---|---|
| main | `f0e68b9` → **`943e130`** (fast-forward; `account.personName/phone/position` z profilu, formularz z tych pól, synchronizacja bez kasowania edycji, `onSaved` → `setAccount`) |
| Netlify prod | **`6aa3e4944f9f8d00086e0cf3`** (ready 11:23 UTC); smoke test paczki: `personName` obecne |
| Punkt powrotu | deploy `6aa2af37de9af70008257cf0` (dcfd60b) = tag `prod-rollback-2026-09-11` (f0e68b9) |
| Migracje / dane | brak; RLS i B2B bez zmian; dotyczy wszystkich dostawców |
| Testy | 136/136 (nowe: `SupplierProfilePrefill.test.jsx` 4); notatka `NOTATKA_DLA_CODEX_2026-09-11_MOJ_PROFIL.md` |
| Pozostaje | sprawdzenie na prawdziwym koncie KRZYŚ-MAR (logowanie → Mój profil → odświeżenie → ponowne logowanie) — Artur/Anna; informacja do firmy, że danych z 10.09 nie trzeba wpisywać ponownie |

## 13. Wdrożenie fix/fm-company-profile-feedback — 11.09.2026 (decyzja Artura/Codexa: braki nie blokują zapisu)

Poza modułem kolejek — strona „Profil firmy” dostawcy. Zgłoszenie wierniccy.co (Anna Wiernicka): „Zapisz profil” bez żadnej informacji, wpisany opis „znika”. Przyczyna: wymóg logo przerywał zapis, a jedyny komunikat (toast) renderował się na górze strony poza ekranem; szkic przepadł przy odświeżeniu. 7 firm FM bez logo nie mogło zapisać profilu.

| Element | Wartość |
|---|---|
| main | `8a11db4` → **`4df75d1`** (fast-forward; e8fdb10 + 4df75d1: `companyProfileGaps`, brak logo/NIP = ostrzeżenie „Profil zostanie zapisany, ale nie jest kompletny. Uzupełnij …” + toast `saved_incomplete`, zapis zawsze; toast `flash` sticky u góry okna (wszystkie panele); opisy oznaczają formularz jako zmieniony; poprawione teksty PL certyfikatów) |
| Netlify prod | **`6aa400f355b82e00084566c2`** (ready 13:24 UTC); smoke test paczki: nowe teksty PL obecne, „Zanim zapiszesz” nieobecne, poprzednia poprawka (`personName`) nadal w paczce |
| Punkt powrotu | deploy `6aa3e4944f9f8d00086e0cf3` (943e130) = tag `prod-rollback-2026-09-11b` (8a11db4) |
| Migracje / dane | brak; RLS bez zmian; NIP nadal wymagany osobno przy zakupie pakietu |
| Testy | 143/143 (nowe: `company-profile.test.js` 3, `CompanyProfileFeedback.test.jsx` 4); notatka `NOTATKA_DLA_CODEX_2026-09-11_PROFIL_FIRMY_ZAPIS.md` |
| Pozostaje | test na koncie `wierniccy.co` (wpisanie opisu → zapis → odświeżenie → ponowne logowanie) — Artur/Anna; tekst Anny z 14:51 nie był zapisany, trzeba wpisać ponownie; 7 firm bez logo może teraz zapisać profil i uzupełnić logo później |

## 14. Wdrożenie feat/fm-plan-sponsor-sem-ecopack — 13.09.2026 (zgoda Artura)

Logo sponsora SEM ECOpack na kartach spotkań PDF (`src/lib/fm-plan/assets.js`, 472×120 PNG obok Tekasya 458×120 i Redpack 436×120). Stopka paneli (Tekasya/Redpack/SEM ECOpack) to dane w `fm_settings.ui_content.partners` + bucket `brand-assets/partners/` — SEM ECOpack dodany 12.09 przez Supabase, bez deployu, bez linku.

| Element | Wartość |
|---|---|
| main | `fb95cf1` → **`d3d416a`** (fast-forward; tylko assets.js) |
| Netlify prod | **`6aa699cdd5920c0008e798cd`** (ready 12:41 UTC) |
| Punkt powrotu | deploy `6aa400f355b82e00084566c2` (4df75d1) = tag `prod-rollback-2026-09-13` (fb95cf1) |
| Migracje / dane | brak |
| Pozostaje | karty generowane 23.09 — sponsorzy w stopce karty: 3 loga po 66×22 pt |

## 15. Wdrożenie fix/auth-magic-link-existing-only — 15.09.2026 (zgoda Artura, akceptacja Codexa 7626b4c)

Poza modułem kolejek — logowanie. Zgłoszenie Umai Group: magic link na adres bez konta zakładał nowego usera (profil supplier bez firmy → ekran „Konto bez przypisanej firmy”); 5 kont-sierot od czerwca.

| Element | Wartość |
|---|---|
| main | `6d4e490` → **`7626b4c`** (fast-forward; `signInWithOtp` z `shouldCreateUser: false`, `src/auth/authErrors.js`, komunikat `login.magic_link_no_account` PL/EN) |
| Netlify prod | **`6aa8fd3b26cd2e00081e2038`** (ready 2026-09-15T08:09:52.255Z); smoke test paczki: `shouldCreateUser:!1` + nowe teksty PL/EN obecne |
| Punkt powrotu | deploy `6aa699cdd5920c0008e798cd` (d3d416a) = tag `prod-rollback-2026-09-15` (6d4e490) |
| Migracje / dane | brak migracji; osobno (SQL 15.09, zgoda Artura): profil `i.kaliuzhnaia@market.kg` przepięty na kupca sieci Umai (id 143) + wpis `audit_log` |
| Testy | 145/145 (nowy: `authErrors.test.js` 2); notatka `NOTATKA_DLA_CODEX_2026-09-15_MAGIC_LINK.md` |
| Pozostaje | potwierdzenie wejścia Iriny nowym magic linkiem; 4 pozostałe konta-sieroty do wyjaśnienia (Leclerc + 3 gmail) |

## 16. Wdrożenie fix/fm-buyer-preview-full — 15.09.2026 (zgoda Artura, review + patch Codexa)

Podgląd firmy przez kupca w „Spotkania FM 2026" pokazywał ubogi zastępczy opis zamiast profilu z katalogu, a sekcja ofert — „Brak przypisanej sieci detalicznej".

| Element | Wartość |
|---|---|
| main | `ec1fa1c` → **`8b0a9d4`** (fast-forward; 73ab36e: `findSupplierCompany` zamiast martwego dopasowania po `fmId`/`sup-<id>`; 8b0a9d4 (patch Codexa): `buyerRetailerId={resolveRetailerIdFromChain(chainId, retailers)}` w obu wywołaniach modala) |
| Netlify prod | **`6aa9204b7c59ee0008620eaa`** (ready 2026-09-15T10:39:25.504Z); smoke test paczki: `Pw(c,{accountId:…,fmId:…,legacySupplierId:…})` obecne, `buyerRetailerId:Zn[e]||null` → `buyerRetailerId:br(e,_)` |
| Punkt powrotu | deploy `6aa8fd3b26cd2e00081e2038` (7626b4c) = tag `prod-rollback-2026-09-15b` (ec1fa1c) |
| Migracje / dane | brak; zakres danych bez zmian (ten sam komponent i rola co w katalogu „Dostawcy") |
| Skala | stara mapa `CHAIN_TO_RETAILER` (27 kluczy) nie znała m.in. ch39 Biedronka, umaigroup26 Umai, ch36 Makro, ch31 Rohlik, ch41 Albert, ch35 Mega Image, ch38 Fantastico, ch44 PROMO, ch46 AIBĖ — kupcy tych sieci nie widzieli własnych propozycji w podglądzie |
| Testy | 153/153 (`FmBuyerPreview.test.jsx` 8: 3 Claude + 5 Codex); notatka `NOTATKA_DLA_CODEX_2026-09-15_PODGLAD_KUPCA.md` |
| Pozostaje | kontrola na rzeczywistym koncie kupca (Biedronka/Umai): profil w katalogu = profil w FM, własne oferty widoczne, oferty innych sieci ukryte |

## 17. Wdrożenie feat/country-kyrgyzstan — 15.09.2026 (zgoda Artura: „popraw wszystko")

Lista krajów (`src/lib/countries-data.js`) to jedno źródło dla rejestracji dostawcy, kraju firmy, formularza oferty, kraju sieci w adminie i filtrów. Brakowały dwa kody faktycznie potrzebne uczestnikom.

| Element | Wartość |
|---|---|
| main | `cee9a88` → `81846bd` (KG) → **`24564e7`** (CH) |
| Netlify prod | `6aa9289b790f2c0008d750c0` (KG, ready 11:14 UTC) → **`6aa9291a3cafe00008073d7e`** (CH, ready 11:17 UTC); smoke test paczki: KG i CH w obu językach + flagi |
| Punkt powrotu | deploy `6aa9204b7c59ee0008620eaa` (8b0a9d4) = tag `prod-rollback-2026-09-15c` (cee9a88) |
| Testy | 155/155 (nowy `countries.test.js`: spójność 46 kodów — flaga + PL + EN, obecność krajów uczestników) |
| Korekta danych (SQL, ten sam dzień) | sieć 143 Umai Group: `country PL → KG`; firma PPO Services AG (Däniken, @ppo.ch): `country (puste) → CH`; oba z wpisem `audit_log.country_fix` |
| Pozostaje | opcjonalnie GB/RS i inne kody spoza listy — dodać, gdy pojawi się uczestnik z takiego kraju |

## 18. Wdrożenie fix/profile-impersonation-guard — 16.09.2026 (zgoda Artura, review + 3 commity Codexa)

Incydent 16.09 11:13: admin (jagoda.knadel) w podglądzie konta dostawcy Fresh roots zapisał „Mój profil" — dane osoby kontaktowej dostawcy trafiły na profil admina (`updateOwnSupplierProfile` pisze zawsze do sesji). Ten sam ekran zmieniał hasło zalogowanego.

| Element | Wartość |
|---|---|
| main | `93b5b69` → **`008504d`** (57a3ebc Claude: profile-guard, readOnly obu stron profilu, odmowa w db; 40d5e74/dde3011 Codex: kupiec po id profilu, obowiązkowa zgodność roli, sprawdzenie sesji też dla kupca, pola kupca readOnly; 008504d docs) |
| Netlify prod | **`6aaa69eb3efff20007827d64`** (ready 10:05 UTC); smoke test paczki: teksty `profile.impersonation.*` i `profile_not_own` PL/EN obecne |
| Punkt powrotu | deploy `6aa9291a3cafe00008073d7e` (24564e7) = tag `prod-rollback-2026-09-16` (93b5b69) |
| Migracje | brak |
| Korekta danych (SQL, po deployu) | profil admina b8669ba2…: `name Nancy → Jagoda Knadel`, `position Muhammed → null`, `company_id → null`; usunięty pusty rekord firmy „Jagoda Knadel" (388d73e0…, suspended, 0 powiązań poza tym profilem — pozostałość po rejestracji 10.08); `audit_log`: `profile_restore` + `company_delete` |
| Testy | 162/162 (`profile-guard.test.js` 5, `SupplierProfilePrefill.test.jsx` +2); notatka `NOTATKA_DLA_CODEX_2026-09-16_PODGLAD_KONTA.md` |
| Pozostaje | poinformować Jagodę: dane przywrócone, jej hasło nie było zmienione; w podglądzie cudzego konta „Mój profil" jest teraz tylko do odczytu |

## 19. Wdrożenie 054_views_lockdown.sql — 16.09.2026 17:46 (zgoda Artura „wyłącznie 054”, review Codexa 9d74711)

- **Co**: `supabase/migrations/054_views_lockdown.sql` (commit c8842c8 na gałęzi `fix/security-hotfix-2026-09-16`, sha256 pliku `2e8e7be2…`) — SQL Editor, jedna transakcja. Widoki `consent_audit`, `company_capacity`, `v_admin_registrations`, `v_admin_stats` → `security_invoker=true`; revoke INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER przez widoki (także `articles_with_facts`) od anon/authenticated; anon bez SELECT na `consent_audit`/`v_admin_*`. Bez zmian w kodzie, bez deployu frontu. `audit_log`: `security_views_lockdown` / `054` o 15:46:01 UTC.
- **Kopie**: przed — `C:\Users\Artur\FreshMarket-Backups\FM-B2B-20260916-174027-przed-054` (stan 15:42:46 UTC; 785 wyborów, 156 odpowiedzi, 79 potwierdzeń; DPAPI, zweryfikowana SHA-256 z bazy); po — `…\FM-B2B-20260916-174805-po-054` (15:50:56 UTC). Kopia Codexa z 15:53:32 (772/156) zachowana bez zmian. Compare 15:53 → przed-054: +13 wyborów uczestników, 0 zmian odpowiedzi (ruch uczestników). **Compare przed-054 → po-054: 0 różnic we wszystkich 17 tabelach** (wybory, odpowiedzi, potwierdzenia, przypisania, ustawienia, kolejki).
- **Kontrola po wdrożeniu**: `pg_class.reloptions` = `security_invoker=true` na 4 widokach; granty anon/authenticated = tylko SELECT (anon: `company_capacity`, `articles_with_facts`). PostgREST jako anon: `consent_audit`, `v_admin_registrations`, `v_admin_stats` → 401; `company_capacity` → 200 / 0 wierszy; DELETE przez `consent_audit` → 401; `fm_settings` (1 wiersz), `retailers` (0), `articles_with_facts` (7699) bez zmian. Sesja admina (SQL, rollback): `consent_audit` 142, `company_capacity` 114, `v_admin_registrations` 2, `v_admin_stats` 1 — legalny odczyt działa. Sesja dostawcy (SQL, rollback): `consent_audit` tylko własny wiersz (cudze 0), `v_admin_*` 0, profile kupców 0, `company_capacity` 114 (katalog).
- **Druga aplikacja**: `freshmarketb2b.netlify.app` przekierowuje dziś na `b2b.freshmarket.eu`; bundle B2B nie odwołuje się do `v_admin_*` ani `consent_audit`. Panel rejestracyjny (właściciel `event_registrations`/`participant_profiles`) czyta `v_admin_*` poprawnie tylko w sesji admina — do potwierdzenia przez Artura na jego środowisku.
- **Znane, nadal otwarte (055)**: dostawca wciąż widzi `retailers.buyer_email/name/phone` (44 sieci) — zamyka to dopiero 055 (`retailer_contacts`), które czeka na osobną zgodę.

## 21. Wdrożenie fix/buyer-preview-products — 17.09.2026 07:06 (zgoda Artura „tak, wdrażaj”)

- **Co**: zgłoszenie klienta (Anna Wiernicka, 16.09): podgląd firmy u kupca pokazywał tylko kategorię, nie asortyment. Pole „Produkty" (`companies.products`) jest wypełnione u 83/105 firm FM, ale `CompanyPreviewBody` go nie renderował. Poprawka 19fc86c: wiersz **„Asortyment:"** na początku sekcji „Oferta" (PL/EN), sekcja widoczna także gdy tylko asortyment jest wypełniony; test `FmBuyerPreview.test.jsx`. Tylko wyświetlanie, bez zmian w bazie. 202/202, build OK.
- **Deploy**: `main` dd8e506 → **19fc86c** (ff-only), Netlify deploy **`6aab7546927bba0008ff1d59`** ready 07:06:33, bundle `index-D0qt1Xyj.js` zawiera `Asortyment:`/`Assortment:`; front 055 nietknięty (RPC obecne, brak ścieżki legacy); `/version.json` = `19fc86c18966`.
- **Punkt powrotu**: deploy `6aaadd04921e472a19774c51` (dd8e506) = tag `prod-rollback-2026-09-17` (dd8e506).
- **Do klienta**: 22 firmy FM bez „Produktów" nic nie pokażą, dopóki nie uzupełnią pola w profilu (lista w czacie 17.09); Fungi Team P&P Rymuza miała pustą listę kategorii — uzupełnione 17.09 (§22). Sprostowanie (Codex): brak kategorii nie blokuje przypisania do kolejki, gdy sieć ma jedną kolejkę ogólną; `unrouted` grozi tylko przy sieci podzielonej na kolejki kategorii bez kolejki ogólnej (17.09: tylko Dino ma podział kwiaty + ogólna). Kategorii „grzyby" nie ma i nie dodajemy przed wydarzeniem.

## 22. Uzupełnienie kategorii 3 firm FM — 17.09.2026 08:14 (zgoda Artura „tak, dodaj” po zestawieniu przed → po)

- **Co**: dane produkcyjne, bez zmian w kodzie. Firmy FM bez kategorii było 9; na podstawie potwierdzonych danych uzupełniono 3: **Fungi Team P&P Rymuza** `[] → ['warzywa']` (produkty „Grzyby, pieczarki Agaricus bisporus.” bez zmian), **Den Berk Délice** `[] → ['warzywa']` (własne pole „Produkty”: Specialty tomatoes, bez zmian), **Tenuta Chiaramonte** `[] → ['inne']`, `types [] → ['producent']`, `products null → „EVOO Tonda Iblea i inne odmiany; oliwy aromatyzowane; wina; oliwki; kapary; sosy i przetwory pomidorowe; przeciery; produkty gourmet; mąki; makarony”` (arkusz Anny Wiernickiej `Pelna_tabela_danych_firm_Anna_Wiernicka.xlsx`, arkusz „Konta 16 firm”, kolumny „Kategorie produktów” / „Główne produkty / odmiany”).
- **Jak**: jedna transakcja w SQL Editorze (`begin … commit`), blok DO z warunkami wstępnymi (kategorie puste, produkty zgodne z zestawieniem), zapis, kontrola po zapisie (liczba wyborów sieci i `fm_selection_confirmed_at` bez zmian — inaczej wyjątek i wycofanie). Po jednym wpisie `audit_log` na firmę: `action = 'company_profile_fill'`, `entity = 'company'`, `meta.before/after/source/authorized_by/executed_by`. Nie ruszano `company_target_retailers`, `fm_resps`, faz ani planu.
- **Kontrola (sesja admina, tylko odczyt)**: 3/3 firmy z nowymi kategoriami, wybory 10 / 0 / 5 (razem 15, jak przed), potwierdzenia bez zmian, `audit_log company_profile_fill` = 3 (wszystkie `2026-09-17T06:14:23Z`).
- **Uwaga operacyjna**: SQL Editor pokazał dialog „destructive operations” (przyciski Cancel / Run query) bez `role="dialog"` — pierwsza próba (karta 1) czekała na kliknięcie i została anulowana; zapis poszedł z karty 2. Zrzut ekranu karty w tle timeoutuje w CDP, co wyglądało jak zawieszony renderer.
- **Zostaje 6 firm bez kategorii** (nie przypisujemy po samej nazwie, potrzebne potwierdzone dane): Agro-Wit, AGROSAD (12 wyborów), Ewa-Bis (11), Oranfresh (5), Paweko, Yuksel Seeds.

## 23. Wdrożenie fix/company-desc-en-fields — 17.09.2026 09:30 (zgoda Artura po 3 rundach review Codexa)

- **Co**: zgłoszenie nr 2 koordynatorki (Anna Wiernicka, 17.09 08:36): „po zapisaniu profilu został tylko jeden język”. Formularz „Profil firmy” miał wyłącznie pola PL (`description`, `description_short`) niezależnie od języka UI; wersje EN (`description_en`, `description_short_en`) wypełniało tylko AI, a podgląd pokazuje je kupcom z angielskim interfejsem. Wpisanie opisu EN „po przełączeniu języka” nadpisywało PL. Poprawka (3 commity, review Codexa: ef186f2 → 4f9fefe → c60269f):
  - osobne pola „wersja angielska (EN)” + dotychczasowe pola nazwane wprost „wersja polska (PL)”; objaśnienie: język podglądu = język aplikacji kupca;
  - jedna normalizacja 4 pól opisu (trim, puste → null) dla patcha UPDATE, obiektu do `setCo` (bulk mapper) i stanu formularza; opisy w zapisanym profilu z potwierdzonego wyniku UPDATE (P2: spacje w EN wracały drugim zapisem i blokowały fallback na PL);
  - podgląd `pickDescriptionSet()`: komplet pól jednego języka, drugi język tylko gdy pierwszy w całości pusty (P2: pusty skrót PL był uzupełniany skrótem EN nad polskim opisem);
  - `editRevRef` w PageCompany: odpowiedź zapisu trafia do formularza i czyści „dirty” tylko, gdy w trakcie zapisu nic nie zmieniono; inaczej nowszy tekst zostaje szkicem, toast `saved_newer_draft` (P1: dopisek w trakcie zapisu znikał).
  - testy: CompanyDescEnFields, CompanyDescSaveRoundtrip (scenariusze Codexa), CompanyDescPendingEdit; Codex: 218/218 (214 + 4 własne), build OK.
- **Deploy**: `main` 19fc86c → **c60269f** (ff-only, 3 commity), Netlify deploy **`6aab970aff1c970008b1b16f`** ready 09:30:53, `/version.json` = `c60269f71c7f`, bundle `index-ByoyREaD.js` zawiera etykiety „wersja polska (PL)”/„Polish version (PL)”, `saved_newer_draft`, `desc-en`, „Asortyment:”; ścieżka RPC 055 (`fm_set_company_targets`) obecna. Bez migracji, bez zmian w bazie.
- **Punkt powrotu**: tag `prod-rollback-2026-09-17b` = 19fc86c (deploy `6aab7546927bba0008ff1d59`); rollback = Netlify „Publish deploy” poprzedniego deploya.
- **Kontrola po wdrożeniu (09:36–09:45, konto testowe `test.dostawca@…`, firma „TEST Fresh Market – konto testowe (nie uczestniczy)”, `09e52206…`, `fm_b2b_enabled=false`, `account_status=suspended` = tylko baner, 0 wyborów; login w panelu przeglądarki wykonał Artur)**: smoke curl OK (`/version.json` c60269f71c7f); formularz „Twoja firma” ma 4 pola: „Opis krótki/standardowy — wersja polska (PL)” i „— wersja angielska (EN)” z objaśnieniem; zapis tekstów TEST PL/EN → toast „Profil zapisany. Nie jest jeszcze kompletny — uzupełnij logo firmy i NIP.”; po pełnym przeładowaniu wszystkie 4 wartości wracają; w bazie (sesja admina, odczyt) `description`/`description_short` = PL, `description_en`/`description_short_en` = EN, `updated_at` 07:36:49Z, kategorie/produkty/wybory bez zmian; „Podgląd kupca” w PL pokazuje tylko teksty PL, po przełączeniu na EN (etykiety „Polish version (PL)” / „English version (EN)”, tytuł „Company profile preview – buyer view”) tylko teksty EN; powrót na PL OK. Jedyny zapis Claude'a = firma testowa; w tym samym oknie 3 inne firmy zaktualizowały profil same (Agricultural Cooperative of Organic Prod… 09:29, Megafarms 09:33, Belorta 09:34 — aktywność użytkowników, nie efekt wdrożenia). Teksty TEST na koncie testowym zostawione (niewidoczne dla uczestników) — do wyczyszczenia na życzenie.
- **Nie zrobiono (osobne decyzje)**: naprawa opisów 12 firm Anki (EN w kolumnach PL) — po świeżym eksporcie 4 kolumn opisów + `updated_at`, pełnych tekstach „przed → po” i zatwierdzeniu; bez zmian kategorii, produktów, pakietów, wyborów. Baner nowej wersji — osobne zadanie.

## 24. Naprawa opisów PL/EN firm Anny Wiernickiej — 17.09.2026 10:11 (zatwierdzony wariant 14 firm, review Codexa 7/7)

- **Co**: 12 firm koordynatorki miało tekst angielski w kolumnach polskich (`description`, `description_short`) i puste kolumny EN (skutek formularza sprzed §23). Zakres wyłącznie opisowy: 4 pola opisów + `updated_at` + `audit_log`. **11 firm „naprawa”** (ASICA, IlTom, Bel'Export, Consorzio Melinda, Prime Fruit, Ever Fresh, Ondine, La Fenice, Orto Gioia, Terra Natura, ORTOMÌ): EN przeniesione wprost ze starej wartości wiersza w tym samym UPDATE (`description_en = nullif(btrim(description),'')`, `description_short_en = …`), akapity zachowane; `description` ← arkusz Anny (`Pelna_tabela_danych_firm_Anna_Wiernicka.xlsx`, „Konta 16 firm”, kol. „Krótki opis do B2B”); `description_short` ← NULL (zawierał EN). **3 firmy „uzupełnienie”**: FruitMarket (skrót EN → `description_short_en`, pełny PL z arkusza), Tenuta Chiaramonte i Oranfresh (pełny PL z arkusza, reszta pusta). **Fungi Team bez zmian**, TerraNova Crops pominięta (brak w bazie). Kategorie, produkty, kontakty, pakiety, wybory B2B nietknięte; bez maili.
- **Procedura**: folder `C:\Users\Artur\FreshMarket-Backups\opisy-przed-naprawa-2026-09-17\` — kopia `opisy-przed.json` (15 firm, 4 kolumny + `updated_at`, sha256 `b0f82ce6…`), zestawienie `NAPRAWA_OPISOW_zestawienie.md` (zatwierdzone przez Artura po review Codexa), generator `gen-naprawa-sql.mjs`, `naprawa-opisow-kontrola.sql` (odczyt) i `naprawa-opisow-14.sql`, próba generalna na lokalnym embedded PG (`proba-generalna-lokalna.mjs`: 14/14 + ścieżka STOP), niezależne testy Codexa 7/7. Skrypt: jedna transakcja `begin … do $repair$ … commit`, per firma `SELECT … FOR UPDATE`, kontrola `updated_at` = kopia, kontrola tekstów PL-kolumn = kopia, kontrola pustych kolumn EN, `UPDATE … where updated_at = rec.updated_at`, `row_count = 1`, wpis `audit_log` (`company_desc_repair`, before/after/source/authorized_by/exported_at/copy_sha256), licznik 14 = 14; pierwszy rozjazd = wyjątek = wycofanie całości.
- **Wykonanie**: kontrola wstępna w SQL Editorze 10:08 — pierwszy przebieg pokazał 5 rozjazdów tekstów (firmy z akapitami): przyczyną była konwersja LF→CRLF przy wklejaniu do Monaco (zmienia treść literałów `$q$…$q$`), nie dane; po `model.setEOL(LF)` i weryfikacji sha256 pliku w edytorze 14/14 OK. Skrypt 14 firm uruchomiony 10:11:47 (sha256 pliku `62697d95…` zweryfikowana w edytorze, EOL LF), COMMIT, `s28` = 14 wierszy z audit=1.
- **Kontrola po zapisie** (sesja admina, `kontrola-po-naprawie.mjs`): pełne 4 pola każdej z 15 firm vs kopia + arkusz — **15/15 zgodne**, `updated_at` zmienione tylko u 14 (Fungi bez zmian), audyt 14/14 z `before` = kopia, `after` = stan bieżący, `copy_sha256` zgodny; akapity w EN zachowane (Melinda 5 linii, Prime Fruit 5, Ever Fresh 3, La Fenice 3, TNI 7). Eksport „po”: `opisy-po.json` + sha256.
- **Uwaga narzędziowa**: przy wklejaniu SQL do Supabase SQL Editora na Windows zawsze wymusić LF (`monaco.editor.getEditors()[0].getModel().setEOL(0)`) i porównać sha256 z plikiem; `[BLOCKED]` filtr ukrywa hashe w wyniku JS — porównywać w przeglądarce (boolean). Puste literały w bloku `do $$` nie mogą być `$q$$q$` (`$$` kończy blok) — używać `''` i tagu `$repair$`.

## 25. Wdrożenie feat/admin-fm-payment-date — 17.09.2026 15:39 (zgoda Artura po review Claude; pole „Data opłaty” w Admin → Firmy)

- **Kontekst**: daty pierwszeństwa wpłat (`companies.fm_payment_date`) zaimportowane 17.09 14:10 przez osobną sesję (migracje `20260917120519_fm_payment_date_guard` + dane, audit `fm_inputs_payment_date_import` ×106, raport `FreshMarket-Backups\FM-PAYMENTS-20260917-after\IMPORT_REPORT.md`; commit 9f5647a). Do 15:39 data była w bazie i w algorytmie (score DESC → payment ASC → Premium → idx), ale niewidoczna w panelu.
- **Co**: commit 9c15f94 (Codex): RPC `admin_set_fm_payment_date(company, new, expected)` SECURITY INVOKER (zalogowany, aktywny admin; firma FOR UPDATE; wymaga `fm_b2b_enabled`; optimistic lock po dacie oczekiwanej → 40001 z aktualną datą; UPDATE tylko `fm_payment_date` + `updated_at`; ta sama data = brak zapisu) + trigger `trg_audit_fm_payment_date_change` (SECURITY DEFINER, `fm_inputs_payment_date_changed`: user_id, before, after; także dla zmian z SQL Editora; błąd audytu wycofuje UPDATE). Front: `AdminFmPaymentDate.jsx` obok pakietów i w szufladzie, tylko przy włączonym B2B; zapis do stanu przez `applyPaymentDate` (omija bulk upsert); checkbox B2B wyjęty z etykiety z selectami. i18n PL/EN. Review Claude: 227/227, build, SQL test 15/15 lokalnie.
- **Kopia „przed”** (15:31, sesja admina, odczyt): `FreshMarket-Backups\FM-ADMIN-PAYDATE-20260917\przed.json` (sha256 `1f1ab052…`): 123 firm / 112 FM / 156 pakietów, 941 wyborów, 163 odpowiedzi, 92 potwierdzenia, fm_settings.
- **Migracja** `20260917124901_admin_fm_payment_date.sql` w jednej transakcji (`migracja-w-transakcji.sql`, sha256 `c1c43c69…`) w SQL Editorze ~15:36 — tylko funkcje/trigger/granty, bez zmian danych. Potwierdzenie: sonda admina na nieistniejące UUID → `fm_payment_date_not_found` (funkcja i kontrola admina działają), anon → `permission denied`. Uwaga narzędziowa: przechwytywanie odpowiedzi SQL Editora nie zadziałało w nowej karcie, wynik potwierdzony sondą RPC.
- **Deploy**: `main` c60269f → **5e69978** (ff-only: 9f5647a, 9c15f94 + 5 commitów runbooka §21–§24), Netlify deploy gotowy 15:39:26, `/version.json` = `5e69978f5987`, bundle `index-bSYc-U1p.js` zawiera „Data opłaty”/„Payment date”, `admin_set_fm_payment_date`, `payment_date_conflict`; poprzednie funkcje (pola PL/EN, RPC 055) obecne.
- **Punkt powrotu**: tag `prod-rollback-2026-09-17c` = c60269f (deploy `6aab970aff1c970008b1b16f`); rollback frontu bezpieczny przy zainstalowanej migracji; migracji i dat nie cofać.
- **Kopia „po”** (15:40): `po.json` (sha256 `548c0f47…`); porównanie `porownaj.mjs`: 0 zmian dat, pakietów, poziomów, flag, potwierdzeń; 0 dodanych/usuniętych wyborów i odpowiedzi; fm_settings bez zmian. Bez zmiany fazy, przeliczenia, publikacji planu, bez maili, bez aktywowania kont testowych, bez zmiany dat realnych firm.
- **Kontrola w panelu** (krok 4): wymaga sesji admina w przeglądarce — do wykonania przez Artura / z Arturem (pole widoczne przy włączonym B2B, niewidoczne bez). Konto testowe ma B2B wyłączone, więc pola nie pokaże — nie włączać.
- **Uwagi na później**: ostrzeżenie UI dla daty przyszłej; oznaczyć `049_fm_payment_date.sql` jako zastąpione; pliki migracji z timestampem nie wchodzą do runnera `NNN_`.

## 26. Wdrożenie fix/company-description-stale-client — 18.09.2026 09:32 (zgoda Artura po review Claude; pasek nowej wersji + audyt opisów)

- **Incydent**: 17.09 21:47–21:53 koordynatorka (Anna Wiernicka) zapisała profile Tenuta Chiaramonte, Oranfresh i Fungi Team ze STAREJ karty (bundle sprzed 09:30, 2 pola opisu) — tekst EN trafił do kolumn PL, nadpisując naprawę z 10:11 (§24). Codex 18.09 09:18 przywrócił PL z kopii i przeniósł wpisane EN do kolumn EN (PATCH sesją admina z warunkiem `id + updated_at`, audit `company_desc_stale_client_repair` ×3; kopie `FreshMarket-Backups\opisy-stale-client-2026-09-18\`). Naprawy nie powtarzano.
- **Co** (commit e16fbaf, Codex): `NewVersionBanner` zamontowany globalnie w `App.jsx` (porównuje build z `/version.json` po 30 s, co 5 min i po powrocie do karty; przed przeładowaniem czeka na zapisy, przy niezapisanym szkicu pyta) + migracja `20260918070934_company_description_audit.sql`: trigger SECURITY DEFINER `trg_audit_company_description_change` na 4 polach opisu (tylko przy realnej zmianie) → `audit_log` akcja `security_company_description_changed` (user_id, before/after 4 pól, source), prefiks zastrzeżony polityką 055 (klient nie podrobi), błąd audytu wycofuje zapis. **Pasek i audyt nie blokują zapisu ze starej karty** — Anna ma zabezpieczyć niezapisany tekst, zamknąć wszystkie karty i zalogować się ponownie; pasek działa dopiero od następnego deployu. Review Claude: 228/228, build, `scripts/company-description-audit-sql-test.mjs` 6/6 lokalnie; wzorzec definer-insert do audit_log sprawdzony na prod (fm_resps_audit).
- **Kopia „przed”** (09:30): `FreshMarket-Backups\FM-DESC-AUDIT-20260918\przed.json` (sha256 `39164b7f…`): 125 firm / 112 FM / 156 pakietów, 4 pola opisów (105 z PL, 31 z EN), daty wpłat, 989 wyborów, 172 odpowiedzi, 96 potwierdzeń, fm_settings.
- **Migracja** w jednej transakcji w SQL Editorze ~09:31 (`migracja-w-transakcji.sql`, sha256 `b94937d0…`): wynik `funcs=1, triggers=1, audit_rows=0`. Bez zmian danych.
- **Deploy**: docs branch zrebase'owany na e16fbaf; `main` 5e69978 → **86eb267** (ff-only: e16fbaf + runbook §25), Netlify ready 09:32:10, `/version.json` = `86eb267c39b6`, bundle `index-vQVuZTWB.js` zawiera „Dostępna jest nowa wersja aplikacji” / „A new version of the app”, `version.json?t=`; wcześniejsze funkcje obecne.
- **Punkt powrotu**: tag `prod-rollback-2026-09-18` = 5e69978 (deploy z 17.09 15:39). Rollback frontu bezpieczny przy zainstalowanym triggerze; triggera i danych nie cofać.
- **Kopia „po”** (09:32) + `porownaj.mjs`: 0 różnic (opisy, daty, pakiety, flagi, wybory, odpowiedzi, ustawienia).
- **Test zapisu na firmie testowej** (09:36–09:37, `TEST Fresh Market – konto testowe (nie uczestniczy)`, `09e52206…`, B2B wyłączone, sesja test.dostawca w Chrome zalogowana przez Artura, nowy bundle): dopisanie sufiksu do 4 pól → „The profile will be saved, but it is not complete yet…” → w bazie 4 pola zmienione, **1 wpis `security_company_description_changed` z autorem = konto testowe dostawcy (role supplier), before/after 4 pól, source „companies trigger”**; po przeładowaniu 4 pola pokazują nowe wartości (PL i EN osobno); przywrócenie wczorajszych tekstów przez formularz → 2. wpis audytu (before = sufiks, after = oryginał); końcowy odczyt = teksty z 17.09; eksport `po-tescie.json` + porównanie z „przed”: 0 różnic (opisy firmy testowej identyczne). Trigger działa na produkcji i nie blokuje prawidłowego zapisu.
- **Nie zmieniano**: wyborów, odpowiedzi, dat wpłat, pakietów, fazy, planu; bez maili; konto testowe nie aktywowane w B2B.

## 27. Wdrożenie feat/company-preview-language — 18.09.2026 10:44 (zgoda Artura po review Claude; przełącznik PL | EN opisu w podglądzie firmy)

- **Co** (commit c69f8c6, Codex): w `CompanyPreviewBody` (katalog kupca, podgląd przy spotkaniach FM, podgląd własny dostawcy, szuflada admina) grupa przycisków **PL | EN** nad opisem, zmieniająca tylko opis w otwartym podglądzie (stan lokalny, reset przy zmianie firmy i ponownym otwarciu; bez `changeLanguage`, bez zapisu). Domyślny wybór: `pickDescriptionSet(co, preferEn, selected)` — ręczny wybór (jeśli ma tekst) > kompletność (pełny opis = 2 > sam skrót = 1 > brak = 0; drugi język tylko przy wyższej randze) > język aplikacji; skrót i pełny zawsze z jednego języka. Brakująca wersja: przycisk nieaktywny + „Brak polskiej/angielskiej wersji”. Akapity z atrybutem `lang`. Pozostałe sekcje i ich język bez zmian; żadnego tłumaczenia. i18n `common.company_preview.description_language*` PL/EN. Review Claude 10:40: 247/247, build; hooki bez wcześniejszego return; test FmBuyerPreview sprawdza prywatność ofert/operatora i brak decyzji po przełączeniu.
- **Deploy**: `main` 86eb267 → **24f81d8** (ff-only: c69f8c6 + runbook §26), Netlify ready 10:44:03, `/version.json` = `24f81d8f3531`, bundle `index-CcrzM344.js` zawiera „Język opisu:” / „Description language:”, „Brak angielskiej wersji” / „Polish version unavailable”; pasek nowej wersji i pole „Data opłaty” obecne. Bez migracji, bez zmian danych.
- **Punkt powrotu**: tag `prod-rollback-2026-09-18b` = 86eb267 (deploy z 09:32). Rollback = Netlify „Publish deploy”, baza nietknięta.
- **Kontrola po wdrożeniu (odczyt)**: konto testowe dostawcy (test.dostawca, UI EN, sesja Chrome): „Podgląd kupca” firmy testowej (PL i EN po 4 pola) → etykieta „Description language:”, przyciski PL/EN oba aktywne (aria-label „Polish description”/„English description”), domyślnie EN (remis kompletności → język UI), klik PL → tylko teksty PL, klik EN → tylko EN; inne sekcje bez zmian. **Katalog na koncie testowym kupca** (test.kupiec, UI PL, sesja Chrome zalogowana przez Artura, build 24f81d8): Berryworld (tylko kolumny PL) → PL domyślnie, EN nieaktywny z „Brak angielskiej wersji”; CAPESPAN (tylko EN) → EN domyślnie mimo UI PL, PL nieaktywny z „Brak polskiej wersji”; HARS & HAGEBAUER (obie pełne) → PL domyślnie, klik EN → tekst EN z `lang="en"`; sekcje Asortyment/Oferta/Rynki/Certyfikaty widoczne w każdym przypadku; bez zapisu. **Moduł FM kupca testowego**: 0 dostawców wybrało sieć testową → brak podglądów do sprawdzenia (ten sam współdzielony komponent; test FmBuyerPreview pokrywa przełączenie w podglądzie FM). Bonus: karta panelu wbudowanej przeglądarki z buildem 86eb267 pokazała pasek „Dostępna jest nowa wersja aplikacji” — pasek z §26 działa na produkcji. Uwaga jakościowa: Berryworld ma angielski tekst w polu PL (bez wersji EN) — przełącznik pokazuje pola tak, jak są zapisane; ewentualna korekta danych to osobna decyzja.
- **Uwaga**: kupiec z polskim interfejsem zobaczy domyślnie EN, gdy firma ma po polsku tylko skrót, a po angielsku pełny opis (zatwierdzona reguła kompletności; przełącznik pozwala wrócić). Anka: zabezpieczyć niezapisane teksty i odświeżyć aplikację, żeby zobaczyć przełącznik.

## 28. Wdrożenie fix/fm-staff-list-relation — 19.09.2026 17:59 (zgoda Artura po 4 rundach review Codexa; lista kont obsługi + przypisanie 22 sieci KOORDYNATOR-ALEKSANDRA)

- **Przyczyna** (Codex 19.09, potwierdzona sondą GET): `listFmStaff` czytał `fm_staff` z embedem `fm_queue_assignments(queue_group_id)`; obie tabele wskazują `profiles`, nie ma między nimi klucza obcego → PostgREST `PGRST200` „Could not find a relationship … in the schema cache”; `softFail` (regex ze „schema cache”) traktował to jak brak modułu i zwracał `[]` → panel Admin → Spotkania B2B → Dzień wydarzenia → Obsługa pokazywał „Brak kont obsługi” mimo istniejącego konta KOORDYNATOR-ALEKSANDRA (utworzone 19.09 14:35, PIN jednorazowy u Artura).
- **Co** (gałąź `fix/fm-staff-list-relation`, 4 commity: 4589ebb → 1e201ac → 1643c4f → **f9234f9**; tylko `src/lib/fm-queue.js`, `src/components/admin/FmEventDay.jsx` + 2 pliki testów; bez migracji, bez zmian RLS/RPC/funkcji Netlify): (1) konta i przypisania dwoma odczytami (`fm_staff` po dniu, potem `fm_queue_assignments .in(operator_id, ids)`), łączenie w JS po `operator_id`, kontrakt `row.fm_queue_assignments=[{queue_group_id}]` zachowany, konto bez przypisań zostaje; **każdy** błąd któregokolwiek odczytu jest błędem (także brak tabeli PGRST205/42P01 → komunikat niedostępności, nie „Brak kont”); `isMissingObjectError()` tylko brak tabeli/funkcji (PGRST205/PGRST202/42P01/42883). (2) Panel: błąd odczytu = trwały komunikat „Nie udało się odczytać kont obsługi” z „Ponów odczyt” (= pełne `reload()`: grupy, ustawienia, sonda i konta); „Brak kont obsługi” tylko po udanym odczycie; wiersze powiązane z dniem odczytu (`staffView={date,rows}`), po zmianie dnia stare konta znikają, po błędzie stan sprzed błędu tylko do odczytu, wszystkie akcje (nowy PIN, blokada, usunięcie, imię, przypisania, tworzenie konta) przez `staffGuard(row)` — bez aktualnej listy i zgodnego dnia brak zapisu także przy obejściu `disabled`; jedna generacja `{gen,date}` nadawana w `reload()` przed pierwszym await dla całego przebiegu (spóźnione grupy/ustawienia/konta poprzedniego dnia nie ustawiają stanu), `reloadLive` z osobną generacją, efekty logu/spotkań z cleanup; pole daty zablokowane na czas zapisu (atrybut + guard); po utworzeniu konta i błędzie odświeżenia modal z PIN-em zostaje z „Nie twórz go ponownie”. Testy: `fm-queue-staff.test.js` (6) + `FmEventDay.staff.test.jsx` (16, w tym 4 testy regresji Codexa w oryginalnym brzmieniu); zestaw 269/269, build OK, `diff --check` czysty (Codex).
- **Review**: Codex 4× (`1FMK2026/outputs/REVIEW_DLA_CLAUDE_{4589ebb,1e201ac,1643c4f,f9234f9}_OBSLUGA.md`): P2 stare wiersze edytowalne po zmianie dnia/błędzie + fałszywe „Brak kont” przy braku tabeli → 1e201ac; P2 spóźnione grupy restartowały odczyt kont starego dnia → 1643c4f; P2 „Ponów odczyt” nie ponawiał konfiguracji + zmiana dnia w trakcie zapisu → f9234f9; f9234f9 pozytywne. Test integracyjny RLS na izolowanej bazie **niewykonany** (lokalny Postgres nieaktywny) — testy JS z atrapami nie dowodzą RLS; zmiana nie dotyka polityk ani RPC.
- **Deploy**: `main` 24f81d8 → **f9234f9** (ff-only, sam feature; runbook §27 nadal na gałęzi docs), Netlify deploy `6aaeb13add098e00085a27ae` ready 17:59:11, `/version.json` = `f9234f9bc85b`, bundle `index-DVUaQ75n.js` zawiera nowy select `operator_id, queue_group_id` i marker `PGRST205`, stary embed `fm_queue_assignments(queue_group_id)` nieobecny. Bez migracji.
- **Punkt powrotu**: tag `prod-rollback-2026-09-19` = 24f81d8 (deploy z 18.09 10:44). Rollback = Netlify „Publish deploy”, baza nietknięta.
- **Kontrola dostępu (tylko odczyty, sesje z fm-probe.env, build f9234f9)**: `fm_staff`, `fm_staff` po kodzie, `fm_queue_assignments` (wszystkie i po operatorze), `fm_queue_log action=assign`: anon → `42501` we wszystkich; dostawca → 0 wierszy; kupiec → 0 wierszy; admin → 3 konta obsługi / 1 po kodzie / przypisania czytelne. RLS bez zmian.
- **Przypisanie 22 sieci (18:0x, RPC `fm_queue_assign_retailer` sesją admina, po jednej sieci, stop na pierwszym błędzie; kopie `FreshMarket-Backups/FM-STAFF-ASSIGN-20260919/przed.json|po.json`)**: kontrola wstępna — dokładnie 1 konto `KOORDYNATOR-ALEKSANDRA` id `49acd581-45bf-4835-9025-dc009a0f127a`, rola `staff`, dzień 2026-09-24, aktywne, niezablokowane, bez urządzenia, `last_login_at` null, 0 przypisań (wszystkich przypisań w tabeli: 0); 22 sieci zmapowane po nazwie na `retailers.id` (AIBĖ #136, Albert CZ/Bakker #114, Arhelan #123, ATB Market #118, Auchan Polska #104, Biedronka #100, Carrefour Polska #103, Dino Polska #107, Dobronom #135, E.Leclerc #108, Fantastico #129, Fozzy Group #127, FRAC #142, Makro Polska #111, Polomarket #113, PROMO Cash and Carry #125, Rohlik #122, Spar Polska #120, Stokrotka #110, TOPAZ #121, Twój Market #139, Umai Group #143), każda `fm26_active` z grupą kolejek 24.09 (Dino: Owoce + Kwiaty). Wynik: 22 wywołania, `changed` 1×21 + 2 (Dino) = **23 grupy**, przypisania operatora po: 23 = oczekiwane 23, brak/nadmiar 0, inne przypisania bez zmian, audyt `fm_queue_log action=assign` 22 wpisy z `payload.operator_id`; konto po: dzień/aktywność/blokada/urządzenie/`last_login_at` bez zmian. Poza zakresem (nie przypisane): Mega Image #133 (ma grupę, nie na liście), SPAR/GK Specjał #137 (nieaktywna, bez grupy), Euro Opt (brak potwierdzenia udziału). Nie tworzono konta, nie resetowano PIN-u, nie logowano się kontem, nie zmieniano dnia, Gate, stanowisk, planu, wyborów ani fazy; bez maili.
- **Zostaje**: kontrola panelu w przeglądarce sesją admina Artura (Obsługa → konto z 22 sieciami, checkboxy aktywne, brak „Brak kont”); scalenie gałęzi docs (§27–§28) z `main` przy następnym wdrożeniu; test integracyjny RLS na izolowanej bazie przy najbliższej okazji.

## 29. Wdrożenie feat/fm-decision-source — 20.09.2026 16:01 (zgoda Artura „wdrażamy” po 4 rundach review Codexa; oznaczenie „Wybrane przez administratora” + migracja fm_decision_sources)

- **Co** (gałąź `feat/fm-decision-source`, 5 commitów 689934c → 7f3343e → a75ca3f → e0d216c → **282bcb5** (ostatni = poprawka Codexa a25c431 przejęta przez `git am`)): tabela `fm_decision_sources` (encja target/resp, firma, sieć, decyzja, `source` supplier|buyer|admin|automatic|system, autor → profil, czas) z JEDYNĄ polityką SELECT dla admina; użytkownicy czytają własne wpisy przez RPC `fm_my_decision_sources()` bez autora i czasu; zapis tylko z RPC `fm_set_company_targets` (055 + różnica list, trigger wyłączany flagą `fm.targets_rpc`), triggera `trg_ctr_decision_source` (zapisy poza RPC: INSERT/zmiana klasy/DELETE) i triggera `trg_fm_resps_decision_source` (tylko zmiana decyzji). Front: `DecisionSourceBadge` (PL/EN, admin widzi autora i czas), panel dostawcy przy własnym wyborze, panel kupca przy własnej decyzji, „Dane wejściowe” obie strony (Dostawcy i Sieci); magazyn `fm-decision-sources-store.js` (token/settle/restore per zapis, ochrona przed spóźnionym odczytem), kolejka zapisów kupca per para. Algorytm i istniejące wybory bez zmian (brak backfillu). Notatki: `1FMK2026/outputs/NOTATKA_DLA_CODEX_2026-09-20_ZRODLO_DECYZJI.md` (v1–v5) + review Codexa 689934c/7f3343e/a75ca3f.
- **Deploy frontu**: `main` f9234f9 → **282bcb5** (ff-only), Netlify `6aafe734ad9db0000888c33c` ready 16:01:46, `/version.json` = `282bcb55a090`, bundle zawiera `fm_my_decision_sources`, `fm_decision_sources`, `decision-source-admin`.
- **Migracja** `20260920130000_fm_decision_sources.sql` w SQL Editorze 16:02 (Monaco `setValue` + LF, sha256 `72e4b4eb…` zgodna z repo, dialog „destructive operations” → Run query, odpowiedź 201 `[]`). Kontrola obiektów (SQL, odczyt): polityki = `fds_admin_read:SELECT`; triggery `trg_ctr_decision_source`, `trg_fm_resps_decision_source`; funkcje `ctr_decision_source`, `fm_decision_source_of_caller`, `fm_my_decision_sources`, `fm_resps_decision_source`, `fm_set_company_targets` (prosrc zawiera `fm.targets_rpc`); uprawnienia: authenticated SELECT tak / INSERT nie, anon SELECT nie, RPC anon nie / authenticated tak; RLS włączone; CHECK z `system`; 0 wierszy.
- **Punkt powrotu**: tag `prod-rollback-2026-09-20` = f9234f9 (deploy z 19.09 17:59). Rollback fail-closed: Netlify „Publish deploy” poprzedniej wersji + `drop trigger trg_fm_resps_decision_source / trg_ctr_decision_source` + przywrócenie `fm_set_company_targets` z 055; tabela i RPC odczytu mogą zostać.
- **Dane przed/po**: kopie `FreshMarket-Backups/FM-DECISION-SOURCE-20260920/{przed,po,po-tescie}.json` (company_target_retailers 1093 wierszy, fm_resps 257; sha256 rdzenia `12b39207…` identyczna przed migracją, po migracji i po teście funkcjonalnym).
- **Test funkcjonalny na prod (tylko encje testowe: firma testowa `09e52206…` fm_b2b_enabled=false/suspended, sieć testowa #990901 fm26_active=false — nic nie aktywowano), 24/24 PASS**: admin (RPC) ustawia wybór ZA firmę testową → wpis target/admin/star z autorem z profilu; dostawca (RPC) widzi 1 własny wpis bez autora i czasu, tabela 0 wierszy; kupiec 0; admin wstawia „Daj szansę” ZA sieć testową → kupiec (RPC) 1 własna decyzja resp/admin, dostawca nadal tylko target (decyzja kupca niewidoczna), kupiec nie widzi wyboru dostawcy; sprzątanie: decyzja usunięta, poprzednia (pusta) lista wyborów przywrócona, 0 wpisów źródeł dla firmy testowej, tabela w całości 0 wierszy. Audyt `fm_targets_saved` ×2 dla firmy testowej (meta.source=admin).
- **Zostaje**: kontrola wizualna oznaczenia na kontach testowych w przeglądarce (Artur), decyzja o ewentualnym oznaczeniu 20 historycznych odmów Biedronki (osobny zakres); poprawka pojemności `066335c` (`fix/fm-queue-capacity-save`) czeka na osobną zgodę — wymaga rebase na 282bcb5.

## 30. Wdrożenie poprawki pojemności (fix/fm-queue-capacity-save) + oznaczenie 20 odmów Biedronki — 20.09.2026 16:19 / 16:26 (wykonał Codex za zgodą Artura; kontrola niezależna Claude)

- **Co**: trzy commity gałęzi `fix/fm-queue-capacity-save` (c78b885 Codex: grupa — UPDATE po id / INSERT bez id zamiast partial upsert, który odrzucał zapis „Spotk./stan.” przez NOT NULL `event_date`/`retailer_id`; b53f406 Claude: to samo dla stanowisk; 066335c Claude: osobny przełącznik aktywności, przycisk ✎ etykiety i × usunięcia, blokada na czas zapisu) cherry-pick jako b955513 → aa5401f → **cb86306** na `main` (po 282bcb5). Kontrola Claude: `git diff 066335c cb86306` na 6 plikach poprawki = brak różnic. Vitest 336/336, build OK (Codex). Bez migracji.
- **Deploy**: Netlify `6aafeb7368a2940008ec79a3` ready 16:19:51, `/version.json` = `cb8630616a4a`. Tag **`prod-rollback-2026-09-20-capacity`** = 282bcb5 (deploy 6aafe734…). Rollback = Netlify „Publish deploy” 6aafe734…; baza bez zmian.
- **Backfill Biedronki** (SQL Editor 16:26:12, `1FMK2026/outputs/deploy-capacity-biedronka-20260920/biedronka-backfill.sql`, transakcja repeatable read z kontrolami tożsamości sieci, listy 20 odmów i oryginalnego audytu): 20 wierszy `fm_decision_sources` (resp, retailer 100, decision remove, source admin, autor = profil Artura `b12f618e…`, czas z oryginalnego audytu 2026-09-20T09:45:09Z) + wpis `audit_log` `fm_decision_sources_backfill`. Kontrola niezależna Claude (sesja admina sondy, odczyt): 20/20 wierszy z właściwą encją, siecią, decyzją, źródłem, autorem (z profilu) i czasem; każda z 20 odmów ma źródło, „Daj szansę” bez źródła, żadnych innych wpisów; wybory 1093 / odpowiedzi 257 — sha256 rdzenia identyczna jak po teście z §29; sondy dostawcy i kupca: tabela 0 / RPC 0.
- **Zostaje**: test interakcji w panelu administratora na grupie testowej (zmiana pojemności 60→50→60, przełączenie stanowiska, etykieta) — Chrome miał sesję konta obsługi; ustawienie „Spotk./stan.” = 20 dla POLOmarket, Dobronom, SPAR, Twój Market (Artur, po zgodzie na D1/D5 z symulacji).

## 31. Wdrożenie fix/fm-late-selections-persist — 20.09.2026 19:56 / 19:59 (zgoda Artura „wdrażaj” po review Claude; pełna lista kupca w fazie 3 + osobne zgłoszenia kupców do ręcznych korekt)

- **Co**: commit Codexa **a51f93e** (baza cb86306). Lista kupca w fazie 3 pokazuje cztery statusy (Chcę / Daj szansę / Daj szansę — automatycznie / Nie chcę) zamiast tylko jawnych wierszy `fm_resps` (`if (!resp) return null` ukrywało 54 zagraniczne firmy Biedronki bez odpowiedzi). Nowe `LateSelections.jsx` + `fm-late-selections.js`: admin (FM Spotkania → Korekty) otwiera/zamyka przyjmowanie zgłoszeń per sieć i widzi skrzynkę zgłoszeń; kupiec pod listą preferencji zgłasza Chcę/Daj szansę do ręcznych korekt. Zgłoszenia nie zmieniają wyborów, odpowiedzi, źródeł decyzji ani planu. Usunięty stary lokalny checkbox `lateSelectionEnabled` (per przeglądarka). Review Claude: Vitest 350/350, build OK, `git diff --check` OK, test SQL od zera na embedded PG 17 (wszystkie migracje + nowa 2×, ROLLBACK) PASS, `fm-algo.js`/`db.js` nietknięte, mapowanie faz `normalizeFmSettings` (matching/algorithm/corrections = faza 3) zgodne z gatem SQL.
- **Migracja** `20260920171936_fm_late_selections_access.sql` (SQL Editor 19:56, sha256 `d6b21a52…fdc08`, 4586 B, dialog „destructive” potwierdzony, wynik `[]`): nowa tabela `fm_late_selection_access(retailer_id PK → retailers, enabled)`; funkcja `fm_late_selection_allowed(integer)` SECURITY INVOKER, `search_path=''` (kupiec, własna sieć, `algo_phase` ∈ matching/algorithm/corrections, dostęp otwarty, sieć `active` + `fm26_active`); na `fm_late_resps` zamiast `fmlr_buyer_own` (FOR ALL, bez ograniczeń) polityki `fmlr_buyer_read` (własna sieć, historia po zamknięciu), `fmlr_buyer_insert`/`_update` (gate + zone ∈ want/chance + firma `fm_b2b_enabled` i `active`), `fmlr_buyer_delete` (gate); anon i public bez uprawnień. Przed migracją odczyt `pg_policies`: na produkcji były dokładnie `fmlr_admin_all` i `fmlr_buyer_own` z migracji 008 (brak polityk spoza repo). Po migracji zweryfikowane: 8 polityk zgodnie z plikiem, RLS włączone na obu tabelach, ACL tylko postgres/authenticated/service_role, funkcja `secdef=false`, 0 wierszy w obu tabelach (`fm_late_resps` było puste także przed). Stary front zgodny z nowym RLS (czyta tak samo, w produkcji nie zapisywał) — dlatego kolejność migracja → front.
- **Deploy**: `main` cb86306 → ff `a51f93e` → ff `docs/runbook-22-category-fill` (§27–§30, tylko `docs/`) = **3deae2d**, push 19:58:46. Netlify `6ab01eda4624540008dfd6b8` ready, published 19:59:09, `/version.json` = `3deae2d62495`, bundle `index-MpVNplje.js` zawiera `fm_late_selection_access` i teksty nowych paneli. Tag **`prod-rollback-2026-09-20c`** = cb86306 (deploy 6ab01eda… poprzedni: 6aafeb73…). Rollback fail-closed: `update fm_late_selection_access set enabled=false` + Netlify „Publish deploy” 6aafeb73… (cb86306); tabele i zaostrzone RLS zostają, algorytmu nie uruchamiać.
- **Kopie**: `FreshMarket-Backups/FM-LATE-SELECTIONS-20260920/` — `przed`, `po-migracji`, `po-tescie` (`.json.dpapi`, sha256 w `MANIFEST.txt`; sesja admina sond, tylko odczyt): companies 134, retailers 52, wybory 1177, odpowiedzi 279, źródła 126, grupy 32, stanowiska 33, `fm_late_resps` 0, `fm_plan_private` 0, `fm_settings` algo_phase=matching (updated_at 17:46:24Z). Odciski md5 11 tabel/kolumn identyczne przed ↔ po migracji ↔ po teście.
- **Test RLS na encjach testowych** (19:59, sieć TEST #990901 `active=false`/`fm26_active=false`, firma testowa `09e52206…` suspended/B2B off — bez aktywacji): admin otwiera dostęp → kupiec testowy widzi własny wiersz `enabled=true`, `fm_late_selection_allowed`=false (sieć nieaktywna); kupiec upsert zgłoszenia → 42501, kupiec upsert dostępu → 42501; admin wpisuje zgłoszenie → kupiec je widzi (fmlr_buyer_read); kupiec DELETE → zero wierszy → PGRST116 (front traktuje jako błąd, nie jako usunięcie); admin zamyka → kupiec widzi `enabled=false` i historię; sprzątanie: zgłoszenie i wiersz dostępu usunięte, `admin-read` 0/0. Pozytywna ścieżka zapisu kupca (otwarta, aktywna sieć) sprawdzona wyłącznie lokalnie (test SQL) — na produkcji wymagałaby aktywnej sieci testowej.
- **Zostaje**: kontrola wizualna po zalogowaniu Artura (Chrome ma sesję konta obsługi „Konto testowe na 20.09”, nie admina): Korekty → „Zgłoszenia kupców do ręcznych korekt” (wszystkie sieci zamknięte), podgląd konta Biedronki → lista czterech statusów (55 zagranicznych firm jako „Daj szansę — automatycznie”, 20 odmów PL); sprzątanie nieużywanych kluczy i18n `fm.buyer.phase3_late_*`, `fm.admin.late_*`, `fm.admin.preview_late_toggle_*`.
