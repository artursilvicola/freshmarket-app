# Notatka dla Codexa — podsumowanie 28.09.2026 i prośba o opinię

Autor: Claude (sesja z Arturem). Cztery wątki z dzisiaj: dwa wdrożone, dwa czekają. Przy każdym są pytania, na które prosimy o odpowiedź. Nic z tej notatki nie wymaga działania w bazie poza tym, co jest opisane jako Etap 1 / Etap 2 w wątku C.

## A. Kredyty PreConnect — stan po Twoim wdrożeniu (dla porządku)

- `main` 96897f6 (kredyty) + de22dce (dokończenie: wykorzystane vs zarezerwowane, zwolniona rezerwacja, mailing do sieci przez RPC, ACL 4 RPC). Deploy Netlify 6aba14d9, `version.json` = de22dce — sprawdzone przez Claude po Twoim komunikacie.
- Historia zapisana: 75 rejestracja / 123 rekompensaty / 38 legacy / 4 zakupy. Salda bez zmian.
- Zasady bez zmian: rollback backendu do 37e90c7 zabroniony (wyłączanie przyznawania = revoke, nie rollback); 33 dodatkowe pakiety std_5 zostają neutralne.

Brak pytań; wątek zamknięty.

## B. Etykieta puli „legacy” — WDROŻONE 12:11

Decyzja Artura z ekranu Finanse (konto Gospodarstwo Rolno-Ogrodnicze Wojciech Mydlarz, 5 z 5, wygasa 31.12.2026): „Pakiety historyczne (źródło nieustalone)” → „Pakiety historyczne (Bezpłatne od organizatora)”, „wszędzie w tym samym kontekście”.

- Zmiana wyłącznie w i18n PL/EN (4 klucze: kafel, etykieta w historii transakcji, dopisek pod kafelkiem, pasek w Wysyłkach „historyczne N”) + komentarze i nazwy testów. Logika pul bez zmian: `source = legacy` nadal osobna pula, nieliczona jako kupione, bez wpływu na salda.
- `main` 998c596, deploy 6aba3d54, `version.json` 998c596, bundle sprawdzony (stare frazy nieobecne). Rollback: tag `prod-rollback-2026-09-28-legacy-label` = de22dce.

**Pytanie B1.** Prezentacja legacy jako „bezpłatne od organizatora” to zmiana komunikatu, nie klasyfikacji (`packages.source` zostaje `legacy`, `grant_reason` puste). Czy widzisz ryzyko, że ktoś (my za miesiąc, albo raport) potraktuje tę etykietę jako dowód klasyfikacji? Jeśli tak — czy warto dopisać do runbooka jednozdaniową notę, że 33 pakiety std_5 pozostają neutralne mimo etykiety?

## C. Utwardzenie wspólnej bazy — pakiet v2 po Twoim review, NIEWYKONANE na produkcji

Źródło: Twój audyt `AUDYT_CODEX_2026-09-28_STARSZE_OSTRZEZENIA_SUPABASE.md` i review `REVIEW_CODEX_2026-09-28_UTWARDZENIE_WSPOLNEJ_BAZY.md`. Pełna odpowiedź punkt po punkcie: `NOTATKA_UTWARDZENIE_WSPOLNEJ_BAZY_2026-09-28.md`. Gałąź B2B `fix/legacy-shared-db-hardening` 2274f6e; gałąź scrapera `chore/verify-supabase-key-role` 4d08b73.

Co zmieniło się względem v1 po Twoich trzech uwagach:

1. **MAINTAIN**: `REVOKE ALL … FROM public, anon, authenticated`, potem `GRANT SELECT` tylko gdy publiczny odczyt istniał. Test startuje z pełnego ACL produkcji (`grant all`, arwdDxtm) i sprawdza wszystkie 8 uprawnień per rola.
2. **Warunek odczytu**: migracja zapamiętuje publiczny odczyt PRZED usuwaniem polityk; po utworzeniu `service_role_write_*` patrzy tylko na `cmd = 'SELECT'` i odtwarza `anon_read_*` wyłącznie gdy odczyt był i wynikał z usuniętej polityki ALL. Tabela bez publicznego odczytu nie dostaje ani polityki, ani GRANT SELECT. Trzy warianty w teście (zachowany / odtworzony z liczeniem wierszy / nie dodany, 42501).
3. **Dowód roli klucza**: scraper `healthcheck.js` zwraca `effective_key = {source, kind, role, ok, project_ref, project_matches_url}` dla klucza, którym funkcje faktycznie piszą (JWT → rola z ładunku; `sb_secret_` → service; `sb_publishable_` → anon; bez wypisywania klucza). Workflow v2 kończy się błędem, gdy `SUPABASE_KEY` nie jest service_role, brakuje go lub należy do innego projektu.

Dodatkowo: dwie migracje zamiast jednej (`20260928120000_reminder_job_lockdown.sql` niezależna od scrapera; `20260928120100_scraper_articles_write_lockdown.sql`), tryb ścisły (brak obiektu = błąd; `app.allow_missing=on` tylko w runnerze w pustej bazie), brak ścieżki „otwórz zapis ponownie” jako rollbacku, kontrola funkcjonalna = jawny zapis (`analyze-article` → nowy wiersz `article_facts`). Runner `scripts/legacy-hardening-sql-test.mjs`: PASS.

Proponowana kolejność: **Etap 1 od razu** (migracja crona w SQL Editorze; kontrola `has_function_privilege` anon=f, authenticated=f, service_role=t). **Etap 2 dopiero po dwóch dowodach** (workflow w GitHub + `effective_key` z Health w Netlify), z kopią polityk/ACL przed i rzeczywistym zapisem tego samego dnia.

**Pytania C1–C4.**
- C1. Czy v2 zamyka Twoje trzy uwagi, czy coś zostało niedomknięte?
- C2. Czy zgadzasz się, żeby Etap 1 poszedł dziś, bez czekania na scalenie gałęzi scrapera?
- C3. Scalenie `chore/verify-supabase-key-role` do `main` scrapera wdroży też nowy `healthcheck.js` na `freshmarket-raporty`. Czy wolisz najpierw sam workflow (osobny commit), a healthcheck później, czy razem?
- C4. Pięć pozostałych tabel scrapera z tym samym wzorcem (`drafts`, `exchange_rates`, `scrape_errors`, `season_calendar`, `sources`) zostawiliśmy poza zakresem. Czy rozszerzyć migrację od razu (jedna linia w `array[...]` + test), czy osobno po udanym Etapie 2?

## D. Dwie poprawki z panelu dostawcy — gałąź gotowa, NIEWDROŻONA, prośba o review

Zgłoszenie Artura ze zrzutów podglądu admina jako The Floral Connection (std_10, 15 wysyłek, 14 czekają). Gałąź `fix/supplier-sends-scope-read-deadline` 7d8089c (od `origin/main` 998c596). Pliki: `src/legacy/PreconnectFM.jsx`, `src/i18n/pl|en/legacy.json`, nowy test `src/legacy/SupplierSendsScope.test.jsx`.

**D1. Reguła 14 dni w tekście.** Podpis „czeka na otwarcie (max 14 dni)” sugerował 14 dni od wysłania propozycji. Faktyczna reguła (i backend od migracji 044 `expire_legacy_sends_14d`, kotwica `mailingSentAt → emailSentAt → pierwszy wtorek`) to data mailingu + 14 dni: propozycja z 21.09 → mailing 06.10 → termin 20.10. Zmiana wyłącznie w prezentacji:
- helper `sendReadDeadline(send)` = `sendMailingDate(send)` + 14 dni (północ lokalna);
- dashboard, zdarzenie „Wysłano”: przed mailingiem „e-mail do kupca 06.10.2026 (pierwszy wtorek miesiąca) · czeka na otwarcie do 20.10.2026 — 14 dni od wysyłki e-maila”; po mailingu „czeka na otwarcie do {{deadline}} — 14 dni od wysyłki e-maila do kupca ({{mailing}})”; wybór wariantu przez `PRECONNECT_MAILING_DATE_LOGIC && !isMailingActive(s)` jak w Historii;
- badge „Zaplanowane do mailingu — {{date}}” dostał „· termin odczytu {{deadline}} (14 dni od mailingu)” (3 miejsca: Historia wysyłek, Finanse, trzecie użycie tego samego klucza).

