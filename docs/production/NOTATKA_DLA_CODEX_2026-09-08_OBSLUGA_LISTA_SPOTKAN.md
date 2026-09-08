# Notatka do review — `/obsluga`: weryfikacja dostawcy po nazwie firmy + „Lista spotkań” (8.09.2026)

Gałąź: `feat/staff-meeting-list` (od `main` b901bf4 = produkcja po wdrożeniu kolejek v4.4). Zlecenie Artura: operator (osoba zewnętrzna) musi sprawdzić, czy „numer 12 do Auchan” należy do firmy, która podchodzi, i czy spotkanie nie zostało już zakończone. **Tylko podgląd i weryfikacja** — bez zmian algorytmu, numeracji, RPC, migracji i przejść statusów.

## Co się zmieniło (5 plików + 2 nowe + testy)

| Plik | Zmiana |
|---|---|
| `src/staff/StaffPanel.jsx` | TERAZ: wiersz „Sieć · grupa · stanowisko N”, „Numer 12 — pełna nazwa firmy” (zawijana, bez `…`), zdanie statusu („Wywołany — oczekujemy na dostawcę · od wywołania 2:17”), wskazówka weryfikacyjna; NASTĘPNY: pełna nazwa (zawijana). Nowy widok `view = "list"` (przycisk „☰ Lista spotkań” w nagłówku i w pasku akcji; powrót „← Sterowanie stanowiskiem” zachowuje wybrane stanowisko). `MeetingListView`: szukanie (numer / nazwa), 5 filtrów z licznikami, tabela Numer · Firma · Status (tekstem, pill) · Stanowisko, wiersz → szczegóły (wywołano / rozpoczęto / zakończono / wróci po nr / notatka), oznaczenia WYJĄTEK i TO STANOWISKO, baner „dane mogą być nieaktualne” (błąd pobrania lub offline) + „Odśwież”. Warstwa danych wstrzykiwana przez prop `api` (domyślnie `staffApi` z `fm-queue.js`). |
| `src/staff/meetingList.js` (nowy) | Czyste helpery: `filterMeetings`, `countByFilter`, `matchesQuery` (numer: dokładny/prefiks; nazwa: bez wielkości liter i polskich znaków), `stationLabelFor`, `fmtClock`, `isException`, `meetingName`. Status wyłącznie z rekordu. |
| `src/staff/meetingList.test.js` (nowy) | 11 testów: niższy numer w trakcie ≠ zakończony (Auchan ×2), każdy status ma filtr, sortowanie, liczniki, szukanie, etykiety stanowisk, wyjątek, godziny. |
| `src/staff/staffI18n.js` | Nowe etykiety PL/EN (`btn_list`, `filters`, `col_*`, `now_status`, `verify_hint`, `stale`, `details_*`…). |
| `src/lib/fm-queue.js` | `listFmStations(groupId)` (SELECT `fm_stations` pod istniejącą polityką `fm_stations_auth_select`, tylko id/idx/label/active) i obiekt `staffApi`. |
| `src/staff/StaffDemo.jsx` (nowy) + `src/App.jsx` | Trasa `/obsluga-demo` **tylko w `import.meta.env.DEV`** (w buildzie produkcyjnym brak trasy i chunku — sprawdzone `grep` po `dist/`). Symulacja w pamięci: Auchan ×2 (wspólna kolejka: 11 w trakcie na st. 1, 12 wywołany na st. 2, 7 powracający, 3 nieobecny, 6 pominięty, 9 anulowany, 16 wyjątek), Dino · Owoce i Dino · Kwiaty jako osobne grupy. Parametry URL do zrzutów: `?station=&view=list&filter=&q=&open=&offline=1&lang=en`. |

## Dane i uprawnienia (bez zmian w bazie)

- Lista = `listFmQueueMeetings(group_id)` (`fm_queue_meetings` + `companies(name)`), które panel pobierał już wcześniej; RLS 053: admin wszystko, `fm_meetings_staff_select` = tylko grupy z `fm_queue_assignments` operatora, dostawca własne, kupiec nic (T10). Operator NIE widzi cudzych sieci — lista jest per grupa wybranego stanowiska.
- Dino · Owoce / Dino · Kwiaty = osobne `fm_queue_groups` → osobne listy. Auchan ×2 = jedna grupa → wspólna lista, kolumna „Stanowisko” z `fm_queue_meetings.station_id` → `fm_stations.idx/label`.
- Publiczny snapshot (`fm_queue_public_snapshot`, `/.netlify/functions/fm-queue-snapshot`) nietknięty — sprawdzone na produkcji 7.09 (klucze: gate, mode, next_nr, group_id, current_nr, event_date, station_id, group_label, station_idx, busy_private, group_active, retailer_name, station_label, current_status, last_called_nr, station_active; zero nazw firm).
- Odświeżanie listy: po każdej operacji operatora (`act` → `refreshMeetings`), przy zmianie `version`/`group_version` stanowiska, z Realtime (`fm_stations`/`fm_queue_groups` — zmiany z drugiego tabletu) i co 10 s, gdy lista jest otwarta. Błąd pobrania → ostatnia lista zostaje + baner z godziną ostatniego udanego odświeżenia; `navigator.onLine=false` → dodatkowo istniejący czerwony pasek.

## Czego celowo NIE ma

- Brak automatycznego „+ Wyjątek” i brak „rozpocznij ponownie zakończone” z listy — lista nie ma żadnych akcji zmieniających stan (jedyne przyciski: filtr, szukaj, szczegóły, odśwież, powrót). Rozbieżność = administrator.
- Brak zmian w RPC, migracjach, `fm-algo`, numeracji, tablicy publicznej.

## Sprawdzone

- `npm test` 36/36 (18 fm-algo + 7 staff-auth + 11 meetingList), `npm run build` OK, demo nie w bundlu.
- Podgląd 1024×768 (`/obsluga-demo`, dane testowe): `docs/production/img/obsluga-lista/` — 01 TERAZ z firmą (PL), 02 pełna lista, 03 szukanie „12”, 04 „Zakończone” + szczegóły godzin nr 10, 05 Dino · Kwiaty (osobna lista), 06 brak połączenia, 07 TERAZ (EN), 08 szukanie po nazwie („jablka” → „Jabłka”).

## Prośba do review

1. Filtry: `returned_in_progress` w dwóch filtrach (aktywne + nieobecni/powracający), `skipped`/`cancelled` w „Zakończone” — OK, czy rozdzielić?
2. Etykieta „TO STANOWISKO” przy bieżącym spotkaniu wybranego stanowiska (na wspólnej liście Auchan) — wystarczająca?
3. Polling listy co 10 s tylko w widoku listy (poza tym `version` + Realtime) — czy zostawić, czy skrócić na dzień eventu?
4. Po akceptacji: merge do `main` → deploy Netlify (bez migracji), potem aktualizacja instrukcji PDF prawdziwymi ekranami.
