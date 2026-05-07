-- ============================================================================
-- PreConnect Round 5.6 — bezpieczny cleanup ghost / seed danych
-- ============================================================================
--
-- KONTEKST
--   Po wdrozeniu Round 5 produkcyjny stan legacy_sends / legacy_offers zawiera:
--     - rekordy realnych dostawcow (sup-codex-silvicola, sup-s5)
--     - rekordy seed/bootstrap od dostawcow ktorzy nie istnieja w companies
--       (sup-s1 historyczny, sup-s14) — to sa "ghost" rekordy
--   Zanieczyszczaja admin pipeline i widoki kupca.
--
-- WYMOG WSTEPNY
--   Ten skrypt mozna uruchomic DOPIERO po deployu commit `6cf96c9` (Round 5.6).
--   Tamten commit gatuje seed bootstrap za `!import.meta.env.PROD`. Bez niego
--   kazdy DELETE bylby cofany przy nastepnym page-load (frontend zobaczyl
--   pusta tabele i ponownie wstawil SENDS_INIT/OFFERS_INIT z 14 demo sendami
--   i ofertami od ghost suppliers).
--
--   Sprawdz czy deploy jest live:
--     - https://app.netlify.com -> deploys -> latest = `6cf96c9`
--     - albo: w produkcyjnym bundle JS (https://freshmarketb2b.netlify.app) gdy
--       lokalny `localStorage.getItem('fm_sends')` jest null i tabela jest pusta,
--       widok dostawcy pokazuje "Brak propozycji" zamiast 14 demo wierszy.
--
-- KOLEJNOSC OPERACJI
--   1. AUDYT (Section A)        - tylko SELECT, niczego nie zmienia
--   2. PREVIEW (Section B)      - tylko SELECT, pokazuje co znikie
--   3. DELETE Wariant A (Section C)  - <-- REKOMENDOWANY na teraz
--      Rozbity na 3 BLOKI uruchamiane oddzielnie:
--        C.1 — BEGIN + DELETE-y + kontrolny SELECT (transakcja otwarta)
--        C.2 — COMMIT (osobny blok, uruchamiasz tylko jesli C.1 OK)
--        C.3 — ROLLBACK (osobny blok, uruchamiasz tylko jesli C.1 NIE OK)
--   4. WERYFIKACJA (Section D)
--   5. (opcjonalnie pozniej, NIE TERAZ) DELETE Wariant B (Section E)
--
-- WARIANT REKOMENDOWANY
--   Wariant A - usuwa wylacznie ghost_unmapped (sup-s1, sup-s14, jakikolwiek
--   inny supplier_legacy_id ktorego nie ma w companies). NIE rusza:
--     - sup-codex-silvicola (Unica Group, real)
--     - sup-s5 (Food Market Court, mapped seed - zostaje na pozniej)
--     - rekordow Round 5 z duzym legacy_id (>= 1e15)
--
--   Wariant B - dodatkowo usuwa stary format seed (legacy_id < 1e15) takze
--   dla zmapowanych supplierow. NIE URUCHAMIAJ TERAZ. Decyzja zaplanowana
--   na osobna runde.
--
-- BEZPIECZENSTWO
--   Wszystkie DELETE sa w jawnym BEGIN/COMMIT. Jesli wynik weryfikacji jest
--   nieoczekiwany - daj `ROLLBACK;` zamiast `COMMIT;` zeby cofnac zmiany.
-- ============================================================================


-- ============================================================================
-- SECTION A. AUDYT — klasyfikacja wszystkich supplier_legacy_id
-- ============================================================================
-- Trzy grupy:
--   real_mapped     - jest w companies AND ma >=1 rekord Round 5 (id >= 1e15)
--   seed_mapped     - jest w companies AND tylko stary format (id < 1e15)
--   ghost_unmapped  - NIE ma w companies (sup-s1, sup-s14, ...)
-- Tylko ghost_unmapped jest celem Wariantu A.

-- A.1 — sendy
WITH send_stats AS (
  SELECT
    supplier_legacy_id,
    COUNT(*) AS records,
    MIN(legacy_id) AS min_id,
    MAX(legacy_id) AS max_id,
    COUNT(*) FILTER (WHERE legacy_id < 1000000000000000) AS seed_count,
    COUNT(*) FILTER (WHERE legacy_id >= 1000000000000000) AS round5_count,
    array_agg(DISTINCT status) AS statuses,
    array_agg(DISTINCT retailer_id ORDER BY retailer_id) AS retailer_ids
  FROM legacy_sends
  GROUP BY supplier_legacy_id
)
SELECT
  ss.supplier_legacy_id,
  c.name AS company_name,
  ss.records,
  ss.seed_count,
  ss.round5_count,
  ss.min_id,
  ss.max_id,
  ss.statuses,
  ss.retailer_ids,
  CASE
    WHEN c.id IS NULL THEN 'ghost_unmapped'
    WHEN ss.round5_count > 0 THEN 'real_mapped'
    ELSE 'seed_mapped'
  END AS classification
FROM send_stats ss
LEFT JOIN companies c ON c.legacy_supplier_id = ss.supplier_legacy_id
ORDER BY classification, ss.supplier_legacy_id;


-- A.2 — oferty
WITH offer_stats AS (
  SELECT
    supplier_legacy_id,
    COUNT(*) AS records,
    MIN(legacy_id) AS min_id,
    MAX(legacy_id) AS max_id,
    COUNT(*) FILTER (WHERE legacy_id < 1000000000000000) AS seed_count,
    COUNT(*) FILTER (WHERE legacy_id >= 1000000000000000) AS round5_count,
    array_agg(DISTINCT status) AS statuses
  FROM legacy_offers
  GROUP BY supplier_legacy_id
)
SELECT
  os.supplier_legacy_id,
  c.name AS company_name,
  os.records,
  os.seed_count,
  os.round5_count,
  os.min_id,
  os.max_id,
  os.statuses,
  CASE
    WHEN c.id IS NULL THEN 'ghost_unmapped'
    WHEN os.round5_count > 0 THEN 'real_mapped'
    ELSE 'seed_mapped'
  END AS classification
FROM offer_stats os
LEFT JOIN companies c ON c.legacy_supplier_id = os.supplier_legacy_id
ORDER BY classification, os.supplier_legacy_id;


-- ============================================================================
-- SECTION B. PREVIEW — co dokladnie znikie w Wariancie A
-- ============================================================================
-- Same SELECT-y. Skopiuj wynik do arkusza/csv jesli chcesz mie backup
-- przed DELETE.

-- B.1 — ghost sendy do skasowania
SELECT
  s.legacy_id,
  s.supplier_legacy_id,
  s.retailer_id,
  r.name AS retailer_name,
  s.status,
  s.data->>'sendDate' AS send_date,
  s.created_at,
  s.updated_at
FROM legacy_sends s
LEFT JOIN retailers r ON r.id = s.retailer_id
WHERE s.supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
)
ORDER BY s.legacy_id;


