# Review Codexa v8 — historyczne kredyty

Sprawdzony commit: `7e0c1d7` na `feat/free-credit-grants`.

**Aktualizacja po odpowiedzi Artura:** „Nie mam pewności — oznacz neutralnie”. Codex przygotował v9: 75 prezentów rejestracyjnych / 123 rekompensaty / 38 neutralnych (`legacy`, w tym dodatkowe 33 std_5). Wcześniejsza propozycja 108/123/5 opisana poniżej nie jest już listą do wdrożenia. Obie listy SQL i runbook zostały poprawione, pełny runner SQL przeszedł. Zapis produkcyjny nadal nie był wykonywany.

**Werdykt techniczny: pozytywny.** Nie stwierdzono nowego błędu blokującego wdrożenie. Manifest odpowiada pełnemu odczytowi produkcji z 27.09, godz. 18:46:27. Migracja i kod aplikacji nie zmieniły się od poprzedniego zaakceptowanego review; SHA-256 migracji nadal `29eb68f8007e4bd991d458e274b6989aee8d3a1587b8371c2c6275ec1a4960a5`.

## Niezależna weryfikacja

Ponownie uruchomiono `scripts/free-credit-grants-sql-test.mjs` na osobnym lokalnym PostgreSQL, wyłącznie `127.0.0.1:54329`.

- Migracje od pustej bazy, nowa migracja dwukrotnie: PASS.
- Wszystkie scenariusze równoległych rozliczeń, odczytu i powiadomień, idempotencji przyznań/historycznych zapisów oraz kontroli roli: PASS.
- Pełny plik A na schemacie sprzed migracji i 240 rzeczywistych pakietach z odczytu: 0 brakujących, 0 różnic, 123/123 rekompensat, 0 pakietów poza listą wymagających wyjaśnienia.
- Pełny plik B po migracji: 108 rejestracyjnych, 123 rekompensaty, 5 nieustalonych. Razem 236 oznaczonych; 4 zakupy pozostają zakupami.
- Suma wszystkich kredytów 681 i zużytych 73 bez zmian. Zapis historyczny nie pokazuje nowego banera.
- Powtórka B, dodatkowa rekompensata spoza manifestu i zmiana danych podczas oczekiwania na blokadę odrzucane. Normalny wzrost zużycia dozwolony.
- `git diff --check 46c8c54..7e0c1d7`: OK.

Log: `C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/review-grants-v8-sql.log`.

Nie powtarzano pełnego Vitest/build: ten commit zmienia tylko manifesty, dokumentację i runner SQL; aplikacja, migracja i zależności są niezmienione. Nie należy przedstawiać poprzednich liczb Vitest jako nowego uruchomienia na v8.

## Pochodzenie 33 pakietów: mechanizm a powód

`src/lib/db.js:802` (`adminSetCompanyPackage`) rzeczywiście może tworzyć pakiet z ceną 0, bez referencji płatności i z ważnością do końca roku. Wywołanie w `src/legacy/PreconnectFM.jsx` ustawia plan i limit z panelu admina. Jest to jednak ogólna funkcja ustawiania pakietu — nie zapisuje zdarzenia „prezent za rejestrację”, więc sam kod nie stanowi audytu powodu każdego istniejącego wiersza. Pasujące pola i znany sposób pracy uzasadniają proponowaną klasyfikację, lecz potwierdzenie biznesowe pochodzi od Artura.

Do Artura skierowano jedno konkretne pytanie: czy 33 dodatkowe istniejące pakiety po 5 kredytów też były prezentami rejestracyjnymi. Potwierdzenie dotyczy wyłącznie etykiety historii; nie ponownego przyznania, nie odjęcia rekompensat, nie zmiany ważności. Po potwierdzeniu manifest 108/123/5 można wykonać w uzgodnionej kolejności. Jeśli pochodzenie nie zostanie potwierdzone, oznaczyć niepotwierdzone pakiety neutralnie i dostosować listy przed zapisem.

Drobna uwaga do trwałej notatki audytowej w B (wiersz 299): opis partii nadal mówi „wg archiwum 23.09 (108 pakietów)”, chociaż pełne 108 pochodzi z odczytu produkcji 27.09. Przed wykonaniem warto użyć „wg odczytu produkcji 27.09.2026 (108 pakietów)”. To korekta opisu źródła, bez wpływu na salda czy działanie RPC.

## Dalej

Po uzgodnieniu etykiety: świeża kontrola A → pełna kopia → migracja → kontrola po migracji → deploy kodu → B pod blokadą → test. Kontrola na odczycie 18:46 nie zastępuje sprawdzenia aktualnego stanu przed późniejszym zapisem. Ważność historycznych pakietów pozostaje bez zmian; trzy miesiące dotyczy nowych przyznań.

W ramach tego review wykonano wyłącznie lokalne testy i odczyt kodu. Produkcja bez zmian, żadnych nowych kredytów, żadnych wiadomości, brak deployu. Lokalny PostgreSQL zatrzymano po testach.
