# Lista spotkań obsługi — uzupełnienie Codexa do odpowiedzi v3

Data: 8.09.2026. Baza zmian: `5074ce2`, gałąź źródłowa `feat/staff-meeting-list`.
Gałąź z uzupełnieniem: `codex/staff-state-ordering`.

**Aktualizacja 8.09, po 12:11 czasu polskiego:** blokada dostępu do testowego klucza została usunięta dzięki zalogowanej sesji Chrome. Wykonałem test rzeczywistych kont: trzy kolejne pełne przebiegi OK. Szczegóły, wcześniejsze nieudane przebiegi i granice wniosku są w [raporcie hostowanym](NOTATKA_DLA_CLAUDE_CODEX_2026-09-08_OBSLUGA_LISTA_HOSTED.md). Poniższa treść dokumentuje wcześniejszy stan przekazania; wpis „test niewykonany” nie jest już aktualny. Nadal bez merge do main i bez deployu.

## Wynik w prostych słowach

Lista firm i dotychczasowe zabezpieczenia pozostają. Domknąłem jeszcze jeden przypadek: spóźniona odpowiedź serwera mogła ukryć możliwość obsłużenia powracającego dostawcy, mimo że druga osoba z obsługi właśnie zakończyła spotkanie i dostawca był już gotowy do wejścia. Samo porównanie numerów wersji nie wykrywało takiej odpowiedzi.

Kod poprawki jest gotowy i sprawdzony lokalnie. Nie deklaruję zakończenia testu na prawdziwych kontach. Nie wykonano merge do `main`, deployu ani zmian w bazie produkcyjnej. Niniejsza notatka nie stanowi polecenia wdrożenia na produkcję.

## Dlaczego v3 potrzebowało uzupełnienia

Wersje stanowiska i grupy są monotoniczne, lecz nie opisują wszystkich pól zwracanych przez `fm_queue_station_state_unsafe`:

- `waiting_returnees.ready` zależy również od statusu spotkania na innym stanowisku wspólnej grupy;
- zakończenie tego spotkania bez wywołania następnego zwiększa wersję tamtego stanowiska, nie wersję oglądanego stanowiska ani grupy;
- `skip` i `mark_returned` mogą zmieniać rekord spotkania bez podbicia wersji stanowiska/grupy.

Dwie odpowiedzi z identycznymi `version` i `group_version` mogą zatem mieć różną zawartość. Dziewiąty test review odtwarzał: odczyt A (`ready=false`) → odczyt B (`ready=true`) → odpowiedź B → opóźniona odpowiedź A. V3 przyjmowało A po B i usuwało przycisk „Obsłuż powracającego”.

## Wprowadzone zmiany

W `src/staff/StaffPanel.jsx` pozostawiłem wspólną bramkę `applyState` i dodałem kolejność żądań:

1. Każdy odczyt `stationState`, odczyt `myStations` i logiczna operacja `act` dostaje kolejny numer **przed wysłaniem**.
2. Najpierw sprawdzana jest generacja wyboru i ID stanowiska. Następnie wersje bazy; przy równych wersjach decyduje kolejność żądań. Starsze żądanie nie nadpisuje już przyjętego nowszego.
3. Rzeczywiście wyższa wersja bazy ma pierwszeństwo nad kolejnością wysłania. Nie zamrażamy stanu tylko dlatego, że wersje są równe.
4. Odpowiedź `myStations` zachowuje generację, numer żądania i czas rozpoczęcia pobierania. Render nie nadaje staremu cache nowej tożsamości. Po zmianie wyboru stary cache nie zastępuje świeżego odczytu stanu; działa ekran „Ładowanie…”.
5. Ponowienie operacji zachowuje pierwotne stanowisko, oczekiwaną wersję, klucz idempotencji i numer logicznego żądania. Operacja zwracająca tylko spotkanie uruchamia nowy odczyt stanu po swoim zakończeniu.
6. Starszy błąd odczytu nie wyświetla komunikatu ponad stanem przyjętym z nowszego żądania.

Nie zmieniałem migracji, RPC, RLS, modelu logowania, uprawnień, publicznego snapshotu, `/tablice`, słownika PL/EN ani zależności npm.

## Potwierdzone testy

| Sprawdzenie | Wynik |
| --- | --- |
| `npm test` | 54/54 |
| Oryginalne testy review v1 + v2 + v3, bez zmiany treści | 9/9 |
| `npm run build` | OK; pozostaje standardowe ostrzeżenie o dużych chunkach |
| `git diff --check` | OK |
| Składnia skryptu testu hostowanego | OK; nie oznacza zaliczenia integracji |

Pięć trwałych testów w `src/staff/StaffPanel.ordering.test.jsx` obejmuje:

- opóźnioną odpowiedź o równych wersjach po nowszym `ready`;
- spóźniony zasiew `myStations` po nowszym odczycie bezpośrednim;
- `myStations` rozpoczęte w poprzedniej generacji wyboru;
- odczyt po `markReturned` wobec opóźnionego odczytu sprzed operacji;
- pierwszeństwo faktycznie wyższej wersji bazy nad kolejnością wysłania.

Materiały `.review/` są lokalne i nie należą do commitu. Ich scenariusze mają trwałe odpowiedniki w testach projektu.

## Test rzeczywistych kont: dokładny status

Sprawdziłem odczytem konfigurację istniejącego projektu **Freshmarket B2B Queue Tests**, ref `uowpixwtewrmmvkyooec`. Projekt jest dostępny, ma tabele modułu i publikację Realtime obejmującą `fm_stations` oraz `fm_queue_groups`.

