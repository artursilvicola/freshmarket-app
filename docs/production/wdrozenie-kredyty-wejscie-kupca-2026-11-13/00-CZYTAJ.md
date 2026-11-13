# Wdrożenie: kredyt przy wejściu kupca i ręcznym potwierdzeniu, podgląd admina nie jest odczytem

Gałąź `fix/buyer-entry-seen`, PR `artursilvicola/freshmarket-app#1` (szkic). Stan na 13.11.2026: **nic nie jest wdrożone na produkcji**, migracja jest wgrana tylko na bazę testową.

## 1. Co się zmienia (decyzje Artura 13.11.2026)

Kredyt PreConnect schodzi, gdy:

1. kupiec otworzył maila — bez zmian,
2. kupiec wszedł do aplikacji — dowolna strona panelu, nie dopiero lista propozycji,
3. administrator ręcznie potwierdził odczyt (telefon / e-mail / spotkanie) — dostawca dostaje powiadomienie, cofnięcie potwierdzenia zwraca kredyt.

Podgląd konta kupca przez administratora nie jest odczytem. Tekst regulaminu bez zmian.

## 2. Wyniki testów — wszystko poza produkcją

Środowisko: osobny projekt Supabase `rruszzdffclfhbtfeznb` (testowy) + lokalny podgląd `node scripts/dev-test.mjs`, który bierze wartości wyłącznie z `.env.test`, odrzuca projekt produkcyjny i wymaga fikcyjnego klucza poczty (`re_test_…`). Żaden mail nie wyszedł, produkcja nie była używana do sprawdzania nowego mechanizmu.

Stan po poprawkach z trzech rund review (`cffea69` → `b10ba3a`; `437fee3` → `8f81321`; `8f81321` → poprawka warunku odczytu po mailu):

| Co | Jak | Wynik |
|---|---|---|
| Testy jednostkowe | `npm test` | 1328 zaliczonych, 40 pominiętych (integracyjne) |
| Build | `npm run build` | OK |
| Migracja na prawdziwym Postgresie | `node scripts/manual-read-confirm-sql-test.mjs` (transakcja wycofywana) | 18/18 |
| Wyścig odczyt kupca / cofnięcie, dwa połączenia | `node scripts/manual-read-confirm-race-test.mjs` | 4/4 (obie kolejności × mail i aplikacja) |
| Próba end-to-end w przeglądarce, nowy kod | `node scripts/buyer-entry-seen-trial.mjs --mode=fix` | 40/40 |
| Kontrola, stary kod przed migracją | `--mode=control` | podgląd admina pobrał 3/3 kredyty; wejście kupca na pulpit: 0; ręczne potwierdzenie (stary zapis statusu): 0 |
| Kontrola, stary kod PO poprawionej migracji | `--mode=control` na bazie z wgraną migracją | identycznie jak przed migracją; funkcja odczytu odpowiada 200 i rozlicza jak dotąd |
| Cykl skryptów pakietu w jednej wycofanej transakcji | 06 → 01 → migracja → 03 → 06 → 01 | 01: 9/9 OK w stanie sprzed migracji; 03: 11/11 OK po migracji; 06 przywraca dokładnie starą funkcję |

Próba end-to-end (40 kontroli) obejmuje:

- **podgląd admina:** 0 zgłoszeń odczytu, statusy/kredyty/odczyty bez zmian; bezpośrednie wywołanie obu funkcji z tokenem admina → 200, pusty wynik (`admin_preview`), baza bez zmian;
- **ręczne potwierdzenie w prawdziwym interfejsie** (Pipeline → Dostawcy / tracking): formularz uprzedza o kredycie; potwierdzenie → `read_manual`, kredyty 0 → 1, znacznik `chargeChannel=manual`, komunikat; cofnięcie → `sent`, kredyty 1 → 0, znacznik rozliczenia usunięty, komunikat; ponowne potwierdzenie → 0 → 1; kupiec wołający funkcję admina → 403;
- **wejście kupca na pulpit** (zwykła nawigacja w przeglądarce): 1 zgłoszenie z obiema czekającymi propozycjami i z dwiema potwierdzonymi ręcznie; nowe propozycje `read` i rozliczone, dokładnie 2 kredyty; propozycje potwierdzone ręcznie **nie** dostają drugiego pobrania, ale ich odczyt przez kupca **jest** zapisany (`buyerAppSeenAt`, wiersz `buyer/app_list`); odświeżenie strony bez drugiego pobrania; pulpit dalej pokazuje „2 nowych propozycji”;
- **potwierdzenie ręczne → normalne wejście kupca → cofnięcie w panelu administratora** (wszystko w przeglądarce, bez ręcznych żądań; osobna propozycja z czystą sekwencją): kredyt zostaje, powód `buyer_read`, **jedno pobranie łącznie, zero zwrotów**, status `read`, rozliczenie zachowane i już nie „ręczne”, komunikat „Kredyt zostaje”, przyciski potwierdzania i cofania znikają.