-- B.2 — ghost oferty do skasowania
SELECT
  o.legacy_id,
  o.supplier_legacy_id,
  o.status,
  o.data->>'title' AS title,
  o.data->>'product' AS product,
  o.created_at
FROM legacy_offers o
WHERE o.supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
)
ORDER BY o.legacy_id;


-- B.3 — agregat zbiorczy (ile rekordow, jakie statusy, jakie sieci, jacy
--        suppliers) — dobry sanity check przed DELETE
SELECT
  'sends_to_delete' AS scope,
  COUNT(*) AS rows,
  array_agg(DISTINCT supplier_legacy_id ORDER BY supplier_legacy_id) AS suppliers,
  array_agg(DISTINCT status ORDER BY status) AS statuses,
  array_agg(DISTINCT retailer_id ORDER BY retailer_id) AS retailer_ids
FROM legacy_sends
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
)
UNION ALL
SELECT
  'offers_to_delete',
  COUNT(*),
  array_agg(DISTINCT supplier_legacy_id ORDER BY supplier_legacy_id),
  array_agg(DISTINCT status ORDER BY status),
  NULL
FROM legacy_offers
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
);


-- ============================================================================
-- SECTION C. DELETE — Wariant A (REKOMENDOWANY na teraz)
-- ============================================================================
-- Usuwa wylacznie ghost_unmapped.
-- NIE rusza: sup-codex-silvicola, sup-s5, ani niczego co ma match w companies.
-- NIE rusza: rekordow Round 5 z duzym legacy_id.
--
-- PROCEDURA 2-ETAPOWA — uruchamiaj BLOKAMI ODDZIELNIE.
-- Sekcja podzielona na trzy SAMODZIELNE bloki: C.1 (DELETE w transakcji bez
-- COMMIT), C.2 (COMMIT) i C.3 (ROLLBACK). Uruchamiasz najpierw C.1, patrzysz
-- na wynik kontrolnego SELECT-a, potem ZALEZNIE od wyniku odpalasz C.2
-- albo C.3 — nigdy obu.
--
-- WAZNE:
--   1) Uruchom dopiero po sprawdzeniu Section A i Section B.
--   2) Po C.1 transakcja zostaje OTWARTA do czasu C.2 albo C.3 — w tej samej
--      sesji SQL Editora. Nie zamykaj okna miedzy C.1 a C.2/C.3, bo Supabase
--      zamknie sesje i zrobi auto-rollback (czyli "bezpiecznie cofnie").
--   3) W Supabase SQL Editor: uruchom kazdy blok jako oddzielne "Run". Najpierw
--      C.1 (zaznacz tylko ten blok i klik Run). Potem zaleznie od wyniku
--      zaznacz C.2 ALBO C.3 i kliknij Run.
-- ----------------------------------------------------------------------------


