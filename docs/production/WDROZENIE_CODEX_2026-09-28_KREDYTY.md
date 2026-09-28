# Wdrożenie kredytów PreConnect — 28.09.2026

Status: WDROŻONE. Migracja, kod, zapis historii oraz końcowy smoke test SQL i UI PL/EN ukończone. Poprawka licznika wygasłych propozycji również na produkcji. Zgoda Artura: „robimy?” oraz „spróbuj jeszcze raz”. Bez zgody na maile; żadnych nie wysłano.

## Kontrola i kopia

Świeży odczyt 08:11 CEST: 240 pakietów; manifest 75 rejestracyjnych / 123 rekompensaty / 38 neutralnych. A1–A4 bez braków i różnic. Salda 681 przyznanych, 73 zużyte, 608 pozostałych. Kopia wszystkich pakietów, wallet_tx, katalogu, pełnych 223 legacy_sends, ustawień pakietów firm i definicji widoku: `C:/Users/Artur/FreshMarket-Backups/FM-KREDYTY-20260928/przed/`. Odciski wszystkich pięciu tabel po migracji identyczne.

## Migracja i uzupełnienie ACL

SQL Editor produkcji sklyfuvzjikkqerxtulo, migracja 20260927120000_free_credit_grants.sql wykonana 08:13 CEST; oryginalny SHA256 29eb68f8007e4bd991d458e274b6989aee8d3a1587b8371c2c6275ec1a4960a5. Kontrola ujawniła domyślne bezpośrednie EXECUTE dla anon na dwóch nowych funkcjach; REVOKE FROM PUBLIC ich nie usuwał. Guardy auth.uid/is_admin już odrzucały niezalogowanych. Uzupełnienie 20260928061542_free_credit_grants_acl.sql odbiera anon EXECUTE admin_grant_free_credits i mark_credit_grant_seen oraz ustala search_path=pg_catalog dla business_today. Wszystkie trzy instrukcje wykonane i potwierdzone na produkcji przed kodem.

Runner odtwarza produkcyjne ALTER DEFAULT PRIVILEGES przed pierwszą migracją, potwierdza problem przed poprawką i poprawne ACL po niej. Migracje od zera, powtórzenia, test SQL, współbieżność i A/B na fixture 240 pakietów: PASS. Nie zmieniono pierwotnej migracji ani aplikacji względem zatwierdzonego 8ad9c3c.

role_table_grants przez rolę odczytu konektora nie pokazuje grantów innych ról; sprawdzono je przez has_table_privilege: anon bez praw, authenticated wyłącznie SELECT z RLS is_admin. Trzy funkcje rozliczeń tylko service_role, RPC admina/oznaczenia przeczytania dostępne authenticated i zabezpieczone w środku. company_capacity security_invoker=true, 7 nowych kolumn, dzień warszawski.

Supabase Security Advisor zgłasza także wcześniejsze problemy spoza tej zmiany (m.in. articles_with_facts jako security definer, domyślne uprawnienia innych RPC). Nie zmieniano ich przy tym wdrożeniu. Nowe business_today naprawione; pozostałe nowe definer RPC mają ustawiony search_path i zamierzone uprawnienia.

## Dalsze kroki

Fast-forward main, potwierdzenie opublikowanej wersji; dopiero potem zapis B z blokadą i 75/123/38. Test bez e-maili na firmie testowej. Rekompenstat nowych: zero. Po oznaczeniu historii nie cofać backendu do 37e90c7 (brak grant-first i atomowości).

## Wdrożenie i historia

Kod 9855ba5d5c61c2cc534319b407e150ae16c00b08 opublikowany przez Netlify, deploy 6aba06bc3a41160008f6e381 ready, 28.09 o 08:19 CEST. version.json i produkcyjny bundle potwierdzone.

Część B wykonana dopiero po publikacji kodu: 75 prezentów za rejestrację, 123 pakiety rekompensat, 38 neutralnych. Cztery zakupy pozostają zakupami. Skorygowano jedynie identyfikator wykonującego admina: w skrypcie był nieistniejący e-mail; rzeczywisty aktywny profil Artura to b12f618e-2f8e-40b8-a243-df020ab40dcb, artur@kjow.pl. Zmieniono także fixture runnera i runbook; runner przeszedł ponownie.