### Review `cffea69` — NO-GO i poprawki

| Uwaga recenzenta | Przyczyna | Poprawka | Dowód |
|---|---|---|---|
| **P1:** cofnięcie ręcznego potwierdzenia zwraca kredyt i przywraca `sent`, choć kupiec po potwierdzeniu sam odczytał propozycję | po ręcznym potwierdzeniu odczyt kupca nie zostawiał w wierszu śladu, który cofnięcie mogłoby sprawdzić (status zostaje `read_manual`, pola odczytu uzupełniane tylko, gdy puste) | `mark_legacy_send_seen` zapisuje fakt odczytu przez kupca w tej samej transakcji i pod tą samą blokadą wiersza (`buyerSeenAt`, `buyerSeenChannel`, dla aplikacji też `buyerAppSeenAt`, `buyerAppSeenChannel`); `undo_legacy_send_manual_confirm` sprawdza go pod blokadą: po odczycie kupca kredyt zostaje, status = `read` (aplikacja) albo `opened` (sam mail), `chargeChannel` przestaje być `manual`, wynik niesie `kept_reason = buyer_read`; panel pokazuje osobny komunikat | SQL: mail przed cofnięciem, aplikacja przed cofnięciem, mail + aplikacja; wyścig dwóch połączeń w obu kolejnościach; próba end-to-end [5] |
| **P2:** błąd pojedynczej pozycji zwrócony z HTTP 200 blokował ponowienie do przeładowania strony | lista „już zgłoszonych” traktowała całe udane żądanie jako ostateczne | `createSeenSubmissionTracker`: rozstrzyganie per pozycja — załatwione tylko `ok === true`; nieudane, brakujące w odpowiedzi i odpowiedź bez listy wracają do puli; najwyżej 3 próby na pozycję w sesji; udane rozliczenia nie są powtarzane | reprodukcja recenzenta na prawdziwej funkcji panelu: stary kod 1 żądanie, nowy 2; testy: wynik mieszany, odpowiedź niepełna i zniekształcona, limit prób, błąd HTTP i sieci |

### Review `437fee3` — NO-GO i poprawka (2. runda)

| Uwaga recenzenta | Przyczyna | Poprawka | Dowód |
|---|---|---|---|
| **P1:** baza działa, ale prawdziwy panel kupca nie zgłasza odczytu propozycji `read_manual` — ani przy wejściu, ani na liście, ani w szczególe; po wizycie kupca cofnięcie nadal zwracało kredyt i zostawiało `sent`. Poprzednia próba tego nie wykrywała, bo odczyt kupca wysyłała ręcznym żądaniem z pominięciem panelu | trzy filtry w panelu przepuszczały tylko `sent` / `opened` | wspólny warunek `isBuyerSeenPending` w `src/lib/buyer-seen.js` używany przy wejściu, na liście i w śledzeniu zgłoszeń; szczegół (`markSendOpened`) zapisuje odczyt propozycji potwierdzonej ręcznie bez zmiany statusu i bez wywołania „sent → read” | próba w przeglądarce [4] i [5] (zwykłe wejście kupca, cofnięcie z panelu); testy uruchamiające prawdziwe funkcje panelu dla wejścia, listy i szczegółu |

**Zapis odczytu a rozliczenie to osobne sprawy.** Panel zgłasza odczyt wyłącznie tych propozycji `read_manual`, które są już **rozliczone** — ręcznym potwierdzeniem albo wcześniejszym otwarciem maila (3. runda, niżej) — i nie mają jeszcze zapisanego odczytu w aplikacji. Taka propozycja nie może dostać drugiego pobrania. **Nierozliczone** `read_manual` (potwierdzone, gdy dostawca nie miał kredytu, albo stare, sprzed tej zmiany) **nie są zgłaszane**, więc zapis odczytu nie rozszerza rozliczeń na historyczne pozycje. Na produkcji nierozliczonych pozycji było 13.11 zero (kontrola `01`, wiersz 31); liczbę rozliczonych, którym kod dopisze odczyt przy wejściu kupca (bez pobrania), pokazuje wiersz 32. Licznik „nowych propozycji” na pulpicie kupca nadal obejmuje tylko nieprzeczytane.

### Review `8f81321` — NO-GO i poprawka (3. runda)

Poprzedni P1 recenzent uznał za zamknięty (potwierdzenie → wejście / lista / szczegół → cofnięcie: 3/3). Została jedna uwaga:

| Uwaga recenzenta | Przyczyna | Poprawka | Dowód |
|---|---|---|---|
| **P2:** sekwencja *otwarcie maila → potwierdzenie ręczne → aplikacja → cofnięcie*: panel nie zgłasza odczytu w aplikacji (0 zgłoszeń na wejściu, liście i w szczególe), `buyerAppSeenAt` zostaje puste, cofnięcie przywraca `opened` zamiast `read`. Kredyt był poprawny (jeden, bez zwrotu) — ginął fakt odczytu i status | warunek w `src/lib/buyer-seen.js` wymagał `chargeChannel = manual`, a w tej sekwencji kredyt pobrało otwarcie maila, więc potwierdzenie ręczne nie ustawia tego znacznika | warunek: `read_manual` + **rozliczona** (dowolnym kanałem) + brak `buyerAppSeenAt`. Zmiana wyłącznie w tym jednym warunku; funkcje bazy i migracja bez zmian | testy prawdziwych funkcji panelu dla wejścia, listy i szczegółu w 3 wariantach danych (dokładnie jedno zgłoszenie, bez drugiego pobrania); SQL: 2 nowe przypadki (`app_list`, `app_detail`) — status `read`, jeden kredyt, zero zwrotów, `buyerAppSeenAt` zapisany; próba w przeglądarce [3], [4] i [6] |

**Czego poprawka nie zmienia.** Nierozliczone `read_manual` nadal nie są zgłaszane (testy: stare bez kredytu, potwierdzone bez wolnego kredytu, sam znacznik kanału bez rozliczenia, otwarty mail bez rozliczenia). Propozycja z zapisanym już odczytem w aplikacji nie jest zgłaszana ponownie. Podgląd konta kupca przez administratora nadal niczego nie zgłasza.

**Jak odtworzono otwarcie maila w próbie.** Otwarcie maila to zdarzenie serwera (webhook poczty), a nie czynność w przeglądarce. Próba wywołuje to samo, co webhook: `mark_legacy_send_seen(…, 'email')` na bazie testowej. Wszystko, co robi człowiek — ręczne potwierdzenie, wejście kupca, cofnięcie — idzie przez przeglądarkę, bez ręcznych żądań.

**Poprawka samej próby.** Próba nie czekała dotąd na zakończenie zgłoszenia odczytu przy wejściu kupca (warunek oczekiwania był zawsze spełniony) i wynik zależał od czasu odpowiedzi; przy pięciu propozycjach raz dała 39/40 z powodu migawki zrobionej przed odpowiedzią serwera. Teraz czeka na odpowiedź i zapisuje jej czas (ok. 4 s dla 5 propozycji z laptopa do bazy testowej).

W wyścigu dwóch połączeń: gdy odczyt kupca pierwszy weźmie blokadę, cofnięcie czeka i kończy się bez zwrotu (`opened` / `read`); gdy pierwsze jest cofnięcie, zwraca kredyt, a czekający odczyt rozlicza od nowa — netto jeden kredyt, jeden zwrot i dwa pobrania w historii.

**Migracja a stary kod** (który działa na produkcji do scalenia PR): migracja **nie jest już czysto addytywna**. Zastępuje `mark_legacy_send_seen` wersją o tych samych argumentach i tym samym wyniku — cała dotychczasowa treść jest zachowana linia po linii, dopisanych jest 15 linii zapisujących cztery nowe pola w danych wysyłki. Dodaje dwie nowe funkcje, których stary kod nie woła. Żadnych zmian tabel, typów ani polityk. Kontrola na starym kodzie dała ten sam wynik przed migracją i po niej. Skrypt `01` sprawdza sumę kontrolną funkcji, którą migracja zastąpi (musi to być wersja z migracji 20260927120000), a `03` — sumę nowej.

**Czego testy NIE pokryły:** faktycznego doręczenia maila do dostawcy. Na środowisku testowym wysyłka kończy się odmową poczty (klucz fikcyjny), więc sprawdzone jest tylko to, że powiadomienie jest uruchamiane raz i że rozliczenie nie zależy od jego powodzenia. Treść maila pokrywają testy jednostkowe.

## 3. Podgląd Netlify (Deploy Preview) — stan faktyczny i zabezpieczenia

Otwarcie PR uruchomiło automatyczny podgląd `deploy-preview-1--freshmarketb2b.netlify.app`. Ustalenia z 13.11 pochodzą z odczytu konfiguracji przez API Netlify, bez wypisywania wartości zmiennych.

### Co wiadomo na pewno