-- ── C.1 ── PREVIEW W TRANSAKCJI (uruchom jako pierwszy) ─────────────────────
-- Otwiera transakcje, wykonuje DELETE i pokazuje kontrolny SELECT.
-- NIE zawiera COMMIT — zmiany sa widoczne tylko dla tej sesji.

BEGIN;

DELETE FROM legacy_sends
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
);

DELETE FROM legacy_offers
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
);

-- Kontrolny SELECT — TO MUSI ZWROCIC SENSOWNE LICZBY zanim odpalisz C.2.
-- Oczekiwane:
--   ghost_sends_remaining_should_be_zero  = 0
--   ghost_offers_remaining_should_be_zero = 0
--   sends_total_after  > 0  (UNICA + Food Market Court powinny zostac)
--   offers_total_after > 0
SELECT
  (SELECT COUNT(*) FROM legacy_sends) AS sends_total_after,
  (SELECT COUNT(*) FROM legacy_sends
     WHERE supplier_legacy_id NOT IN (
       SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
     )) AS ghost_sends_remaining_should_be_zero,
  (SELECT COUNT(*) FROM legacy_offers) AS offers_total_after,
  (SELECT COUNT(*) FROM legacy_offers
     WHERE supplier_legacy_id NOT IN (
       SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
     )) AS ghost_offers_remaining_should_be_zero;

-- ── decyzja ──
-- WYNIK OK     → uruchom C.2 (COMMIT)
-- WYNIK NIE OK → uruchom C.3 (ROLLBACK)
-- (transakcja jest jeszcze otwarta — wybor jest po Twojej stronie)


-- ── C.2 ── COMMIT (uruchom OSOBNO, tylko jesli C.1 wyglada OK) ──────────────
-- Zatwierdza usuniecie. Po wykonaniu zmian nie da sie cofnac.

COMMIT;


-- ── C.3 ── ROLLBACK (uruchom OSOBNO, tylko jesli C.1 wyglada NIE OK) ────────
-- Cofa wszystkie DELETE-y z C.1. Baza wraca do stanu sprzed transakcji.
-- Bezpieczne — niczego nie traci, mozna potem zdebugowac i sprobowac jeszcze raz.

ROLLBACK;


-- ── PRZYPOMNIENIE ──────────────────────────────────────────────────────────
-- Po C.1 odpalasz dokladnie JEDEN z {C.2, C.3}. Nigdy obu. Po C.2 baza ma
-- ghosty usuniete na trwale. Po C.3 baza wraca do stanu wyjsciowego i mozesz
-- C.1 odpalic od nowa (np. po analizie wyniku albo po fixie kodu).


-- ============================================================================
-- SECTION D. WERYFIKACJA POST-CLEANUP — co zostalo w bazie
-- ============================================================================
-- Powinno pokazac wylacznie real_mapped i seed_mapped (dla sup-s5).
-- Zero wierszy z classification = 'ghost_unmapped'.

