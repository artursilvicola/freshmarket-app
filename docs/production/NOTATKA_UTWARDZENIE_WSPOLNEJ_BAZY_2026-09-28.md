# Utwardzenie dwóch starszych mechanizmów we wspólnej bazie — pakiet do wykonania (28.09.2026)

Źródło: `AUDYT_CODEX_2026-09-28_STARSZE_OSTRZEZENIA_SUPABASE.md` (P1 artykuły scrapera, P1 stary cron przypomnień). **Nic nie zostało wykonane na produkcji.** Gałąź `fix/legacy-shared-db-hardening` w repo B2B; workflow weryfikujący w repo scrapera (nieskomitowany, do dodania).

## Co ustaliłem (fakty, nie założenia)

| Pytanie | Odpowiedź | Dowód |
|---|---|---|
| Skąd otwarte polityki zapisu na tabelach artykułów? | `freshmarket-scraper/supabase_migration_v2.sql`: `CREATE POLICY "service_full_*" … FOR ALL USING (true) WITH CHECK (true)` **bez `TO`** → obowiązuje dla PUBLIC (anon, authenticated). Ten sam wzorzec ma 7 tabel: `article_facts`, `article_prices`, `drafts`, `exchange_rates`, `scrape_errors`, `season_calendar`, `sources`; polityka „Service full access articles” na `articles` powstała wcześniej poza plikami SQL (Codex widział ją w produkcji). | grep w repo scrapera |
| Czym pisze scraper Python (GitHub Actions)? | `database.py`: `create_client(SUPABASE_URL, SUPABASE_KEY)`; `main.py` dokumentuje `SUPABASE_KEY` jako **Service Role Key**; workflowy przekazują `secrets.SUPABASE_KEY`. **Rola tego sekretu nie jest widoczna z zewnątrz** (GitHub nie pokazuje wartości). | `database.py:24–35`, `main.py:10`, `.github/workflows/*.yml` |
| Czym piszą funkcje Netlify scrapera (dashboard, analiza, drafty, publikacja)? | 21 plików używa `SUPABASE_SERVICE_ROLE_KEY`; żaden nie używa klucza anon. W Netlify (site `freshmarket-raporty`) są zmienne `SUPABASE_SERVICE_ROLE_KEY` i `SUPABASE_KEY` (oba oznaczone jako sekret — wartości nie do odczytu przez CLI). | grep `netlify/functions`, `netlify api getEnvVars` |
| Czy dashboard scrapera pisze do bazy z przeglądarki (kluczem anon)? | **Nie.** `dashboard/index.html` nie ma klienta Supabase; wszystko idzie przez funkcje Netlify. | grep `dashboard/` |
| Kto czyta `articles` anonimowo? | Nie znalazłem konsumenta w repo B2B ani w dashboardzie; publikacja do fresh-market.pl idzie przez CMS (PHP), nie przez Supabase. Odczyt publiczny **zostawiam bez zmian** (bez ryzyka regresji), zmieniam tylko zapis. | grep obu repo |
| Gdzie żyje `fm_14d_reminder_job`? | Tylko w bazie (drugi system, `freshmarketb2b.netlify.app`, Edge Function `send-email` + pg_cron). Harmonogram `fm-14d-reminder` wyłączony 10.06 (`cron.unschedule`), ale funkcja pozostaje wywoływalna przez anon/authenticated. | pamięć incydentu 10.06; audyt Codexa |

## Poprawka (repo B2B, gałąź `fix/legacy-shared-db-hardening`)

`supabase/migrations/20260928120000_legacy_shared_db_hardening.sql` — **warunkowa i idempotentna** (obiekty powstały poza tym repo; w pustej bazie tylko NOTICE):

1. `articles`, `article_facts`, `article_prices`: usuwa każdą politykę zapisu (INSERT/UPDATE/DELETE/ALL) nieograniczoną do `service_role`, tworzy `service_role_write_<tabela>` (`FOR ALL TO service_role`), zachowuje polityki SELECT (odczyt publiczny bez zmian), **odbiera bezpośrednie GRANT-y zapisu od PUBLIC, anon i authenticated** (RLS jako druga warstwa, nie jedyna), zostawia SELECT dla anon/authenticated i ALL dla service_role.
2. `fm_14d_reminder_job` (każda sygnatura o tej nazwie): `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO postgres`. To zamyka także dziedziczenie z PUBLIC (uwaga Codexa) — test sprawdza `has_function_privilege` dla anon i authenticated.