- **Baza podglądu:** kontekst `deploy-preview` wskazuje projekt Supabase `uowpixwtewrmmvkyooec` („Freshmarket B2B Queue Tests”, osobny projekt testowy z września) — nie produkcję. Adres tego projektu 13.11 nie odpowiadał (nazwa się nie rozwiązuje), więc logowanie na podglądzie nie mogło zadziałać.
- **Zmienne z jedną wartością dla wszystkich kontekstów (`all`)** są z definicji identyczne na produkcji, w podglądach i we wdrożeniach gałęzi: `PAYU_ENV` (= `production`), `PAYU_OAUTH_CLIENT_ID`, `PAYU_OAUTH_CLIENT_SECRET`, `PAYU_POS_ID`, `PAYU_SECOND_KEY`, `FM_EXPORT_TOKEN`, `RESEND_WEBHOOK_SECRET`, a także niesekretne `PROFORMA_BANK_IBAN`, `PROFORMA_SELLER_NIP`, `ACCOUNT_EMAIL_CONTACT_FIX`. To jest dowód, nie przypuszczenie: te zmienne mają jeden wspólny wpis.
- **Kontekst `branch-deploy`** ma `VITE_SUPABASE_URL` projektu produkcyjnego. Wdrożenia gałęzi nie są uruchamiane (dozwolona gałąź: tylko `main`).
- **Brak zmiennych wspólnych konta** (dziedziczonych między projektami) i **brak build hooków** w projekcie.
- **`MARKETING_SEND_ENABLED`** w podglądzie nie jest ustawione — to blokuje tylko kampanie marketingowe, nie pozostałe maile.

### Co jest tylko podejrzeniem