-- D.1 — ponowny audyt po cleanupie (powinien zwrocic 0 ghost_unmapped)
WITH send_stats AS (
  SELECT
    supplier_legacy_id,
    COUNT(*) AS records,
    COUNT(*) FILTER (WHERE legacy_id < 1000000000000000) AS seed_count,
    COUNT(*) FILTER (WHERE legacy_id >= 1000000000000000) AS round5_count
  FROM legacy_sends
  GROUP BY supplier_legacy_id
)
SELECT
  ss.supplier_legacy_id,
  c.name AS company_name,
  ss.records,
  ss.seed_count,
  ss.round5_count,
  CASE
    WHEN c.id IS NULL THEN 'ghost_unmapped'  -- DO NIE MOZE byc po cleanupie
    WHEN ss.round5_count > 0 THEN 'real_mapped'
    ELSE 'seed_mapped'
  END AS classification
FROM send_stats ss
LEFT JOIN companies c ON c.legacy_supplier_id = ss.supplier_legacy_id
ORDER BY classification, ss.supplier_legacy_id;


-- D.2 — sanity check: UNICA i Food Market Court nadal maja swoje rekordy
SELECT
  c.name,
  c.legacy_supplier_id,
  (SELECT COUNT(*) FROM legacy_sends WHERE supplier_legacy_id = c.legacy_supplier_id) AS sends,
  (SELECT COUNT(*) FROM legacy_offers WHERE supplier_legacy_id = c.legacy_supplier_id) AS offers
FROM companies c
WHERE c.legacy_supplier_id IS NOT NULL
ORDER BY c.name;


-- ============================================================================
-- SECTION E. (OPCJONALNE - NIE URUCHAMIAJ TERAZ) DELETE Wariant B
-- ============================================================================
-- ⚠ DOMYSLNIE WYLACZONE — caly blok jest zakomentowany. ⚠
--
-- Wariant B usuwa dodatkowo stary format seed (legacy_id < 1e15) takze dla
-- ZMAPOWANYCH supplierow. To dotyczy sup-s5 (Food Market Court) - jego
-- 5 seed sendow (id 6-10) i kilka ofert. UNICA's Round 5 rekordy (id >= 1e15)
-- zostaja nietkniete.
--
-- Decyzja o uruchomieniu Wariantu B jest na osobna runde. Na teraz: zostawic.
--
-- Jesli kiedys bedziesz chciec to uruchomic - usun znaki "/* " na poczatku
-- i "*/" na koncu bloku ponizej, sprawdz wynik weryfikacji, daj COMMIT.
-- ----------------------------------------------------------------------------

/*
BEGIN;

-- Powtorz Wariant A (idempotentne - jesli juz wykonany, nic nie usunie)
DELETE FROM legacy_sends
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
);
DELETE FROM legacy_offers
WHERE supplier_legacy_id NOT IN (
  SELECT legacy_supplier_id FROM companies WHERE legacy_supplier_id IS NOT NULL
);

-- Plus stary format seed dla zmapowanych
DELETE FROM legacy_sends WHERE legacy_id < 1000000000000000;
DELETE FROM legacy_offers WHERE legacy_id < 1000000000000000;

SELECT
  (SELECT COUNT(*) FROM legacy_sends) AS sends_remaining,
  (SELECT COUNT(*) FROM legacy_offers) AS offers_remaining,
  (SELECT COUNT(*) FROM legacy_sends WHERE legacy_id < 1000000000000000) AS sends_seed_remaining_should_be_zero,
  (SELECT COUNT(*) FROM legacy_offers WHERE legacy_id < 1000000000000000) AS offers_seed_remaining_should_be_zero;

COMMIT;
-- Jesli liczby nieoczekiwane: ROLLBACK;
*/


-- ============================================================================
-- KONIEC. Po wykonaniu Wariantu A:
--   1. Otworz admin panel -> Pipeline -> Moderacja
--      Powinno byc 0 propozycji (po wczesniejszych 3 ghost'ach Auchan/
--      Intermarche/Stokrotka)
--   2. Zaloguj sie jako Food Market Court / Artur Stasiak
--      Wysylki -> Kolejka powinno pokazac jego seed sendy (sup-s5, id 6-10),
--      bo tych nie ruszylismy w Wariancie A.
--   3. Zaloguj sie jako Unica / Artur Silvicola
--      Wysylki -> Wszystkie powinno pokazac 4 sendy do Biedronki (Round 5).
-- ============================================================================
