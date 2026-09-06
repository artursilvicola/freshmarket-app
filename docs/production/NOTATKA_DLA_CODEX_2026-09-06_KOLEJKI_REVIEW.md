# Notatka dla Codexa — moduł kolejek: prośba o review bezpieczeństwa przed migracją

Claude, 6.09.2026 (wieczór). Gałąź `feat/admin-instructions-announcements`, commity od `5ea8161` do HEAD.
Zgodnie z Twoim poleceniem: **nic nie zostało zaaplikowane na produkcyjnej bazie ani wdrożone na main.**
Runbook: `docs/production/FM_KOLEJKI_WDROZENIE.md`.

## Zrealizowane wg „Kolejności prac”

1. Docs — sekcja 14 (decyzje 1–20) w `FM_KOLEJKI_NUMERKI_PROPOZYCJA.md`.
2. `052_staff_role.sql` — tylko `ALTER TYPE … ADD VALUE 'staff'` (osobne uruchomienie).
3. Model — `053_fm_queue.sql`: `fm_staff`, `fm_queue_groups` (właściciel numeracji, `last_called_nr`, `meetings_per_station`, `categories` do splitu), `fm_stations` (fizyczne, `mode`, `current_meeting_id`, `active_returnee_id`), `fm_queue_meetings` (stany), `fm_queue_assignments`, `fm_queue_log` (append-only, unikalny `idempotency_key`), `fm_queue_settings`.
4. RPC SECURITY DEFINER (`SET search_path = public, pg_temp`): `open_station, call_next, start, finish_and_call_next, no_show, skip, mark_returned, serve_returnee, finish_returnee, add_exception, set_mode, undo, open_day, close_all, assign_retailer, my_stations, station_state, public_snapshot`. Każda: `auth.uid()` → admin lub `is_staff()` + przypisanie do grupy; `FOR UPDATE` na stanowisku (i grupie tam, gdzie zmienia się numer); `p_expected_version` → `FM_CONFLICT` (SQLSTATE 40001); klucz idempotencji; log.
5. Algorytm — `src/lib/fm-algo.js` (wyciągnięty z PreconnectFM bez zmian logiki A–F, tie-breakerów i FM_MIN_GAP). Nowe: `chainCapacity()` = `meetingsPerStation × aktywne stanowiska` (domyślnie 5, z `fm_queue_groups`), brak konfiguracji → fallback 1 + ostrzeżenie `no_station_config`; wyczerpana pojemność → ostrzeżenie `chain_full`. `FM_MAX_S` = tylko przestrzeń numeracji. Diff rdzenia do Twojego review: commit `42893af`.
6. Testy — `npm test` (vitest, 17 testów algorytmu: pojemność 1→5/2→10/3→15, fallback, jawna pojemność dla splitu, FM_MAX_M, FM_MIN_GAP, unikalność numerów, Premium przy remisie, Standard/remove, mutual > jednostronne, puste listy). SQL: `supabase/tests/053_fm_queue_test.sql` — T1–T11 w transakcji z ROLLBACK (anon, uprawnienia, forward-only, finish+next atomowo, bariera powracającego, wyjątek max+1, undo, konflikt wersji, idempotencja, RLS staff/dostawca, parallel ×2). **Nie mogłem go uruchomić — nie mam bazy testowej; proszę o uruchomienie na branchu Supabase.**
7. `/obsluga` — logowanie kod + PIN (`staff-login`), panel operatora (duże przyciski, TERAZ/NASTĘPNY, powracający, nieobecni, wyjątek, cofnij 30 s, tryby, offline-guard, retry z tym samym kluczem idempotencji, Realtime + polling 10 s).
8. Admin „Dzień wydarzenia” — stanowiska/grupy/split, konta obsługi (PIN raz), przypisania, Otwórz dzień (import `fm_settings.schedule.nums`), Zamknij wszystkie, Na żywo, ustawienia tablicy, log + CSV.
9. `/tablica` — 1024×768, ciemna, GATE, paginacja po równo (10/9/9), rotacja z ustawień, PL/EN, mobile bez rotacji; snapshot przez funkcję Netlify z cache 5 s (anon), fallback RPC.
10. Dostawca „Twoja kolej” — własne spotkania (RLS) + snapshot co 8 s; renderuje się dopiero po imporcie planu.
11. E2E na tabletach / rzutniku / 300 klientów — do zrobienia na próbie generalnej (Twoja część wg podziału).

## Proszę o review (w tej kolejności)

1. **`053_fm_queue.sql`** — RLS (szczególnie: `fm_queue_groups`/`fm_stations` SELECT dla `authenticated` — świadoma decyzja, żeby algorytm liczył tę samą pojemność u wszystkich ról; jeśli uznasz, że kupiec/dostawca nie powinien widzieć liczby stanowisk sieci, zawężę do admin+staff i przeniosę pojemność do `fm_settings.schedule.meta`), widok `fm_queue_board_v` (security_invoker=false celowo — anon czyta tylko projekcję), granty (Supabase nadaje EXECUTE anon/authenticated przez default privileges — odbieram wszystko i nadaję jawnie; helpery `assert/log_write/idem_done` bez grantów), `handle_new_user` z `'staff'`.
2. **RPC** — blokady (kolejność: stanowisko → grupa → spotkanie; `mark_returned`: spotkanie → grupa), `undo` (tylko ostatnia niecofnięta operacja stanowiska ≤ 30 s), `finish_and_call_next` (blok EXCEPTION P0002 = pusta kolejka), `open_day` (routing splitu po `companies.categories && groups.categories`, idempotentny per grupa).
3. **Logowanie obsługi** — `netlify/functions/_shared/staff-auth.js`: hasło GoTrue = HMAC(pepper, kod:PIN); lockout 5/15 min; PIN nie trafia do logów ani do bazy; `admin-staff` ban w Auth przy blokadzie. Pepper ustawiony jako secret w Netlify (production).
4. **Diff algorytmu** (`42893af`) — pojemność sieci.

## Pytania otwarte (nie blokują review)

- **Wartość „5 spotkań na stanowisko”**: to jest limit CAŁODNIOWY sieci w algorytmie. Przy 65 firmach × do 5 spotkań (~300 par) i 22 sieciach × 5 = 110 miejsc większość firm dostanie 1–2 spotkania, a 2025 miał sieci z 40–53 numerami. Parametr jest edytowalny per sieć w „Dzień wydarzenia” (1–60) i globalnie (`FM_MEETINGS_PER_STATION`). Proszę Artura o potwierdzenie liczby przed 17.09.
- Konto typu `board` w `fm_staff` istnieje (kiosk logowany), ale tablica działa bez logowania (snapshot anon) — zostawić czy usunąć?
- Realtime `postgres_changes` na `fm_stations` wymaga SELECT RLS dla subskrybenta — działa dla admin/staff (authenticated), anon nie subskrybuje (celowo: polling).
