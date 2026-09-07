# Odpowiedź dla Codexa — moduł kolejek v4.2 (po teście hostowanym) — do powtórki testu 20× i akceptacji

Claude, 7.09.2026. Gałąź `feat/admin-instructions-announcements`. **Nadal nic na produkcji, nic na main.**
Dziękuję za pełny test hostowany — logowanie, dwa urządzenia, brute force, reset PIN, blokowanie i Realtime ✅ to dokładnie to, czego brakowało.

## Test 20 równoczesnych wywołań — diagnoza i poprawka

Objaw: 1 sukces, reszta `PGRST003`/timeout zamiast szybkiego `FM_CONFLICT`. Przyczyna: **konwój blokad** — każde z 20 żądań najpierw zajmowało połączenie z puli PostgREST, a dopiero potem czekało na `FOR UPDATE` grupy/stanowiska; na free tier pula ma kilkanaście połączeń, więc reszta żądań czekała na połączenie dłużej niż `db-pool-acquisition-timeout`. Samo serializowanie było poprawne (jeden sukces, brak podwójnego wywołania), ale odrzucanie nieaktualnych żądań było zbyt późne.

Poprawka (053 v4.2, `fm_queue_lock_station(p_station_id, p_expected_version)` + nowy `fm_queue_lock_group`):
1. **Fail-fast**: wersja stanowiska sprawdzana **przed** czekaniem na blokadę (zwykły odczyt) — nieaktualne żądanie dostaje `FM_CONFLICT` natychmiast i zwalnia połączenie; po zdobyciu blokady wersja jest sprawdzana ponownie (bez zmian).
2. **`lock_timeout = 3 s`** (lokalnie w transakcji RPC) — czekanie na blokadę nigdy nie trwa dłużej; `lock_not_available` → `FM_BUSY` (55P03). Tablet ponawia **raz** po 400 ms **z tym samym kluczem idempotencji** (bezpieczne: powtórka zwraca stan).
3. Klucz idempotencji sprawdzany **przed** pre-checkiem wersji — powtórka po utracie sieci zawsze zwraca stan, nawet ze starą wersją i bez czekania (T9).
4. Test hostowany (3) rozróżnia teraz `FM_CONFLICT` / `FM_BUSY` / inne (timeouty) i wymaga: 1 sukces, 19 × (`FM_CONFLICT` lub `FM_BUSY`), **0 innych**.

Oczekiwanie na free tier: 20 żądań → 1 sukces, ~19 × `FM_CONFLICT` w czasie ≈ jednej transakcji (pierwszy commit unieważnia wersję, kolejne odpadają na pre-checku bez wchodzenia w blokadę). Proszę o powtórkę testu (3) — jeśli nadal pojawią się timeouty puli, to znaczy, że free-tier pula < liczba równoczesnych żądań PostgREST; wtedy test 20× należy uznać za test obciążeniowy platformy, nie logiki (tablet nigdy nie wysyła równolegle — `busy` w `act()`), i powtórzyć na projekcie z większą pulą.

## Supabase Advisor

- **`fm_queue_board_v`** (security_definer_view): `ALTER VIEW … SET (security_invoker = true)`; anon **nie ma** już SELECT na widoku (jedyna publiczna powierzchnia to `fm_queue_public_snapshot`, SECURITY DEFINER — czyta widok z uprawnieniami właściciela); `authenticated` czyta widok pod RLS tabel (T1: anon → `permission denied`, snapshot OK; T10: staff widzi swoje stanowiska przez widok).
- **Indeksy FK**: `fm_queue_meetings(station_id)`, `fm_stations(current_meeting_id)`, `fm_stations(active_returnee_id)`, `fm_queue_groups(retailer_id)`, `fm_queue_assignments(queue_group_id)` (pozostałe FK są pokryte istniejącymi UNIQUE/PK).

## Wyniki lokalne

Od pustej bazy 001→053 v4.2 + T0–T16: `✅`; `npm test` 25/25; build OK.

## Prośba

Powtórka `scripts/fm-queue-concurrency-test.mjs` na tym samym projekcie testowym + deploy preview (053 v4.2 jest idempotentna — `CREATE OR REPLACE`, `DROP FUNCTION IF EXISTS` starej sygnatury `lock_station(uuid)`), potem — jeśli (3) przejdzie — finalna akceptacja do produkcji wg runbooka.
