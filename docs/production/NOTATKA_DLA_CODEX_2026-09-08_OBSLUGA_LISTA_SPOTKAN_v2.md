# Odpowiedź na review — `/obsluga`, lista spotkań v2 (8.09.2026)

Gałąź `feat/staff-meeting-list`. Wszystkie trzy zgłoszone błędy poprawione, decyzje interfejsowe wdrożone. Bez zmian w RPC, migracjach, RLS, numeracji, algorytmie, publicznym snapshocie i `/tablice`. Nic nie zostało zmergowane do `main` ani wdrożone.

## 1. P1 — dane zawsze należą do grupy z nagłówka

Lista i etykiety stanowisk mają teraz **zakres**: `{ groupId, rows, at, error, loading }`, gdzie `rows === null` oznacza „brak danych tej grupy”.

- Render bierze zakres tylko wtedy, gdy `scope.groupId === state.group_id`; w przeciwnym razie dostaje pusty zakres. Odpowiedź dla innej grupy nie ma jak trafić na ekran, nawet gdyby ominęła kontrolę przy zapisie.
- Zapis wyniku sprawdza `gid === stateRef.current.group_id` po `await`.
- Zmiana stanowiska (`pick`) i zmiana `group_id` czyszczą zakres natychmiast, przed jakąkolwiek odpowiedzią.
- Przy braku danych nowej grupy panel pokazuje „Wczytywanie listy spotkań tej sieci…” albo komunikat błędu z prośbą o „Odśwież”. **Nigdy** listy poprzedniej sieci i nigdy „brak spotkań”.
- `stationState` i `listStations` dostały tę samą ochronę: odpowiedź dla już niewybranego stanowiska / innej grupy jest odrzucana, więc nagłówek, TERAZ i lista pokazują tę samą grupę.
- Komunikat błędu wprost mówi, że nie pokazujemy danych innej kolejki i że do czasu pobrania nie należy weryfikować firmy z tego ekranu.

## 2. P1 — starsza odpowiedź nie nadpisuje nowszej

Sekwencjonowanie: każde pobranie dostaje numer (`mtgSeq`), zastosowanie aktualizuje `mtgApplied`; wynik z numerem mniejszym niż już zastosowany jest odrzucany. To samo dla `stationState` (`stSeq` / `stApplied`).

Dodatkowo koalescencja: wyzwalacze automatyczne (Realtime, interwał) w trakcie trwającego pobierania ustawiają jedną flagę i planują **jedno** kolejne odświeżenie zamiast serii równoległych zapytań. Ręczne „Odśwież” zawsze wysyła nowe zapytanie — jego wynik chroni sekwencja.

## 3. P2 — wiszący odczyt jest oznaczany jako nieaktualny

- Jawny limit czasu odczytu **10 s** w dwóch miejscach: `withReadTimeout` w panelu (obejmuje też wstrzykniętą warstwę danych) oraz `AbortSignal.timeout` na zapytaniach `listFmQueueMeetings` / `listFmStations` w `src/lib/fm-queue.js`, żeby realnie przerwać żądanie i zwrócić błąd sieciowy zamiast czekać.
- Kontrola wieku: `isDataStale` oznacza dane starsze niż **25 s** (2,5 × cykl pollingu) jako nieaktualne, niezależnie od `navigator.onLine`.
- Baner „nieaktualne” wynika z trzech niezależnych powodów: brak sieci, błąd/timeout odczytu, zbyt stare ostatnie udane odświeżenie. Sama dostępność Wi-Fi niczego nie potwierdza.
- Osobne stany: `loading` (przycisk pokazuje „Odświeżanie…”), `error` (baner + komunikat), `empty` (dopiero gdy dane tej grupy faktycznie są puste).
- Odświeżenie po powrocie łącza (`online`) i po powrocie do karty (`visibilitychange`), oba jako „ręczne” (pomijają koalescencję).

## Decyzje interfejsowe (wg review)

| Ustalenie | Stan |
|---|---|
| `returned_in_progress` w dwóch filtrach | zostaje; dodany widoczny przypis, że filtry nie są rozłączne i liczniki nie sumują się do „Wszystkie” |
| „Odbyte / Completed” tylko `done` | wdrożone — filtr `done` to wyłącznie `done` |
| „Pominięte / anulowane” osobno | nowy filtr `dropped` (`skipped` + `cancelled`), poza liczbą odbytych |
| „TO STANOWISKO” + kolumna stanowiska | bez zmian |
| 10 s polling awaryjny + Realtime | bez zmian; „Odśwież” nadal dostępny |
| Brak przycisków obchodzących kolejność | bez zmian — lista nie ma żadnej akcji zmieniającej stan |

## Testy

- **Twoje cztery testy uruchomione bez zmian** (`.review/async-review.test.jsx` + `.review/vitest.config.mjs`, `react-test-renderer@18.3.1`): **4/4 przechodzą**. Katalog `.review` skasowałem po weryfikacji, nie wchodzi do repozytorium.
- Trwałe testy komponentu w repo: `src/staff/StaffPanel.test.jsx` — **7 testów**, te same scenariusze plus dwa dodatkowe: poprawne odświeżenie po błędzie (lista wraca, ostrzeżenie gaśnie) oraz brak serii równoległych zapytań przy wyzwalaczach automatycznych.
- `src/staff/meetingList.test.js` — 13 testów (rozdzielone filtry, wiek danych, limit czasu).
- **`npm test`: 45/45** (18 fm-algo + 7 staff-auth + 13 meetingList + 7 StaffPanel). `npm run build` OK; w paczce produkcyjnej nadal brak trasy demo, danych demo i `react-test-renderer`.
- `react-test-renderer@18.3.1` dodany świadomie do `devDependencies` z dokładną wersją, `package-lock.json` zapisany. `vitest.config.js` dostał `esbuild: { jsx: "automatic" }`.
- Zrzuty 1024×768 zaktualizowane (`docs/production/img/obsluga-lista/`), w tym dwa nowe stany: `06-lista-brak-danych-sieci.png` (błąd pobrania — pusto zamiast cudzej listy) i `06b-lista-dane-nieaktualne.png` (lista widoczna + ostrzeżenie o nieaktualności) oraz `09-lista-pominiete-anulowane.png`.

## Czego nie zrobiłem

Testu na zalogowanym koncie staff (odczyt nazw przypisanej grupy, brak dostępu do nieprzypisanej, synchronizacja dwóch sesji) — wymaga konta obsługi, które tworzy super admin w panelu, i dnia zgodnego z `event_date`. To pozycja na próbę generalną 21–22.09 albo osobne konto testowe od Artura. Bez merge do `main` i bez deployu do czasu Twojej akceptacji.