Sekrety z osobnym wpisem na kontekst — `RESEND_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — API zwraca zamaskowane (16 gwiazdek i 4 ostatnie znaki). Da się porównać wyłącznie końcówki:

| Zmienna | podgląd PR a produkcja | gałąź a produkcja |
|---|---|---|
| `RESEND_API_KEY` | końcówka zgodna — **podejrzenie**, że to ten sam klucz | nie porównywano osobno; wpis istnieje |
| `OPENAI_API_KEY` | końcówka zgodna — **podejrzenie** | wpis istnieje |
| `SUPABASE_SERVICE_ROLE_KEY` | końcówka inna — to inny klucz (spójne z innym projektem) | wpis istnieje; przy produkcyjnym adresie bazy należy zakładać klucz produkcyjny |

Zgodność czterech znaków nie dowodzi identyczności kluczy. Do czasu sprawdzenia przez osobę znającą wartości te wpisy trzeba traktować jak produkcyjne.

### Ścieżki wysyłki poczty

Wszystkie na `RESEND_API_KEY`: `send-retailer-batch`, `send-supplier-notification`, powiadomienie dostawcy o odczycie (`_shared/supplier-read-notify`), `send-expiry-reminders` i `send-inactivity-warnings` (obie wołane automatycznie przy każdym wejściu zalogowanego użytkownika), `register-supplier-self`, `fm-plan-send`, `generate-proforma`, `marketing-send` / `marketing-campaign` (za flagą).

### Wykonane 13.11

| Zabezpieczenie | Stan | Dowód |
|---|---|---|
| Usunięcie podglądu `6af718218971caf123529964` | zrobione | adres podglądu, adres wdrożenia i funkcje → 404; API Netlify → 404 |
| Automatyczne podglądy wyłączone w ustawieniach projektu (`build_settings.skip_prs = true`) | zrobione | odczyt po zmianie: `skip_prs = true`; skrót pozostałych ustawień budowania identyczny przed i po; po kolejnym pushu nie powstał żaden build podglądu (dziennik) |
| `ignore = "exit 0"` dla `deploy-preview` i `branch-deploy` w `netlify.toml` | zrobione, zostaje jako dodatkowa ochrona | dwa buildy podglądu anulowane przez Netlify przed wyłączeniem w ustawieniach |
| PR jako szkic | zrobione | — |
| Odcięcie produkcyjnych kluczy od `deploy-preview` i `branch-deploy` | zrobione (Artur, skrypt `07 --apply`) | 0 z 19 par klucz–kontekst z dostępem; produkcja 24/24 bez zmian — dwie niezależne kontrole odczytem |

`ignore` nie jest pełnym wyłączeniem: nie zatrzymuje buildów z build hooka (w projekcie nie ma żadnego) i nie działa w gałęziach bez tej reguły. Dlatego właściwym wyłącznikiem jest ustawienie projektu.

### WYKONANE 13.11 — odcięcie produkcyjnych kluczy od podglądów i gałęzi

Przebieg `--apply` skryptu `07` (wersja z commita `819f316`, GO recenzenta) wykonał **Artur**. Wynik potwierdziły niezależnie dwie kontrole odczytem — Codexa i Claude'a — względem odcisków stanu sprzed operacji (wartości jawne: skrót wartości; sekrety: identyfikator wpisu; żadna wartość nie była wypisywana ani zapisywana):

| Kontrola | Wynik |
|---|---|
| Izolacja: wskazane pary klucz–kontekst z dostępem do wartości | **0 z 19** (przed operacją 19 z 19) |
| Produkcja: 24 zmienne względem odcisków sprzed operacji | bez zmian — wartości jawne te same, identyfikatory wpisów sekretów te same |
| Zakresy zmiennych (builds / functions / runtime…) | bez zmian |
| Zmiany poza planem | brak |
| Konteksty po operacji | 7 zmiennych z `all` → `production` + `dev`; `RESEND_API_KEY` i `OPENAI_API_KEY` bez wpisów `deploy-preview` i `branch-deploy`; `SUPABASE_SERVICE_ROLE_KEY` bez wpisu `branch-deploy` |
| Opublikowane wdrożenie | to samo: `6af2db23` (main `9c8e747`) |
| Podglądy PR w ustawieniach projektu | nadal wyłączone (`skip_prs = true`) |
| Ponowny przebieg skryptu na sucho | „bez zmian” dla wszystkich pozycji, kod 0 |

Ograniczenie tej kontroli: przy sekretach potwierdzona jest tożsamość wpisu produkcyjnego (ten sam identyfikator), nie pełna wartość — API jej nie zwraca.

Claude nie wykonał żadnego zapisu zmiennych (zapis do magazynu sekretów jest zablokowany w jego środowisku). Pierwsza wersja skryptu dostała od recenzenta NO-GO; poprawki opisuje tabela niżej.

Zakres (produkcja bez zmian):

- `PAYU_ENV`, `PAYU_OAUTH_CLIENT_ID`, `PAYU_OAUTH_CLIENT_SECRET`, `PAYU_POS_ID`, `PAYU_SECOND_KEY`, `FM_EXPORT_TOKEN`, `RESEND_WEBHOOK_SECRET`: zamiast jednej wartości dla wszystkich kontekstów — ta sama wartość tylko dla **Production** i **Local development**;
- `RESEND_API_KEY`, `OPENAI_API_KEY`: usunąć wpisy **Deploy Previews** i **Branch deploys**;
- `SUPABASE_SERVICE_ROLE_KEY`: usunąć wpis **Branch deploys** (w Deploy Previews jest klucz projektu testowego).

#### Skrypt `07` — wersja poprawiona po review (GO recenzenta dla `819f316`)

Uwagi recenzenta i co się zmieniło:

| Uwaga | Poprawka | Test |
|---|---|---|
| P1: wartości sekretów w argumentach polecenia (`execSync … --data`), ryzyko wypisania w błędzie | zapisy idą przez HTTPS — wartość tylko w treści żądania; odczyty przez `netlify api` dostają wyłącznie identyfikatory (kontrola argumentów); każdy błąd jest przepisywany na komunikat bez treści polecenia, odpowiedzi i wartości | „[P1] sekrety poza linią poleceń…” (6 testów) |
| P2: kod 0 mimo klucza nadal widocznego w podglądzie (dziedziczenie z `all`) | brak wskazanych kluczy w podglądzie i gałęzi jest **wymuszany** kodem wyjścia, z uwzględnieniem dziedziczenia; sekret z wpisem `all` = odmowa przed jakimkolwiek zapisem | „[P2] sukces tylko wtedy…” (4 testy) |
| P2: wyjątek po zapisie zatrzymywał skrypt bez cofnięcia i bez kontroli | awaria po zapisie lub w jego trakcie = **stan niepewny**: żadnych dalszych zapisów, żadnego automatycznego cofania; skrypt ustala faktyczny stan (weszła / nie weszła / inny / nieznany), wykonuje kontrolę końcową i kończy kodem 2 | „[P2] awaria po zapisie…” (6 testów) |
| zamaskowane sekrety | niezmienność wpisu produkcyjnego potwierdza **identyfikator wpisu**, nie pełna wartość | „zamaskowane sekrety…” (2 testy) |

Dodatkowo: wszystkie warunki wstępne są sprawdzane dla wszystkich zmiennych, zanim cokolwiek zostanie zapisane; ponowne uruchomienie jest bezpieczne (pomija to, co już zrobione); domyślnie skrypt działa **na sucho**, zapis wymaga `--apply`.

Kody wyjścia: `0` odcięte i produkcja bez zmian · `1` niezaliczone · `2` stan niepewny · `3` odmowa (nic nie zapisano).

Logika: `scripts/lib/netlify-context-isolation.mjs`; testy z atrapami: `tests/netlify-context-isolation.test.js` (27 testów, fikcyjne dane).

```
node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs            # próba na sucho (tylko odczyt)
node docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs --apply    # zapis (wykonany 13.11; ponowne uruchomienie niczego nie zmienia)
```

Przebieg na sucho na prawdziwym projekcie (13.11, tylko odczyt): 7 zmiennych do ograniczenia, 5 wpisów do usunięcia; w symulacji po zmianach żaden z 19 par klucz–kontekst nie jest dostępny, a 24 zmienne produkcyjne są bez zmian; kod 0.

Ścieżka zapisu przez HTTPS, wcześniej sprawdzona tylko na atrapie, zadziałała w przebiegu `--apply` 13.11 (wynik w tabeli wyżej).

#### Alternatywa: ręcznie w panelu Netlify

Project configuration → Environment variables → przy zmiennej Options → Edit → „Different value for each deploy context” → zostawić Production i Local development, wyczyścić Deploy Previews i Branch deploys → Save.

Zmiany w zmiennych nie uruchamiają builda i nie dotykają opublikowanego wdrożenia.

Poza zakresem tego kroku, do decyzji: kontekst `branch-deploy` nadal ma adres i klucz publiczny produkcyjnej bazy (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — to nie sekrety, ale wdrożenie gałęzi łączyłoby się z produkcją); kontekst `dev-server` ma własne wpisy `RESEND_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Podglądu Netlify nie podłączam do bazy testowej: izolowane środowisko testowe już istnieje (lokalny podgląd z `.env.test`) i na nim wykonano komplet testów.

