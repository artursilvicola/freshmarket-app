# Odpowiedź na review release/2026-09-09 — karta „Twoja kolej” (9.09.2026)

Gałąź `release/2026-09-09`, poprawka w osobnym commicie nad `724869b`. Reguły „automatycznej szansy” i pierwszeństwa akceptacji (`78bc617`) bez zmian. Bez migracji, RLS, RPC, snapshotu publicznego, `/tablice`. Nic nie wdrożone, plan nie przeliczany ani nie publikowany.

## 1. P2 — zakres daty

`FmMyQueue`: oba zestawy danych (`mine`, `snap`) mają zakres `{ date, rows, at, error }`. Efekt na zmianę `eventDate` podbija generację i resetuje oba zakresy; render bierze dane tylko, gdy `scope.date === eventDate` — poprzedni numer znika w tym samym renderze, w którym zmieniła się data (przed efektem i przed jakąkolwiek odpowiedzią). Odpowiedź z poprzedniej generacji jest odrzucana przed zastosowaniem i nie rozlicza liczników nowej. Przy nowej dacie bez danych karta się nie renderuje (nie ma „poprzedniego numeru” ani cudzego „podejdź”).

## 2. P2 — closing ≠ wolno wywołać następnego

`fmMyQueueStatus.js`: `groupsFromSnapshot(stations, settings)` rozdziela `anyOpen` (tylko `open`), `anyClosing`, `anyFree`, `anyPaused` i `dayClosed` (`settings.closed_all_at` ze snapshotu). `nowNumbers` nadal pokazuje trwający numer na stanowiskach open/closing. `meetingStatusKey` dla `planned`: `dayClosed` → `closing`; `anyOpen` → `next_up`/`ahead`; inaczej `anyClosing` → `closing`; potem free/paused/closed. Nowy komunikat PL/EN „kolejka zamykana — trwa ostatnie spotkanie, nowe numery nie będą wywoływane; zgłoś się do obsługi”. Testy: closing solo, closing+closed → closing, closing+open → nadal kolejka, `closed_all_at` przy open → closing, wywołany kończy normalnie.

## 3. P2 — spóźniony polling

Osobne sekwencje `mine`/`snap` nadawane przed wysłaniem; wynik z numerem ≤ już zastosowanego jest odrzucany. `withReadTimeout` 10 s na obu odczytach (wspólny `src/lib/fm-read.js`, z którego korzysta też lista obsługi — `meetingList.js` re-eksportuje). Jeden odczyt na źródło naraz (interwał w trakcie wiszącego odczytu nie stackuje zapytań). Ostrzeżenie „dane mogą być nieaktualne” wynika z błędu/timeoutu LUB wieku > 25 s **każdego z dwóch źródeł** osobno — poprawny snapshot nie maskuje wiszącego odczytu spotkań i odwrotnie. Przy błędzie ostatni znany stan tej samej daty zostaje, z ostrzeżeniem.

## Testy

- **Twoje 3 testy uruchomione bez zmian** (`.review/FmMyQueue.release-review.test.jsx` + Twoja konfiguracja): **3/3**. Katalog `.review` usunięty po uruchomieniu.
- Trwałe: `src/components/supplier/FmMyQueue.test.jsx` — 11 testów komponentu (Twoje 3 scenariusze + odczyt poprzedniej daty po zmianie, brak daty = brak karty i brak zapytań, wiszący odczyt spotkań → ostrzeżenie mimo dobrego snapshotu → gaśnie po udanym odczycie, błąd snapshotu nie maskowany przez spotkania, brak równoległych odczytów, spóźniony snapshot nie nadpisuje nowszego, `closed_all_at`, PL/EN). `fmMyQueueStatus.test.js` +3.
- `npm test`: **112/112** (11 plików). `npm run build`: OK. Paczka bez demo/test-renderer/skryptu hostowanego. `git diff --check` OK.

## Do końcowej oceny

Nowy commit na `release/2026-09-09` (patrz `git log -1`). Przed ewentualnym deployem: sprawdzić aktualny opublikowany deploy Netlify i zapisać rollback z bieżącego stanu (nie z wcześniejszego raportu). Bez przeliczania/publikacji planu i bez resetu kolejek. Próba na tabletach 21–22.09 osobno.
