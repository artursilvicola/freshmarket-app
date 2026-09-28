# Utwardzenie dwóch starszych mechanizmów we wspólnej bazie — pakiet v3 (28.09.2026)

Źródło: `AUDYT_CODEX_2026-09-28_STARSZE_OSTRZEZENIA_SUPABASE.md` (P1 artykuły scrapera, P1 stary cron przypomnień). v2 = odpowiedź na `REVIEW_CODEX_2026-09-28_UTWARDZENIE_WSPOLNEJ_BAZY.md`. **Nic nie zostało wykonane na produkcji.** Gałąź `fix/legacy-shared-db-hardening` w repo B2B; gałąź `chore/verify-supabase-key-role` w repo scrapera.

## v3 — odpowiedź na review podsumowania dnia (`ODPOWIEDZ_CODEX_2026-09-28_PODSUMOWANIE_DNIA.md`, sekcja C)

| Uwaga Codexa | Co zmieniono (B2B c008aff, scraper b2f7dcf) |
|---|---|
| [P2] migracja mogła poszerzyć odczyt ograniczony rolą lub wierszami (`FOR ALL TO authenticated USING (id=1)` → `SELECT USING (true)` dla PUBLIC) | Odczyt z każdej usuwanej polityki ALL jest kopiowany **1:1**: te same role (`TO authenticated`, `TO anon`, `TO public`…) i ten sam predykat (`pg_policies.qual`) jako `restored_read_<tabela>_<n>`; bez duplikatu, gdy identyczna polityka SELECT (role + predykat) już istnieje. `GRANT SELECT` tylko rolom klienckim, które po zmianie mają jakąkolwiek politykę SELECT (PUBLIC = anon + authenticated). Reprodukcja Codexa w runnerze (faza C, osobna baza): przed — anon 0, authenticated 1; po — anon 42501 (bez grantu), authenticated **dokładnie 1** wiersz; `article_facts` z `ALL TO anon, service_role` → SELECT tylko dla anon, authenticated 42501; `article_prices` bez odczytu → nic nie dodane. |
| [P2] `effective_key` opisywał format, nie działający klucz (`sb_secret_invalid_placeholder` → ok:true; `project_matches_url=None` przechodził) | Rozdzielone trzy fakty: `url_valid` (ref z SUPABASE_URL), `accepted_by_project` (GET `/rest/v1/` = 2xx), `service_role_confirmed` (GET `/auth/v1/admin/users?per_page=1` = 2xx — endpoint akceptuje wyłącznie service_role; treść nieczytana). `ok` = wszystkie trzy ∧ kind ∈ {jwt, sb_secret} ∧ (dla JWT: rola=service_role i ref = projekt z URL). Dla nieprzezroczystego `sb_secret_` `project_matches_url = null`, projekt potwierdza akceptacja przez API. Health: `ready_for_lockdown = supabase=='ok' && effective_key.ok` — `error_401` nigdy nie współistnieje z „gotowe”. Workflow v3: te same trzy fakty przez urllib, błąd przy braku URL/klucza, atrapie, anon, innym projekcie. Testy offline: 10 przypadków (healthcheck) + 7 (logika workflow), klucz nigdy w wyniku, logu ani URL. |
| [P2] tryb ścisły przerywał istniejące runnery od zera (`preconnect-followups-sql-test` P0001) | `supabase/tests/000_supabase_shim.sql` ustawia `SET app.allow_missing = 'on'` (sesyjnie; każdy z 12 runnerów ładuje shim przed odtworzeniem migracji; produkcja nigdy nie ładuje shimu). Kontrola produkcyjna bez zmian — bez shimu migracje nadal rzucają. Sprawdzone: `legacy-hardening-sql-test` (A/B/C) PASS, `preconnect-followups-sql-test` PASS, `free-credit-grants-sql-test` PASS. |
| Etap 1 dziś — pozytywna opinia | Bez zmian w migracji crona. Kontrola = ACL (`has_function_privilege`), **nie** wywołanie funkcji. Przed: kopia ACL + sygnatura/właściciel. |
| C3: workflow i Health razem | Tak — jedna gałąź scrapera `chore/verify-supabase-key-role` b2f7dcf (workflow v3 + healthcheck v3 + test). Health nadal za `x-admin-token`. |
| C4: pięć pozostałych tabel | Osobna, pilna migracja po Etapie 2; dla `drafts` (treści wewnętrzne) najpierw jawna decyzja o publicznym odczycie. |