## 4. Kolejność wdrożenia

Każdy krok ma warunek przejścia dalej. Wynik każdego kroku zapisz w dzienniku na końcu tego pliku.

| # | Krok | Kto | Warunek przejścia |
|---|---|---|---|
| 1 | `01-kontrola-przed-migracja.sql` na produkcji (tylko odczyt) — powtórzyć w dniu migracji | Artur / Codex | wiersze 1–9 = OK (wiersz 9: suma kontrolna zastępowanej funkcji); zapisz wartości „informacja” (20–31 i podział na sieci 100+) |
| 2 | Migracja: cała treść `supabase/migrations/20261113120000_manual_read_confirm.sql` jednym Run | Artur / Codex | „Success. No rows returned” |
| 3 | `03-kontrola-po-migracji.sql` (tylko odczyt) | Artur / Codex | 11/11 OK |
| 4 | Produkcja po migracji, jeszcze na starym kodzie: panel admina i Pipeline otwierają się bez błędów | Artur | brak błędów; stary kod nie używa nowych funkcji |
| 5 | PR: „Ready for review”, przegląd, scalenie do `main` | Artur / Codex | Netlify: deploy produkcyjny `ready`, commit zgodny ze scaleniem |
| 6 | `04-PROBA-PO-WDROZENIU.md` na kontach testowych + `05-kontrola-po-wdrozeniu.sql` | Artur + Claude | wszystkie oczekiwane wyniki |
| 7 | Zamknięcie: wpis w dzienniku, konta testowe z powrotem zawieszone | Artur | — |

Między krokiem 2 a 5 może minąć dowolny czas — po migracji stary kod działa jak dotąd (funkcja odczytu ma te same argumenty i wynik, dopisuje tylko nowe pola).

### Zakres nowej reguły na produkcji — kontrola z 13.11.2026 (tylko odczyt)

Uruchomiona w Supabase → SQL Editor na projekcie produkcyjnym; treść zapytania zgodna co do bajta z plikiem `01-kontrola-przed-migracja.sql` z commita `e26e497` (suma kontrolna sprawdzona przed uruchomieniem). Zapytanie to pojedynczy `SELECT`; niczego nie zapisuje.

**Warunki wstępne migracji (wiersze 1–8): 8/8 OK** — zależności istnieją, nowych funkcji jeszcze nie ma, kolumny zgodne.

**Powtórzona 13.11 po poprawkach z review (plik z commita `2ad5dd4`, z nowym wierszem 9): 9/9 OK.** Wiersz 9: `mark_legacy_send_seen` na produkcji ma skrót `8b3a720e7374e0bfe873969401706f63` — dokładnie treść z migracji 20260927120000, na której oparta jest nowa wersja. Liczby w tabeli poniżej bez zmian.

**Liczba propozycji objętych regułą „kredyt przy wejściu kupca”:**

| Wiersz | Co | Wynik |
|---|---|---|
| 20 | propozycje czekające razem (`sent` / `opened`) — pierwsze wejście kupca zmieni im status | **12** |
| 21 | z nich nierozliczone — tyle kredytów może zejść przy pierwszych wejściach kupców | **10** |
| 22 | z nierozliczonych: w sieciach aktywnych z co najmniej jednym aktywnym kontem kupca | 10 |
| 23 | z nierozliczonych: w sieciach nieaktywnych albo bez aktywnego konta kupca | 0 |
| 24 | z realnego zakresu: dostawca ma wolny kredyt (kredyt zejdzie) | 10 |
| 25 | z realnego zakresu: dostawca nie ma wolnego kredytu | 0 |
| 26 | z nierozliczonych: **bez wysłanego mailingu** (kupiec nie dostał jeszcze maila) | **8** |
| 27 | `opened` już rozliczone otwarciem maila (wejście zmieni tylko status) | 2 |
| 28 | sieci / dostawcy z nierozliczonymi czekającymi propozycjami | 8 / 2 |
| 29 | daty wysłania nierozliczonych czekających | 2026-10-29 – 2026-11-04 |
| 30 | odczyty aplikacji zapisane dotąd na administratora (rozliczenia z podglądu konta kupca) | 2 |
| 31 | `read_manual` bez rozliczenia | 0 |

