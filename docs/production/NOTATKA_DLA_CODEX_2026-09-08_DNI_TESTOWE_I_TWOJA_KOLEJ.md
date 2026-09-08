# Do review — rozdzielenie dni testowych od wydarzenia + komunikat „Twoja kolej” (8.09.2026)

Gałąź `fix/fm-queue-day-scoping` od `main` 48dd1b4 (produkcja z listą spotkań). Zakres: wyłącznie frontend. Bez migracji, RPC, RLS, numeracji, snapshotu publicznego i `/tablice`. Nie wdrożone.

## 1. Panel obsługi pyta o stanowiska z dzisiejszego dnia

Przyczyna: `fm_queue_my_stations(p_event_date DEFAULT NULL)` bierze `COALESCE(p_event_date, max(event_date) FROM fm_queue_groups)` = 24.09, a panel wołał RPC bez daty → operator konta na 21.09 dostawał pustą listę.

Poprawka: `src/lib/fm-date.js` — `warsawToday()` liczy datę dokładnie jak `is_staff()` w bazie (`now() AT TIME ZONE 'Europe/Warsaw'`); `StaffPanel` woła `myStations(warsawToday())`. Konto obsługi działa tylko w swoim dniu, więc „dziś” jest zawsze właściwym dniem konta; admin w `/obsluga` również widzi dzień bieżący (dzień próby podczas próby, 24.09 w dniu wydarzenia). Ekran wyboru stanowiska pokazuje datę („stanowiska na 21.09.2026”), komunikat „brak stanowisk” mówi o dzisiejszym dniu. Bez zmiany RPC — celowo, żeby nie wprowadzać migracji przed próbą; opcjonalna późniejsza migracja mogłaby domyślnie brać datę z `fm_staff` zalogowanego operatora.

## 2. Karta „Twoja kolej” u dostawcy tylko z dnia produkcyjnego

Przyczyna: `listMyFmQueueMeetings()` nie filtrowało daty, snapshot bez `?date` = `max(event_date)`. Próba na kopii planu (21.09) pokazałaby uczestnikom próbne numery.

Poprawka: `FmMyQueue` dostaje `eventDate` = `fmSettings.event_date` (PreconnectFM), `listMyFmQueueMeetings(eventDate)` filtruje przez `fm_queue_groups!inner(event_date)` (polityka `fm_groups_auth_select` dla zalogowanych istnieje), snapshot z `?date=`, link do tablicy z `?date=`. Bez znanej daty karta się nie renderuje (lepiej brak karty niż próbny numer). Składnia filtra po embedzie sprawdzona na produkcji jako anon: 42501 „permission denied” (poprawnie sparsowane, brak grantów), nie 400.

## 3. „Podejdź” tylko po faktycznym wywołaniu; TERAZ przy Auchan ×2

Przyczyna: `ahead = nr − last_called − 1 === 0` dawało „TWOJA KOLEJ — podejdź” dla numeru 13, gdy 12 dopiero wywołano, a 13 był `planned`. `TERAZ` pokazywał tylko `last_called_nr` grupy.

Poprawka: czysty moduł `src/components/supplier/fmMyQueueStatus.js` — `meetingStatusKey(m, g)`: `called` → „podejdź”; `planned` z `ahead ≤ 0` → nowy komunikat **„JESTEŚ NASTĘPNY — przygotuj się, podejdź po wywołaniu”**; `ahead ≥ 1` → „przed Tobą ok. N”; statusy z rekordu (in_progress, done, no_show, returned, skipped, cancelled) mają pierwszeństwo. `nowNumbers(g)`: bieżące numery WSZYSTKICH otwartych/zamykanych stanowisk grupy (Auchan ×2 → „11 · 12”), a gdy żadne nie ma bieżącego — `last_called_nr`. `groupsFromSnapshot` traktuje `closing` jak otwarte (trwa ostatnie spotkanie).

## Testy

`npm test` **68/68** (nowe: `fm-date.test.js` 3, `fmMyQueueStatus.test.js` 9 — w tym „13 przy 12 → następny, nie podejdź” i „Auchan ×2 → 11 · 12”, `StaffPanel.test.jsx` +2 — `myStations` dostaje dzisiejszą datę, ekran pokazuje dzień). `npm run build` OK, paczka bez demo/testów.

Nie sprawdzone tu: klikanie karty dostawcy na produkcji (wymaga konta dostawcy i zaimportowanego planu) — do próby generalnej.

## Konsekwencje dla próby 21–22.09 (runbook §7 zaktualizowany)

- Rzutnik i telefony podczas próby: `/tablice?date=2026-09-21` (bez `?date` tablica pokazuje najnowszy skonfigurowany dzień = 24.09, same zamknięte stanowiska).
- Konta obsługi i konfiguracja stanowisk **na datę próby**; panel obsługi sam wybierze ten dzień.
- Dostawcy nie zobaczą próbnych spotkań, bo karta trzyma się `fm_settings.event_date` = 24.09.

## Do decyzji Artura (poza kodem)

`docs/production/FM_KOLEJKI_STANOWISKA_DO_ZATWIERDZENIA.md` — szablon wygenerowany z produkcji (23 grupy / 24 stanowiska) z kolumnami: docelowa liczba stanowisk, kolejka wspólna/osobna, GATE, operator; tabela operatorów OBSLUGA-1…8.
