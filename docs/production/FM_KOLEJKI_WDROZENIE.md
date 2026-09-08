# Kolejki / numerki spotkań B2B — runbook wdrożenia (FM 2026, 24.09)

Stan: **v4.4 zmergowane do `feat/admin-instructions-announcements` (= commit Codexa `1ea67d2`). Codex: AKCEPTACJA KOŃCOWA (7.09). NIE na main, migracje NIE na produkcji.** Do zgody „wdrażaj”: upgrade produkcji Nano → Micro w spokojnym oknie (< 2 min przerwy). Gałąź testowa Supabase usunięta (~0,013 USD).
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

## 2a. Test przed zgodą na produkcję — tymczasowa gałąź Supabase (plan Codexa, 7.09)

Produkcja: plan **Pro**, compute **Nano** (`t4g.nano`, ~21/60 połączeń, 62–65% RAM). Bezpłatny upgrade do **Micro** (2× RAM, ten sam limit połączeń, < 2 min przerwy) — zalecany przez Supabase dla organizacji płatnych.

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

## 5a. Weryfikacja dostawcy przez obsługę (gałąź `feat/staff-meeting-list`, 8.09 — do review)

Operator jest osobą zewnętrzną i nie zna dostawców. Sam numer NIE jest weryfikacją. Przebieg przy stanowisku:

1. Dostawca podaje firmę, sieć i numer oraz pokazuje kartę spotkania (lub ekran „Twoja kolej”).
2. Operator ma wybrane właściwe stanowisko (sieć / grupa — Dino · Owoce i Dino · Kwiaty to osobne kolejki). Przy **TERAZ** widzi: „Sieć · stanowisko N”, **„Numer 12 — pełna nazwa firmy”** (zawijana, nigdy ucięta), status („Wywołany — oczekujemy na dostawcę”, „W trakcie — spotkanie trwa”) i wskazówkę weryfikacyjną.
3. Jeśli osoba nie jest przy TERAZ: **„☰ Lista spotkań”** → szukanie po numerze lub nazwie (bez polskich znaków), filtry Wszystkie / Oczekujące / Wywołane–w trakcie / **Odbyte** (tylko zakończone) / **Pominięte–anulowane** / Nieobecni–powracający, kolumna **Stanowisko** (Auchan ×2 = wspólna kolejka), wiersz → godziny wywołania / rozpoczęcia / zakończenia. **Status pochodzi z rekordu spotkania** — niższy numer nie oznacza „zakończone”. Filtry są przeglądowe, nie rozłączne (powracający w trakcie liczy się w dwóch), więc liczniki nie sumują się do „Wszystkie”.
4. Zgadza się → skierowanie do kupca i istniejący przycisk „Rozpocznij spotkanie”. Nie zgadza się (inna firma, spotkanie już zakończone/nieobecny) → administrator. Lista nie ma żadnych akcji zmieniających stan; bez automatycznego wyjątku i bez „rozpocznij ponownie”.
5. Lista odświeża się po każdej operacji, z Realtime (drugi tablet), co 10 s oraz po powrocie łącza i powrocie do karty. Wiersze są **związane z grupą z nagłówka** — po zmianie sieci nigdy nie widać listy poprzedniej; gdy danych tej sieci jeszcze nie ma, panel pokazuje „wczytywanie” albo błąd, nie starą listę i nie „brak spotkań”. Odczyt ma limit 10 s, a dane starsze niż 25 s są oznaczane jako nieaktualne — samo działające Wi-Fi nie oznacza aktualnych danych. Starsza odpowiedź nigdy nie nadpisuje nowszego statusu: odczyty, Realtime, wyniki operacji i zasiew ze stanowisk przechodzą przez jedną bramkę (generacja wyboru stanowiska + wersja stanowiska/grupy z bazy), a wynik operacji rozpoczętej na innym stanowisku nie zmienia ekranu, listy ani „Cofnij”.

Widoczność: RLS 053 bez zmian (admin + obsługa przypisana do sieci); `/tablice` i snapshot nadal bez nazw dostawców. Podgląd z danymi testowymi (tylko dev): `/obsluga-demo?station=s-au-2&view=list`; zrzuty 1024×768: `docs/production/img/obsluga-lista/`. Notatki review: `NOTATKA_DLA_CODEX_2026-09-08_OBSLUGA_LISTA_SPOTKAN.md` → `_v2.md` → `_v3.md`.

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
