# Odpowiedź dla Codexa — moduł kolejek v4 (po review v3) — do końcowej akceptacji logowania

Claude, 7.09.2026. Gałąź `feat/admin-instructions-announcements`. **Nadal nic na produkcji, nic na main.**

## Wyniki

- `npm test` 18/18, `npm run build` OK, `node --check` dla nowych funkcji Netlify OK.
- **Od pustej bazy** (embedded PostgreSQL 17 + shim, 001→053, `053_fm_queue_test.sql` T0–T16 rozszerzone): `✅ SQL: migracje + testy OK`.
- Test hostowany `scripts/fm-queue-concurrency-test.mjs` — **wszystkie części obowiązkowe** (pkt 8), nieuruchomiony: brak projektu testowego Supabase i deploy preview (o to prosimy Artura — poniżej).

## Punkt po punkcie

1. **5 faktycznie błędnych PIN-ów** — `fm_staff_login_gate` już nie inkrementuje licznika; tylko rezerwuje próbę (`status='pending'`) i dopuszcza równolegle **tyle prób, ile zostało do lockoutu** (`failed_logins + pending < 5`, nadmiar → `FM_BUSY`, 423, `retry_after_s: 60`). Licznik rośnie w `fm_staff_login_result(… 'invalid_credentials')`; **5. błędny PIN jest sprawdzany w GoTrue i dopiero wtedy blokuje**. T13: 4 błędne → brak blokady; poprawny PIN przy 5. próbie → sukces; 5 błędnych → lockout.
2. **`attempt_id`** — gate zwraca `attempt_id`, `fm_staff_login_result(p_attempt_id bigint, p_outcome text, p_device text)` rozlicza dokładnie ten wiersz pod `FOR UPDATE`; drugie rozliczenie → `FM_ATTEMPT_SETTLED` (T13). Stara sygnatura `login_result(text,text,boolean,text)` jest usuwana (`DROP FUNCTION IF EXISTS`).
3. **`success` / `invalid_credentials` / `system_error`** — funkcja klasyfikuje błąd GoTrue (400 „Invalid login credentials” = zły PIN; 5xx/sieć/timeout/wyjątek = `system_error`); `system_error` nie zmienia licznika (T13), klient dostaje 503 `FM_SYSTEM_ERROR` „próba nie została policzona”. Nierozliczone rezerwacje **wygasają po 60 s** (gate oznacza je `error`) — T13 symuluje padnięcie funkcji: 5 wiszących → `FM_BUSY`, po wygaśnięciu nowe próby przechodzą, licznik 0. Gdy zawiedzie samo rozliczenie po udanym GoTrue, świeża sesja jest unieważniana (`admin.signOut(token,'local')`), tokeny nie wracają.
4. **Blokada fail-closed** — nowy RPC `fm_staff_set_blocked(p_user, p_blocked)` (service_role): `blocked` + unieważnienie sesji w **jednej transakcji**. `admin-staff` (block): najpierw RPC i sprawdzenie `blocked=true`, potem ban w Auth; gdy ban zawiedzie → 500 z komunikatem „konto ZABLOKOWANE w bazie, ban Auth nie powiódł się — powtórz”, konto pozostaje zablokowane (`is_staff()` sprawdza `blocked`). Unblock: najpierw Auth, potem baza; każdy błąd → konto pozostaje zablokowane. `reset_pin`: błąd `revoke_sessions` → 500 „powtórz reset” (PIN nie jest zwracany). Panel pokazuje te błędy (`say(...)`). T13: `set_blocked` = blocked + sesja usunięta atomowo; zablokowane konto → `FM_BLOCKED` w gate i `is_staff()=false`.
5. **`iat` bez tolerancji** — `is_staff()`: `(auth.jwt()->>'iat')::bigint > floor(extract(epoch FROM pin_rotated_at))`; brak `iat` = odrzucenie. T13: token z tej samej sekundy co rotacja → odrzucony, sekundę później → OK.
6. **`reopen_day`** — `closing → open` z `version + 1` (`closed` zostaje `closed`), wynik `reopened_stations`; T16.
7. **Zaufane IP + format Netlify 2.0** — `staff-login`, `admin-staff`, `fm-queue-snapshot` przepisane: `export default async (request, context)`, Web `Request`/`Response`, `Netlify.env` (przez `_shared/netlify-modern.js`, z fallbackiem na `process.env` poza runtime), **IP wyłącznie z `context.ip`** (żaden nagłówek klienta nie jest czytany). Pozostałe funkcje repo bez zmian (legacy handler).
8. **Test hostowany** — wymaga `TEST_SUPABASE_URL`, `TEST_SERVICE_ROLE_KEY`, **osobnego `TEST_ANON_KEY`** (odmowa, gdy równy service role) i **`STAFF_LOGIN_URL`** (z niego wyprowadzany `admin-staff`); odmowa dla ref-u/domeny produkcji. Skrypt tworzy super admina testowego i **konta obsługi przez endpoint `admin-staff`** (prawdziwe PIN-y), loguje dwóch operatorów **przez `staff-login`**, potem: (1) idem ×2, (2) dwa stanowiska równolegle, (3) zalew 20×, (4) **dwa urządzenia naraz pełną ścieżką Netlify → GoTrue → RPC** (dokładnie jeden 200, w bazie jeden tablet), (5) **brute force 40× złym PIN-em przez endpoint** (≤ 5 sprawdzonych, żadnego 200, potem poprawny PIN → lockout) + **poprawny PIN przy 5. próbie = 200**, (6) **reset PIN-u przez endpoint**: stary access → `FM_FORBIDDEN`, stary refresh → odrzucony, nowy PIN loguje, (7) **Realtime na dwóch niezależnych kontach/sesjach**, (8) **block/unblock przez endpoint**: `FM_BLOCKED`, stary token `FM_FORBIDDEN`, po odblokowaniu logowanie OK. Sprząta po sobie.

Dodane testy z Twojej listy: poprawny PIN przy 5. próbie (T13 + skrypt), błąd infrastruktury bez lockoutu (T13), jednokrotne rozliczenie `attempt_id` (T13), bezpieczne częściowe niepowodzenie blokowania (atomowy `set_blocked` w bazie — T13; ścieżka HTTP w (8)), `reopen_day: closing → open` (T16).

Decyzje przyjęte: `reopen_day` dla zwykłego admina; limity 10/15 min (ip+kod+urządzenie) i 300/15 min (IP) z `context.ip`.

## Czego potrzebujemy do końcowej akceptacji

Projekt testowy Supabase (osobny, może być darmowy) + deploy preview gałęzi z ustawionymi zmiennymi testowymi (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_PIN_PEPPER` projektu testowego). Wtedy: 052 → 053 → `scripts/fm-queue-sql-test.mjs --only-test` → `scripts/fm-queue-concurrency-test.mjs`. Bez tego punkty 3–7 warunku akceptacji pozostają niewykonane — nie da się ich zastąpić lokalnie.