Podział nierozliczonych na sieci (wszystkie aktywne, wszystkie u dostawców z wolnym kredytem): Albert CZ/Bakker 2 (1 bez mailingu), PROMO Cash and Carry 2 (2), Aldi Polska 1 (1), Makro Polska 1 (1), NOVUS 1 (1), Mega Image 1 (1), Bingo 1 (0), Tesco 1 (1).

Co z tego wynika:

- po wdrożeniu kodu pierwsze wejście kupca każdej z 8 sieci rozliczy propozycje czekające na tę sieć — łącznie do **10 kredytów u 2 dostawców**;
- **8 z tych 10** to propozycje, dla których mailing do sieci jeszcze nie wyszedł. Obecny kod rozlicza je dopiero, gdy kupiec otworzy listę propozycji; nowy — już przy samym wejściu do aplikacji. **Artur potwierdził 13.11.2026, że tak ma być:** wejście kupca rozlicza także propozycje sprzed wysłania mailingu;
- wiersz 30 potwierdza, że błąd podglądu administratora wystąpił na produkcji: 2 odczyty zapisane na administratora;
- liczby zmieniają się z każdą nową wysyłką i odczytem — kontrolę trzeba powtórzyć w dniu migracji.

## 5. Wycofanie

1. Netlify → Deploys → poprzedni deploy produkcyjny `6af2db23` (main `9c8e747`) → **Publish deploy**. Nie `git push --force`.
2. Migracja może zostać w bazie — nowa `mark_legacy_send_seen` działa ze starym kodem, a dwóch nowych funkcji stary kod nie woła. Pełne wycofanie jest opcjonalne: `06-wycofanie-funkcji.sql` usuwa nowe funkcje i przywraca `mark_legacy_send_seen` w treści z migracji 20260927120000 (sprawdzone: po `06` kontrola `01` znów daje 9/9).
3. Rozliczenia wykonane przez nowy kod nie cofają się same. Ręczne potwierdzenie cofnij przyciskiem „Cofnij potwierdzenie” **przed** cofnięciem kodu; resztę koryguje bezpłatny kredyt od organizatora.

## 6. Pliki

- `01-kontrola-przed-migracja.sql` — warunki wstępne + liczby informacyjne (tylko odczyt)
- `supabase/migrations/20261113120000_manual_read_confirm.sql` — migracja: zastępuje `mark_legacy_send_seen`, dodaje `confirm_legacy_send_manual` i `undo_legacy_send_manual_confirm` (w repo, nie kopiowana tutaj, żeby nie było dwóch wersji)
- `03-kontrola-po-migracji.sql` — funkcje, sygnatury, uprawnienia (tylko odczyt)
- `04-PROBA-PO-WDROZENIU.md` — próba na kontach testowych po scaleniu
- `05-kontrola-po-wdrozeniu.sql` — ostatnie odczyty i rozliczenia (tylko odczyt)
- `06-wycofanie-funkcji.sql` — opcjonalne pełne wycofanie migracji po cofnięciu kodu (usuwa nowe funkcje, przywraca starą `mark_legacy_send_seen`)
- `07-odciecie-sekretow-od-podgladow.mjs` — odcięcie produkcyjnych kluczy od podglądów i gałęzi w Netlify (domyślnie na sucho; zapis `--apply` po zgodzie recenzenta); logika w `scripts/lib/netlify-context-isolation.mjs`, testy w `tests/netlify-context-isolation.test.js`

## 7. Dziennik