Sprawdziłem też istniejący podgląd Netlify `6a9e92afd955ba9762082ec1--freshmarketb2b.netlify.app`: kontekst `deploy-preview`, gotowy deploy. URL Supabase w konfiguracji tego kontekstu wskazuje powyższy projekt testowy. **Ten podgląd nie został przeze mnie zaktualizowany do obecnej poprawki UI.**

Próbę przygotowania testu zatrzymała kontrola wejścia: `SUPABASE_SERVICE_ROLE_KEY` z Netlify jest zamaskowany, a nie rzeczywistym kluczem. Sekrety Netlify oznaczone jako secret są poza kontekstem dev nieodczytywalne przez UI/CLI/API ([dokumentacja Netlify](https://docs.netlify.com/build/environment-variables/secrets-controller/)). Nie osłabiałem tej ochrony i nie kopiowałem produkcyjnego klucza. Panel Supabase w przeglądarce wymaga ponownego logowania.

**Nie utworzono żadnych kont ani fikcyjnych spotkań.** Odczyt kontrolny po próbie: `fm_staff=0`, `fm_queue_groups=0`, `fm_queue_settings=0`, `fm_queue_meetings=0`. Nie powstała nowa płatna gałąź. Nie zmieniono sekretów Netlify.

### Gotowy skrypt do uruchomienia po udostępnieniu testowego klucza

`scripts/fm-staff-list-hosted-test.mjs` jest wąskim testem integracyjnym tej listy, nie powtórzeniem całego zalewu 20×. Wymaga:

- `TEST_SUPABASE_URL=https://uowpixwtewrmmvkyooec.supabase.co`;
- `TEST_SERVICE_ROLE_KEY` i `TEST_ANON_KEY`: prawdziwe, niezamaskowane legacy JWT klucze **tego projektu testowego**;
- `STAFF_LOGIN_URL`: `/.netlify/functions/staff-login` istniejącego testowego deploy preview;
- Node z zależnościami tego repozytorium.

Sekrety należy podać przez środowisko procesu lub bezpieczne stdin, nie przez argumenty polecenia, plik w repo ani czat. Opcjonalne `--stdin` przyjmuje jeden obiekt JSON z powyższymi nazwami, wyłącza echo w PTY i nie drukuje wartości. Zwykła komenda, po ustawieniu środowiska:

```sh
node scripts/fm-staff-list-hosted-test.mjs
```

Skrypt odmawia działania poza dokładnie wskazanym projektem testowym oraz adresem podglądu Netlify. Nie nakłada migracji ani nie wykonuje deployu. Tworzy tymczasowego super admina testowego, następnie dwa konta obsługi przez prawdziwy endpoint `admin-staff`, z datą dzisiejszą w Warszawie. Tworzy fikcyjne firmy i dwie grupy, z których tylko jedna jest przypisana operatorom.

Sprawdza logowanie kod/PIN przez Netlify → Auth → RPC, nazwy firm i statusy pod tokenami obsługi, odmowę odczytu nieprzypisanej listy (również po pominięciu filtra), odmowę prywatnego RPC nieprzypisanego stanowiska, listę przypisanych stanowisk, brak nazw dostawców w publicznym snapshotcie oraz dwie niezależne sesje Realtime. Po wywołaniu i rozpoczęciu spotkania sprawdza nazwę firmy, status, stanowisko i godziny w listach obu operatorów.

W `finally` usuwa tylko rekordy o ID zapisanych podczas własnego przebiegu, unieważnia sesje i usuwa tymczasowe konta. Dzienników audytowych append-only nie kasuje. Wynik bez sekretów trafia do `out/staff-list-hosted-result.json` (katalog ignorowany przez Git). **Skrypt sprawdzony składniowo; cały przebieg zdalny nadal wymaga wykonania.**

Zakres kontroli RLS to przydział **list spotkań**. Dotychczasowy katalog `companies` ma odrębną, szerszą politykę SELECT dla zalogowanych; nie należy utożsamiać braku dostępu do cudzej kolejki z niewidocznością wszystkich nazw firm w całej aplikacji. Nie zmieniałem tej istniejącej polityki w poprawce frontendu.

## Przekazanie do Claude/Codexa

1. Przejrzyj i włącz `codex/staff-state-ordering` do roboczej `feat/staff-meeting-list` (jeżeli ma nowe commity, zwykły merge po kontroli diffu; bez nadpisywania cudzych zmian). Nie kopiuj `.review/` ani sekretów.
2. Uruchom ponownie `npm test` i `npm run build` po integracji.
3. Wykonaj test hostowany z rzeczywistym testowym kluczem. Dołącz pełny wynik JSON bez sekretów. Nie opisuj mocków jako dowodu RLS/Realtime.
4. Dopiero z wynikiem integracji wróć po zgodę na merge do `main` i deploy poprawki listy (bez migracji). W tej turze takiego wdrożenia nie wykonano.
5. Zachowaj próbę na fizycznych tabletach: porównanie karty i pełnej nazwy firmy, Auchan ×2, Dino Owoce/Kwiaty, zmiany statusów, utrata internetu i powrót połączenia, PL/EN. Automatyczny test API nie zastępuje ergonomii ani próby na Wi-Fi obiektu.

Użyte instrukcje: Supabase (izolacja środowiska i rozróżnienie mocków od RLS/Realtime) oraz Netlify CLI and Deployment (kontekst Deploy Preview i bezpieczne traktowanie sekretów).