**Test:** `scripts/legacy-hardening-sql-test.mjs` (embedded PG 17): wszystkie migracje od zera (hardening na pustej bazie = no-op), atrapy o pierwotnym dziurawym kształcie → **dziura potwierdzona** (anon wstawia artykuł, anon woła funkcję) → migracja dwukrotnie → anon/authenticated: SELECT działa, INSERT/UPDATE/DELETE 42501, funkcja 42501; service_role: zapis działa; postgres (pg_cron): funkcja działa. **PASS 28.09.**

## Warunek przed wykonaniem: rola klucza scrapera w GitHub Actions

Jeśli `secrets.SUPABASE_KEY` jest kluczem **anon**, po migracji scraper przestanie zapisywać artykuły (RLS + brak GRANT). Dlatego w repo scrapera przygotowałem `.github/workflows/verify-supabase-key-role.yml` (ręczne uruchomienie): dekoduje pole `role` z ładunku JWT obu sekretów i drukuje **tylko** `role=service_role` / `role=anon` (nigdy klucz). Procedura:

1. Skomitować workflow do `main` scrapera, uruchomić z zakładki Actions → „verify-supabase-key-role” → Run workflow.
2. `SUPABASE_KEY: role=service_role` → można wykonać migrację. `role=anon` → najpierw podmienić sekret na Service Role Key (Supabase → Settings → API), dopiero potem migracja.
3. Funkcje Netlify: kod używa `SUPABASE_SERVICE_ROLE_KEY` (z fallbackiem na `SUPABASE_KEY`); zmienna istnieje w site `freshmarket-raporty`. Dashboard → „Health” pokazuje `SERVICE_ROLE_KEY=✓`.

## Wykonanie (SQL Editor, Artur lub Codex)

1. Kontrola przed (tylko odczyt): zapytania z końca pliku migracji (polityki, granty, `has_function_privilege`) — zapisać wynik.
2. Wkleić całą migrację (`begin … commit`), uruchomić; komunikaty NOTICE pokażą, które polityki usunięto.
3. Kontrola po: te same zapytania; oczekiwane: polityki zapisu tylko `{service_role}`, anon/authenticated tylko SELECT, funkcja anon=f/authenticated=f.
4. Kontrola funkcjonalna scrapera **tego samego dnia**: (a) dashboard → Health (SERVICE_ROLE_KEY ✓); (b) po najbliższym runie GitHub Actions (`scrape.yml`, ~8:40 PL) nowe wiersze w `articles` (`select max(created_at) from articles`) — brak nowych wierszy z błędem 42501 w logu Actions = klucz był anon → patrz warunek wyżej; (c) w dashboardzie analiza/draft jednego artykułu (funkcje Netlify piszą `article_facts`/`drafts`).
5. Stary cron: nic więcej — harmonogram pozostaje wyłączony; funkcja zostaje dla ewentualnego przyszłego, naprawionego użycia przez pg_cron.

**Rollback (tylko gdyby scraper przestał pisać, a podmiana sekretu nie była możliwa od ręki):** `grant insert, update, delete on public.articles, public.article_facts, public.article_prices to anon, authenticated; create policy … for all using (true) with check (true)` — czyli świadome przywrócenie dziury; lepiej podmienić klucz.

## Poza zakresem tego pakietu (do osobnych decyzji)

- Ten sam wzorzec otwartego zapisu ma jeszcze 5 tabel scrapera: `drafts`, `exchange_rates`, `scrape_errors`, `season_calendar`, `sources` (plus tabele z plików v3/v4, do sprawdzenia). Ta migracja ich nie dotyka; po potwierdzeniu roli klucza można rozszerzyć listę w migracji (jedna linia w `array[...]`) i test.
- P2 z audytu: `is_admin()` bez `active` — zmiana funkcji używanej przez cały system RLS, osobny przegląd.
- 29 RPC SECURITY DEFINER dostępnych dla anon / 58 dla authenticated — przegląd pojedynczo, nie hurtem.
- `articles_with_facts` jako widok SECURITY DEFINER — po ustaleniu konsumentów.
- Czy ktoś wykorzystał dziury: nieustalone; wymaga logów (Supabase → Logs → API/Postgres) z właściwego okresu — osobna analiza.
