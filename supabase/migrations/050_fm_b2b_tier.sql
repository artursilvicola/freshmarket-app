-- ============================================================================
-- 050_fm_b2b_tier.sql
-- [feat/fm-b2b-tier] Poziom pakietu eventowego FM 2026 per firma.
--
-- Rekomendacja Codexa (review 1.09): nie wyliczac rangi spotkan z pkg_plan
-- (to pakiet KREDYTOW PreConnect) ani nie hardcodowac "Business" — osobna
-- kolumna business/premium, ustawiana przez admina w panelu Firmy.
--
-- Uzycie: buildFMData FAZA 3, tie-breaker pkgTier przy remisie score+data
-- platnosci — Premium (0) przed Business (1). Default 'business' = zachowanie
-- dotychczasowe dla wszystkich istniejacych firm.
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor (migracje nie jada z gita).
-- UWAGA: selektor poziomu w panelu Firmy zapisuje te kolumne — do czasu
-- aplikacji migracji zapis poziomu zwroci blad (reszta panelu bez zmian).
-- ============================================================================

alter table public.companies
  add column if not exists fm_b2b_tier text not null default 'business'
  check (fm_b2b_tier in ('business', 'premium'));

comment on column public.companies.fm_b2b_tier is
  'Poziom pakietu eventowego FM 2026 (business/premium). Premium ma pierwszenstwo w tie-breakerze algorytmu spotkan B2B. Niezalezne od pkg_plan (kredyty PreConnect).';

-- Kontrola:
-- select name, fm_b2b_tier, fm_b2b_packages from public.companies
--  where fm_b2b_enabled = true order by fm_b2b_tier desc, name;
