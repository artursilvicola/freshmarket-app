-- ============================================================================
-- 049_fm_payment_date.sql
-- [feat/fm-payment-tiebreaker] Data oplacenia udzialu w FM 2026 per firma.
--
-- Cel: tie-breaker algorytmu spotkan B2B ("kto wczesniej zaplacil, ten wyzej
-- w kolejce" — buildFMData FAZA 3 sortuje kandydatow: score DESC ->
-- paymentDate ASC -> pkgTier -> sortIdx). Do tej pory zadna realna firma nie
-- miala daty, wiec przy rownym scoringu decydowala kolejnosc wczytania.
--
-- Zrodlo danych: lista firm z datami platnosci od Artura (~16.09.2026),
-- importowana recznymi UPDATE'ami (patrz szablon na dole).
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor (migracje nie jada z gita).
-- Zaplanowane wdrozenie: ~16.09.2026, przed uruchomieniem algorytmu (17.09).
-- Kod frontu juz czyta te kolumne (fmSuppliers -> paymentDate); brak kolumny
-- = undefined = zachowanie dotychczasowe, wiec kolejnosc deploy/migracja
-- jest dowolna.
-- ============================================================================

alter table public.companies
  add column if not exists fm_payment_date date;

comment on column public.companies.fm_payment_date is
  'Data oplacenia udzialu w FM 2026 (tie-breaker algorytmu spotkan B2B). NULL = brak danych -> firma na koncu remisu.';

-- ── Szablon importu (16.09) ─────────────────────────────────────────────────
-- Dopasowanie po nazwie (ilike) — po imporcie sprawdzic liczbe zaktualizowanych
-- wierszy i wypisac firmy bez dopasowania.
--
-- update public.companies set fm_payment_date = '2026-07-15' where name ilike '%AMPLUS%';
-- update public.companies set fm_payment_date = '2026-08-02' where name ilike '%Den Berk%';
-- ...
--
-- Kontrola po imporcie:
-- select name, fm_payment_date from public.companies
--  where fm_b2b_enabled = true order by fm_payment_date nulls last, name;