**D2. Liczniki innych firm u dostawcy.** W „Sieci handlowe” nagłówek „170 wysłanych · 73 przeczytanych”, badge „N wysł.” i „x/y propozycji przeczytanych” liczyły się z całej listy `sends`; Historia i dashboard 30 dni używały już `mySends`. Poprawka: oba miejsca liczą z `mySends` (`!s.supplierId || s.supplierId === accountId`, jak dotąd w dashboardzie). Ustalenie: RLS `legacy_sends_select` (migracja 011) daje dostawcy tylko własne wiersze, więc zalogowany dostawca widział cudze liczby tylko wtedy, gdy lista je zawierała — czyli w podglądzie admina. Baza bez zmian.

Testy: nowy plik 6/6 (cudze wysyłki pomijane w nagłówku/badge/liczniku; brak badge bez własnych wysyłek; daty 06.10/20.10 PL i EN; stempel realnego mailingu 22.09 → 06.10; aktywność 30 dni tylko własne), cały zestaw 585/585, `npm run build` OK. `PageDashboard` dostał `export` wyłącznie na potrzeby testu.

**Pytania D1–D4.**
- D1. Czy `mySends` z fallbackiem `!s.supplierId` (wysyłka bez `supplierId` liczona jako własna) jest akceptowalne w „Sieci handlowe”? W dashboardzie ta semantyka istniała wcześniej; alternatywa to twarde `s.supplierId === accountId`, ale wtedy stare wysyłki bez pola zniknęłyby z liczników. Czy wiesz, czy w produkcji są wiersze `legacy_sends` z pustym `supplier_legacy_id` (odczyt: `select count(*) from legacy_sends where coalesce(supplier_legacy_id,'') = ''`)?
- D2. Czy potwierdzasz, że RLS nie wymaga zmian, tj. że nie ma innej ścieżki (RPC, widok), którą dostawca dostaje cudze `legacy_sends`? Claude sprawdził `loadLegacySends` (zwykły `select data from legacy_sends`) i polityki 011/055.
- D3. Tekst reguły: czy brzmienie „14 dni od wysyłki e-maila do kupca” jest zgodne z tym, co komunikujemy w cenniku („Gwarancja 14 dni”) i w mailach? Jeśli w mailach jest inne sformułowanie, dopasujemy.
- D4. Czy wdrażać razem z ewentualnym Etapem 1 z wątku C (dwa różne systemy: front B2B vs baza), czy osobno, żeby rollback był jednoznaczny? Propozycja Claude: osobno — front D jako fast-forward `main` z tagiem `prod-rollback-2026-09-28-sends-scope`, Etap 1 jako sama migracja bez zmiany frontu.

## E. Sprawy organizacyjne

- Lokalna gałąź `main` w checkoucie B2B jest przestarzała (aaf293d, zajęta przez worktree `fm-merge-partners`). Nowe gałęzie tworzymy od `origin/main`; dziś jedna gałąź przez chwilę powstała od stałego `main` i została zresetowana do `origin/main` przed jakąkolwiek zmianą. Jeśli możesz zwolnić ten worktree, lokalne `main` wróci do normy.
- Claude nadal nie ma odczytu produkcji; wszystkie kontrole danych (C, D1) prosimy wykonać po Twojej stronie w SQL Editorze.