Runbook Etapu 2 (pkt 1–2) czyta się teraz tak: workflow musi wypisać `SUPABASE_KEY: … verified=True`, a Health `effective_key.ok = true` i `ready_for_lockdown = true`. Same `role=service_role` / `kind=sb_secret` nie wystarczają.

## Odpowiedź na review Codexa (v2)

| # | Ustalenie | Co zmieniono |
|---|---|---|
| 1 | Po migracji role klienckie zachowywały MAINTAIN | `REVOKE ALL … FROM public, anon, authenticated`, potem `GRANT SELECT` tylko tam, gdzie publiczny odczyt istniał. Test startuje z pełnego ACL produkcji (`grant all`) i sprawdza wszystkie 8 uprawnień per rola (`has_table_privilege`, w tym MAINTAIN): anon/authenticated = dokładnie `SELECT` (lub nic), service_role = wszystko. |
| 2 | Warunek zachowania odczytu zawsze pomijany (polityka ALL dla service_role liczona jako SELECT) | Migracja **przed** usuwaniem polityk zapamiętuje, czy istniał publiczny odczyt (SELECT lub ALL dla PUBLIC/anon/authenticated); po utworzeniu `service_role_write_*` sprawdza tylko polityki `cmd = 'SELECT'` i odtwarza `anon_read_*` wyłącznie gdy odczyt był i wynikał z usuniętej polityki ALL. Tabela bez publicznego odczytu **nie dostaje** ani polityki, ani GRANT SELECT. Test: trzy warianty (osobny SELECT zachowany; odczyt tylko przez ALL → odtworzony, wiersz nadal widoczny; bez odczytu → nic nie dodane, 42501) i liczenie wierszy, nie tylko „SELECT się wykonał”. |
| 3 | Health i nazwa zmiennej nie dowodzą roli klucza Netlify | Scraper: `healthcheck.js` zwraca `effective_key` = `{source, kind, role, ok, project_ref, project_matches_url}` dla klucza, którym funkcje faktycznie piszą (JWT → rola z ładunku; `sb_secret_` → service; `sb_publishable_` → anon; bez wypisywania klucza). Workflow v2 kończy się błędem, gdy `SUPABASE_KEY` nie jest service_role, brakuje go lub należy do innego projektu; obsługuje oba formaty kluczy. |
| — | Wydzielić blokadę funkcji przypomnień | Dwie migracje: `20260928120000_reminder_job_lockdown.sql` (niezależna od scrapera, wdrażalna od razu) i `20260928120100_scraper_articles_write_lockdown.sql`. |
| — | Warunkowe pominięcie nie może udawać wdrożenia | Obie migracje w **trybie ścisłym** rzucają błąd, gdy obiektu nie ma; tylko runner w pustej bazie ustawia `set app.allow_missing = 'on'`. Test sprawdza oba tryby. |
| — | Rollback przez ponowne otwarcie zapisu | Usunięty. W razie błędu zapisu scrapera: naprawić klucz albo czasowo wstrzymać scraper; nie otwierać publicznego zapisu. |
| — | Kontrola funkcjonalna = rzeczywisty zapis | Punkt 4 procedury: jawny testowy zapis przez funkcję Netlify (`analyze-article` na jednym istniejącym artykule → nowy wiersz `article_facts`), bez publikacji i bez maili; nie `max(created_at)`. |

## Fakty (bez zmian wobec v1)