236 pakietów odnotowanych, 3 historyczne partie, 236 wpisów audytu o kwocie zero. Brak nowego salda, banerów o dawnych przyznaniach i maili. Suma 681/73/608 niezmieniona; pozostałe kredyty: 438 bezpłatne, 13 kupione, 157 nieustalone. Odciski pięciu tabel po starych kolumnach niezmienione (wallet_tx porównany bez nowych zerowych wpisów historical_grant_record).

## Test produkcyjny bez poczty

Jedna transakcja z ROLLBACK, wyłącznie firma TEST 09e52206-bd29-4d8a-9ef8-0063abd75b51 i nieaktywna sieć TEST 990901. Przyznanie 1 kredytu: ważność 28.12.2026. Powtórka klucza idempotentna, zmieniona treść odrzucona. Pierwszy odczyt pobiera z grant; drugi (kanał email, bez wysyłania e-maila) nie pobiera ponownie, zachowuje oba czasy i status read. PASS. Po ROLLBACK zero testowych pakietów, partii i wysyłek. Trigger wysyłkowy uruchamia HTTP tylko przy INSERT pending_moderation; test używał INSERT sent, więc poczta nie była wywoływana. Plik testu i wyniki w katalogu kopii.

## Poprawka wykryta w smoke UI

Agrocenter: w pulach 7 bezpłatnych + 3 kupione; stary licznik pokazywał tylko 4 dostępne, bo nadal odejmował 4 unread_expired. Jedna propozycja była read, dwie pending_moderation. Nowy wspólny licznik zwalnia slot po unread_expired; nadal zachowuje rezerwacje moderacji/wysyłki. Wynik: 8 dostępnych, 2 zarezerwowane, 10 nierozliczonych w pulach. Opisy PL/EN obejmują też moderację, żeby rezerwacja nie wyglądała na brakujące kredyty. Nie zmieniono żadnych sald w bazie. Test regresyjny odtwarza dokładnie ten zestaw statusów.

Vitest: 566/566 w 74 plikach; pominięty wyłącznie lokalny, nieskomitowany tests/review-historical-grants-v5.test.js, który oczekuje dawnego błędnego zachowania. Build OK. SQL od zera + współbieżność + manifest A/B + bezpośrednie granty anon: PASS.

## Ograniczenia i rollback

Nie wykonywano mailowego testu end-to-end ani nowych realnych przyznań. Po zapisaniu historii nie cofać backendu do 37e90c7: stara wersja nie zna grant-first i atomowych RPC. Przed chwilowym wyłączeniem przyznań użyć procedury revoke z runbooka.

## Ostateczny wynik kontroli UI

Poprawka licznika: commit 3c9c0d2797f4a7871a385cb61a208c4ca8549005, deploy 6aba0a9d3abadf0007739a3f ready, opublikowany 28.09.2026 o 08:35:32 CEST; version.json = 3c9c0d2797f4.

Na produkcji potwierdzono PL/EN dla Agrocenter (7 free + 3 paid, 8 available + 2 reserved), historię 3 rekompensat i wcześniejszego prezentu 5 kredytów z oryginalnymi datami; ACONFEX ma osobną pulę historyczną neutralną (4 remaining), bez błędnej etykiety „Kupione”. Zrzuty: `C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/credits-deploy-ui-20260928/kredyty-produkcja-pl.png`, `kredyty-produkcja-en.png`, `kredyty-produkcja-neutralne.png`.

Panel admina → Firmy → rozwiń ▼ przy firmie → Przyznaj bezpłatne kredyty: formularz otwiera się, ma powód, wiadomość, notatkę tylko dla admina i datę domyślną 28.12.2026. Zamknięto Anuluj, bez realnego przyznania. Panel pozostawiony na liście firm w koncie Artura, język PL.

Końcowe odciski i brak śladów testu: `kontrola-po-historii-i-rollback-test.json` w katalogu kopii. Uzgodnione salda i dawna ważność bez zmian. Żadnych maili nie wysłano; 123 rekompensat nie przyznawano ponownie.

Do osobnego uporządkowania redakcyjnego: odziedziczone kafelki „użyte” obejmują też rezerwacje, a blok „zwroty w toku” opisuje brak znacznika historycznego zwrotu także przy propozycji, która nigdy nie obciążyła pakietu. Poprawiony licznik dostępności już ich nie odejmuje. Te wcześniejsze podpisy nie zmieniają salda ani atomowego rozliczania.
