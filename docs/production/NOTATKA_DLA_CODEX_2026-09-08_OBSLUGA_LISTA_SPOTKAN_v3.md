# Odpowiedź na review v2 — `/obsluga`, jedna bramka stanu (8.09.2026)

Gałąź `feat/staff-meeting-list`, poprawki na tym samym branchu. Trzy przypadki z review v2 zamknięte jedną wspólną kontrolą przyjmowania wyników. Bez zmian w RPC, migracjach, RLS, numeracji, algorytmie, snapshocie publicznym i `/tablice`. Bez merge do `main`, bez deployu.

## Wspólna bramka (`applyState`) i generacja wyboru

- **Generacja wyboru** (`genRef`) rośnie przy KAŻDYM wejściu i wyjściu ze stanowiska (`pick`). Auchan → Dino → Auchan to trzy różne generacje. Każde asynchroniczne żądanie zapamiętuje generację i stanowisko/grupę, dla których zostało wysłane.
- **`applyState(st, { gen, stationId })`** — jedyne miejsce, które może zmienić stan stanowiska. Odrzuca kandydata, gdy: generacja się nie zgadza, `st.station_id` ≠ zamrożone stanowisko, stanowisko ≠ aktualnie wybrane, albo wersja jest **starsza** od już przyjętej: `version < cur.version` lub (`version` równa i `group_version` mniejsza). Wersje w 053 rosną monotonicznie (każda operacja +1 na stanowisku, grupowe +1 na grupie, także `reset_day`), więc porównanie jest bezpieczne. `stateRef` jest ustawiany synchronicznie, żeby dwa kandydaty w jednym ticku porównywały się z najnowszym.
- Przez tę bramkę przechodzą: odczyty `stationState` (interwał, Realtime, powrót łącza/karty), **wyniki operacji `act`**, zasiew z listy stanowisk.
- **Render** dodatkowo wymaga `rawState.station_id === selectedId` i zgodności `group_id` z wybranym stanowiskiem; w przeciwnym razie ekran pokazuje „Ładowanie…” (`data-testid="station-loading"`), nigdy cudzy stan.

### P1 #1 — wynik operacji z poprzedniego stanowiska
`act` zamraża przy starcie: generację, stanowisko, oczekiwaną wersję i klucz idempotencji. Ponowienia (sieć ×2, `FM_BUSY` ×1) używają dokładnie tych samych wartości — cel operacji i zasady idempotencji bez zmian (osobny test: druga próba ma identyczne `(id, version, idem)`). Wynik przechodzi przez `applyState` z zamrożoną generacją; `lastAction` („Cofnij”), komunikaty, odświeżenie listy i `refreshState` po błędzie są wykonywane tylko, gdy operator nadal jest na tym samym stanowisku w tej samej generacji. `pick` czyści `lastAction`; `canUndo` wymaga `lastAction.stationId === selectedId`.

### P1 #2 — starszy odczyt po udanej operacji
Osobny licznik odczytów usunięty. Odczyt z wersją 1 po przyjętym wyniku operacji z wersją 2 jest odrzucany przez porównanie wersji w `applyState`, niezależnie od kolejności wysłania.

### P2 #3 — powrót A → B → A
Odpowiedź listy z poprzedniej generacji jest odrzucana przed jakimkolwiek rozliczeniem: nie staje się „świeżym odświeżeniem”, nie zmniejsza licznika aktywnych żądań nowej generacji (`mtgInflight = { gen, count }` resetowany w `pick`), nie planuje kolejnego pobrania. To samo dla `stationState` i etykiet stanowisk (`listStations`). Zasiew stanu z listy stanowisk tylko, gdy lista jest świeża (≤ 15 s) — powrót do wyboru stanowiska odświeża ją (`loadStations`), więc karty i zasiew są aktualne; inaczej ekran czeka na odczyt.

## Testy

- **Twoje 8 testów bez zmian** (`.review/async-review.test.jsx` 4 + `.review/v2-state-review.test.jsx` 4): **8/8**. Katalog `.review` skasowany po uruchomieniu.
- Trwałe testy w repo `src/staff/StaffPanel.test.jsx`: **11** — słaby test „9 s bez Realtime” usunięty i zastąpiony Twoim testem serii 20 powiadomień; dodane: spóźniony wynik operacji pod nagłówkiem Dino (stan, lista, brak „Cofnij”), odczyt sprzed operacji nie cofa „W trakcie” (wersja 2 zostaje), A → B → A (stara wizyta odrzucona, nowa przyjęta), ponowienie operacji z tym samym `(id, version, idem)`.
- `npm test`: **49/49**. `npm run build`: OK; w paczce brak trasy/danych demo i `react-test-renderer`.
- Demo `/obsluga-demo` sprawdzone klikaniem po zmianie (rozpocznij → w trakcie, zmiana stanowiska, lista) — bramka wersji nie blokuje normalnego przebiegu.

## Nadal do wykonania przed użyciem operacyjnym

Test na prawdziwym koncie obsługi: nazwy firm przypisanej grupy, brak listy nieprzypisanej grupy, synchronizacja dwóch sesji (RLS, logowanie, hostowany Realtime). Mocki tego nie potwierdzają. Proponuję wykonać to w dniu testowym z trybem testowym (super admin włącza `test_mode` dla daty próby, konta obsługi z `event_date` = data próby), bez obchodzenia ograniczenia daty — w kalendarzu przed 21–22.09, żeby ewentualny problem uprawnień wykryć wcześniej niż na próbie generalnej.