| Data | Krok | Wynik |
|---|---|---|
| 13.11.2026 | Testy na bazie testowej (pkt 2) | komplet zaliczony |
| 13.11.2026 | Podgląd Netlify PR #1 | usunięty, 404; PR jako szkic |
| 13.11.2026 | Blokada podglądów w `netlify.toml` (commit `efc2c0a`) | build podglądu `6af71c7e` anulowany przez Netlify („Canceled build due to no content change”), adres podglądu nadal 404, produkcja bez zmian (`9c8e747`) |
| 13.11.2026 | Podglądy PR wyłączone w ustawieniach projektu (`skip_prs = true`) | pozostałe ustawienia budowania bez zmian (skrót identyczny) |
| 13.11.2026 | Odcięcie kluczy od podglądów i gałęzi (`07`) | NIEWYKONANE przez Claude'a (zapis sekretów zablokowany); przebieg `--dry`: 7 zmiennych do ograniczenia, 5 wpisów do usunięcia, produkcja 25/25 bez zmian |
| 13.11.2026 | Skrypt `07` po review (NO-GO dla pierwszej wersji) | przepisany: zapis poza linią poleceń, wymuszona kontrola braku kluczy, stan niepewny po awarii; 27 testów z atrapami; przebieg na sucho na prawdziwym projekcie: kod 0, nic nie zapisano; czeka na zgodę recenzenta |
| 13.11.2026 | Review skryptu `07` w `819f316` | GO recenzenta dla skryptu (nie dla migracji ani scalenia PR); następny krok: nadzorowany `--apply`, bez równoległych zmian zmiennych |
| 13.11.2026 | `--apply` | NIEWYKONANE: próba Claude'a zablokowana przez zabezpieczenie jego środowiska (zapis do magazynu sekretów) przed uruchomieniem — zmienne w stanie wyjściowym (kontrola odczytem: 19/19 par klucz–kontekst nadal z dostępem, produkcja bez zmian). Uruchamia Artur; po przebiegu Claude wykonuje niezależną kontrolę odczytem i dopisuje wynik |
| 13.11.2026 | `--apply` skryptu `07` | **ZALICZONE.** Uruchomił Artur. Kontrole odczytem (Codex i Claude, niezależnie): izolacja 0/19 par z dostępem; produkcja 24/24 zgodna z odciskami sprzed operacji (wartości jawne i identyfikatory wpisów sekretów); zakresy bez zmian; brak zmian poza planem; opublikowany deploy ten sam (`6af2db23`, `9c8e747`); podglądy PR wyłączone. Etap zabezpieczeń zamknięty |
| 13.11.2026 | `01-kontrola-przed-migracja.sql` na produkcji (tylko odczyt, commit `e26e497`) | warunki wstępne 8/8 OK; 12 czekających, 10 nierozliczonych (8 sieci, 2 dostawców), z tego 8 bez wysłanego mailingu; 2 odczyty zapisane dotąd na administratora; szczegóły w pkt 4 |
| 13.11.2026 | Decyzja Artura: rozliczenie przed mailingiem | potwierdzone — wejście kupca rozlicza także propozycje, dla których mailing jeszcze nie wyszedł (w kontroli z 13.11: 8 z 10 nierozliczonych) |
| 13.11.2026 | Końcowe review `cffea69` | **NO-GO** — P1: cofnięcie ręcznego potwierdzenia zwracało kredyt mimo późniejszego odczytu kupca; P2: błąd pojedynczej pozycji przy HTTP 200 blokował ponowienie |
| 13.11.2026 | Poprawki po review (`b10ba3a` + pakiet) | P1 i P2 poprawione; SQL 16/16, wyścig dwóch połączeń 4/4, próba end-to-end 26/26, `npm test` 1300, build OK; stary kod na bazie z poprawioną migracją bez zmian; migracja zastępuje teraz `mark_legacy_send_seen` — do ponownego review |
| 13.11.2026 | `01-kontrola-przed-migracja.sql` na produkcji po poprawkach (tylko odczyt, commit `2ad5dd4`) | 9/9 OK, w tym suma kontrolna `mark_legacy_send_seen` zgodna z oczekiwaną; liczby jak wcześniej: 12 czekających, 10 nierozliczonych, 8 bez mailingu |
| 13.11.2026 | Ponowne review `437fee3` | **NO-GO** — P1: panel kupca pomijał propozycje `read_manual` przy wejściu, na liście i w szczególe; baza i P2 potwierdzone jako poprawne |
| 13.11.2026 | Poprawka po 2. rundzie review | panel zgłasza odczyt propozycji potwierdzonych ręcznie (tylko już rozliczonych tym potwierdzeniem); próba w przeglądarce 30/30 z czystą sekwencją potwierdzenie → wejście kupca → cofnięcie: jedno pobranie, zero zwrotów, status `read`; `npm test` 1316, build OK, SQL 16/16, wyścig 4/4; migracja bez zmian względem `b10ba3a` — do ponownego review |
| 13.11.2026 | Ponowne review `8f81321` | **NO-GO** — P1 zamknięty; P2: po sekwencji mail → potwierdzenie ręczne panel nie zgłasza odczytu w aplikacji (status po cofnięciu `opened` zamiast `read`); kredyt poprawny |
| 13.11.2026 | Poprawka po 3. rundzie review | warunek odczytu obejmuje każdą rozliczoną `read_manual` bez odczytu w aplikacji (także rozliczoną mailem); nierozliczone nadal pomijane; `npm test` 1328, build OK, SQL 18/18, wyścig 4/4, próba w przeglądarce 40/40; migracja i funkcje bazy bez zmian względem `8f81321` — do ponownego review |
| — | Migracja produkcyjna i scalenie PR | **NIEWYKONANE** — osobny krok, do czasu GO recenzenta i zgody Artura (pkt 4) |
