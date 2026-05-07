-- ============================================================================
-- 015 — companies.fm_selection_confirmed_at (per-supplier FM 2026 confirmation)
-- [B2B Round supplier-FM-UX]
--
-- Cel:
--   Dostawca po wyborze 5 glownych sieci klika "Potwierdz wybor" w panelu
--   PageSupplierFM (subPage fm-sched). Klik zapisuje timestamp w
--   companies.fm_selection_confirmed_at. Admin w "Dane wejsciowe" widzi
--   ktorzy dostawcy zaznaczyli sieci a ktorzy ostatecznie zatwierdzili.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS.
-- ============================================================================

begin;

alter table public.companies
  add column if not exists fm_selection_confirmed_at timestamptz;

comment on column companies.fm_selection_confirmed_at is
  '[Round supplier-FM-UX] Timestamp gdy dostawca klinkal "Potwierdz wybor" '
  'na ekranie wyboru sieci FM 2026 (PageSupplierFM fm-sched). NULL = '
  'tylko zaznaczyl sieci, nie potwierdzil ostatecznie. Zmiana wyboru po '
  'potwierdzeniu nie kasuje pola — admin widzi ze byl moment "Dziekujemy", '
  'ale moze tez zauwazyc rozbieznosc gdy supplier zmodyfikowal wybor potem.';

-- Index na potrzeby admin "Dane wejsciowe" filtra/listy
create index if not exists idx_companies_fm_confirmed
  on companies(fm_selection_confirmed_at)
  where fm_selection_confirmed_at is not null;

commit;
