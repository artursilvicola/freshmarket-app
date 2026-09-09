# Do review — dwie uwagi eksploatacyjne karty „Twoja kolej” (9.09.2026, po wdrożeniu 7819e62)

Gałąź `fix/fm-my-queue-transport` od `main` fc34f80 (= produkcja 7819e62 + docs). Wyłącznie frontend karty dostawcy i sygnatura `listMyFmQueueMeetings`. Bez zmian reguł, migracji, RLS, snapshotu, `/tablice`. Nie wdrożone.

## 1. Limit czasu przerywa transport

- Każdy odczyt (`mine`, `snap`) ma własny `AbortController`; timer 10 s wywołuje `abort()` (oprócz dotychczasowego `withReadTimeout`, które rozstrzyga obietnicę). Sygnał trafia do `fetch(..., { signal })` snapshotu i do `listMyFmQueueMeetings(eventDate, { signal })` → `.abortSignal(signal)` na zapytaniu Supabase (bez sygnału z zewnątrz funkcja nadal używa `AbortSignal.timeout` jak pozostałe odczyty w `fm-queue.js`).
- Cleanup efektu (zmiana daty, demontaż) anuluje wszystkie żądania w locie. Kontrola generacji, sekwencji i „jeden odczyt na źródło” pozostaje — anulowanie ich nie zastępuje.
- Testy: fetch dostaje sygnał i po 10 s jest `aborted`; przez dwa kolejne cykle pollingu najwyżej jedno żywe żądanie snapshotu (ostrzeżenie o nieaktualności aktywne); odczyt spotkań dostaje sygnał, zmiana daty anuluje stare i wysyła nowe z nową datą; demontaż anuluje.

## 2. Pierwszy błąd odczytu ma komunikat

- Gdy dla bieżącej daty nie ma jeszcze żadnych spotkań (`rows === null`) i odczyt się nie powiódł, karta pokazuje krótki komunikat PL/EN („Nie udało się pobrać Twoich numerów… sprawdź tablicę”) z linkiem `/tablice?date=<data>`. Numery innej daty nigdy nie są pokazywane.
- Udana pusta lista (przed importem planu) nadal chowa kartę; po udanym ponowieniu komunikat znika, a karta pokazuje numery.
- Testy: błąd → komunikat + link z datą + brak karty numerów; ponowienie po 20 s → karta; pusta lista → nic; PL/EN.

## Wyniki

`npm test`: **118/118** (17 testów karty w `FmMyQueue.test.jsx`, 12 statusu). `npm run build`: OK; paczka bez demo/test-renderer/skryptu hostowanego. `git diff --check` OK.

## Do decyzji

Wdrożenie tej poprawki przed próbą 21–22.09 (osobny deploy, bez migracji), po Twoim review i zgodzie Artura.