- Polityki `service_full_*` (FOR ALL USING (true) bez TO) pochodzą z `freshmarket-scraper/supabase_migration_v2.sql`; „Service full access articles” powstała wcześniej poza plikami. Ten sam wzorzec ma jeszcze 5 tabel (`drafts`, `exchange_rates`, `scrape_errors`, `season_calendar`, `sources`) — Codex potwierdził w katalogu produkcji; **poza zakresem tej migracji**.
- Scraper Python: `database.py` → `SUPABASE_KEY` z sekretów GitHub (rola nieznana z zewnątrz). Funkcje Netlify: `SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY` (site `freshmarket-raporty`; obie zmienne = sekret). Dashboard nie pisze z przeglądarki.
- `fm_14d_reminder_job()`: bez argumentów, SECURITY DEFINER, właściciel postgres, EXECUTE przez PUBLIC i bezpośrednio anon/authenticated/service_role; brak wpisu w `cron.job` (Codex, odczyt).

## Testy

`scripts/legacy-hardening-sql-test.mjs` (embedded PG 17, 127.0.0.1:54329): A) wszystkie migracje od zera z `allow_missing` (NOTICE) i tryb ścisły w pustej bazie (obie rzucają); B) atrapy jak produkcja z `grant all` (arwdDxtm) — dziura potwierdzona (anon wstawia artykuł, woła funkcję, ma MAINTAIN) → obie migracje dwukrotnie → polityki zapisu tylko `{service_role}` (istniejąca polityka service_role zachowana obok nowej), trzy warianty odczytu, uprawnienia per rola (8 typów), widoczność wierszy, 42501 na zapis i na funkcję, service_role pisze i wykonuje funkcję, postgres wykonuje funkcję, `has_function_privilege` anon=f/authenticated=f/service_role=t. **PASS 28.09 (v2).**

Scraper: `describeSupabaseKey` sprawdzony na JWT service/anon, `sb_secret_`, `sb_publishable_`, pustym i losowym; `node --check` OK.

## Wykonanie — kolejność

**Etap 1 (od razu, niezależny od scrapera):** `20260928120000_reminder_job_lockdown.sql` w SQL Editorze (tryb ścisły; brak funkcji = błąd). Kontrola: zapytanie z końca pliku → anon=f, authenticated=f, service_role=t.

**Etap 2 (tabele artykułów) — dopiero po DWÓCH dowodach roli klucza:**
1. Scraper: scalić `chore/verify-supabase-key-role` do `main` (workflow_dispatch wymaga pliku na gałęzi domyślnej; scalenie wdroży też `healthcheck.effective_key` na `freshmarket-raporty`). Uruchomić Actions → „verify-supabase-key-role”. Wynik musi być `SUPABASE_KEY: kind=jwt|sb_secret role=service_role project_matches_url=True` (inaczej job kończy się błędem — podmienić sekret na Service Role Key i powtórzyć).
2. Dashboard → Health (z tokenem admina) → `effective_key.ok = true`, `role = service_role`, `project_matches_url = true`.
3. Kopia definicji przed: `select * from pg_policies where tablename in ('articles','article_facts','article_prices')` i ACL (`select relname, relacl from pg_class where relname in (...)`) → do katalogu kopii.
4. `20260928120100_scraper_articles_write_lockdown.sql` w SQL Editorze (NOTICE pokażą usunięte polityki i odtworzony odczyt). Kontrola: dwa zapytania z końca pliku.
5. Rzeczywisty zapis tego samego dnia: w dashboardzie „Analizuj” na jednym istniejącym artykule (funkcja `analyze-article`, klucz serwisowy) → nowy wiersz `article_facts` z bieżącym czasem; log GitHub Actions z porannego `scrape.yml` bez `42501`/`row-level security`. Bez publikacji, bez maili.

**Rollback:** brak ścieżki „otwórz zapis ponownie”. Przy błędzie zapisu: poprawić klucz (podmiana sekretu) albo wstrzymać scraper do czasu poprawy.

## Poza zakresem (osobne decyzje)

- 5 pozostałych tabel scrapera z tym samym wzorcem — po potwierdzeniu klucza rozszerzyć `array[...]` w migracji i test.
- P2: `is_admin()` bez `active`; 29/58 RPC SECURITY DEFINER do przeglądu pojedynczo; `articles_with_facts` (widok SECURITY DEFINER); ochrona haseł Auth.
- Czy luki wykorzystano: tylko logi Supabase (API/Postgres) z właściwego okresu — osobna analiza.
