# PreConnect: zabezpieczenie zapisu mailingu i rozdzielenie kredytów

Data: 28.09.2026. Baza wyjściowa: `96897f6`. Zlecenie Artura: kontynuować po wdrożeniu kredytów. Bez wysyłania prawdziwych wiadomości i bez nowych przyznań.

## Zmiana

`send-retailer-batch` nie nadpisuje już całego JSON wysyłki z migawki sprzed odpowiedzi Resend. Nowe RPC `mark_legacy_sends_retailer_emailed` blokuje aktualne wiersze w stałej kolejności, sprawdza przynależność do sieci i komplet identyfikatorów, scala wyłącznie metadane transportu. Cała partia jest atomowa. Zachowuje odczyt, rozliczenie, znacznik powiadomienia i zaawansowany status (również wygaśnięcie/odmowę podczas wysyłki). Powtórka zachowuje pierwszy czas, scala identyfikatory wiadomości. Usuwa historyczne adresy kupców z JSON dostępnego dostawcy. Zapisuje `mailingSentAt` (obecna flaga frontu jest true) i czyści koszyk.

Istotne dodatkowe znalezisko: callback `handleEmailSent` w panelu także wykonywał `setSends`, które automatycznie robi bulk upsert starego JSON. Ten zapis również został usunięty. Callback odczytuje dane z bazy do `_setSendsRaw`; nie zapisuje do niej. Błąd odświeżenia po potwierdzeniu wysyłki nie zamienia jej w ponowienie.

Brak potwierdzenia RPC po przyjęciu maila: HTTP 502, `delivery_uncertain`, zero pozornego sukcesu, brak powiadomienia dostawcy, ostrzeżenie przed ponowieniem i zablokowany przycisk w bieżącym oknie. To nie jest trwały rejestr idempotencji maili. Równoległe wysyłki / niepewny wynik samego Resend nadal wymagają osobnego projektu (patrz ograniczenia).

Funkcja przeszła na aktualne API Netlify (default export, Request/Response). Zachowuje URL, format żądania, tryb podglądu oraz osobne wiadomości dla kupców. Nieaktywne konto admina jest odrzucane przed wysyłką.

## Liczniki i teksty PL/EN

- `creditUsage.used` pochodzi z `company_capacity.qty_used`, a nie z liczby zajętych miejsc.
- Rezerwacje obejmują nieodczytane propozycje w moderacji, zatwierdzone i wysłane. Rozliczenie następuje przy odczycie; odczyt bez udanego pobrania nie jest traktowany jako pobrany kredyt.
- Dashboard, pasek wysyłek, Finanse i Pakiety pokazują oddzielnie wykorzystane i zarezerwowane. Ostrzeżenie o kończącym się pakiecie i brak kredytów również rozróżniają te pojęcia.
- `unread_expired` bez znacznika pobrania to „Rezerwacja zwolniona — bez pobrania kredytu”. Nie trafia do zwrotów w toku. Dawne, rzeczywiście obciążone zwroty nadal są osobną kategorią. Analogiczna etykieta w zbiorczym widoku admina.
- `pkgUsed` nadal oznacza zajęte miejsca w istniejącej kontroli możliwości nowej wysyłki; nie zmieniałem zasad przyjmowania nowych propozycji ani sald.

## Zabezpieczenia ACL wykryte podczas audytu

Produkcja miała bezpośrednie granty EXECUTE dla anon/authenticated, mimo wcześniejszego REVOKE FROM PUBLIC. Cztery RPC bez wewnętrznej kontroli sesji mogły być wywoływane bez uprawnień: `purchase_package`, `allocate_proforma_number`, `claim_due_expiry_reminders`, `claim_due_inactivity_warnings`. Wszystkie są wywoływane przez serwer (`payu-notify`, `generate-proforma`, funkcje przypomnień). Odebrano anon/authenticated/PUBLIC; service_role zachowany. `mark_proforma_paid` wywołuje zakup w kontekście właściciela SECURITY DEFINER, więc ścieżka admina nadal ma dostęp. Dodatkowo stały search_path dla purchase_package. Bez zmiany globalnych uprawnień projektu.

## Dowody

- Vitest: 577/577 w 75 plikach. Pominięto istniejący, nieskomitowany `tests/review-historical-grants-v5.test.js`, celowo oczekujący starego błędu. Nowe testy dotyczą żądania do RPC, niepotwierdzonego zapisu, nieaktywnego admina, dry run, kwalifikacji propozycji, liczb PL/EN i zwolnienia nieobciążonej rezerwacji.
- `scripts/preconnect-followups-sql-test.mjs`: wszystkie migracje od zera i nowe dwukrotnie; rzeczywiste odmowy anon/authenticated; wykonanie service_role; dwie kolejności równoczesnego odczytu i mailingu; zachowanie rozliczenia i powiadomienia; powtórka; wycofanie całej partii przy niezgodnej sieci/brakującym wierszu; zachowanie wygaśnięcia.
- Dotychczasowy pełny runner `free-credit-grants-sql-test.mjs`: PASS, włącznie z równoległością i historycznym manifestem 75/123/38.
- Build Vite i pakowanie Netlify Functions: OK. Nowy endpoint sprawdzany bez tokenu po wdrożeniu; nie wysyłano realnych wiadomości.
- Migracje wykonane przed kodem przez Supabase connector. Odciski packages i legacy_sends przed/po identyczne; 681 kredytów, 73 zużyte. Kopia definicji i odciski poza Gitem: `C:/Users/Artur/FreshMarket-Backups/FM-PRECONNECT-FOLLOWUPS-20260928/`.

## Ograniczenia do osobnego review

1. Stary mechanizm mailingu do sieci nie ma trwałego manifestu i kluczy idempotencji jak wysyłka kart FM. Podwójne wywołanie przed zapisem znacznika może zdublować mail. Zamknięcie okna z wynikiem niepewnym i otwarcie nowego nie jest trwałą blokadą. Nie należy obiecywać „exactly once”.
2. Inne działania starego panelu, np. zmiana koszyka/moderacji, nadal potrafią robić pełny upsert JSON. Zabezpieczona została ścieżka odpowiedzi mailingu w funkcji i jej callback, nie wszystkie zapisy całego monolitu.
3. Nie wykonywano mailowego end-to-end na prawdziwym Resend. Próby używają atrap. Automatyzacja Chrome w tej sesji nie odpowiadała; kontrola UI opiera się na renderowanych komponentach PL/EN, bez nowego zrzutu produkcji.
4. Starsze problemy Security Advisor opisane w osobnym raporcie. Szczególnie moduł artykułów oraz stary cron mailowy wymagają pilnego, odrębnego przeglądu. Nie uruchamiano tych RPC dla dowodu, bo mogłyby zapisać dane lub wysłać maile.

## Wycofanie

Punkt powrotu kodu: `96897f6` (już zawiera atomowe rozliczanie grantów). Zachować obie nowe migracje i ograniczenia ACL. Nie cofać bazy ani backendu sprzed wdrożenia grantów. Powrót do 96897f6 przywróci stary zapis mailingu, dlatego w takim wypadku wstrzymać wysyłkę do sieci do ponownego wdrożenia poprawki.
