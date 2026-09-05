-- ============================================================================
-- 051_fm_plan_export.sql
-- [feat/fm-plan-export] Karty spotkan B2B FM 2026 — dwie male kolumny:
--
--  1) retailers.fm_gate (1/2) — wejscie do strefy spotkan, przy ktorym stoi
--     logo sieci. Drukowane w kolumnie "Wejscie/Gate" na kartach dostawcow.
--     Bez wartosci generator drukuje "GATE ?" — admin ustawia w panelu Sieci.
--  2) companies.fm_plan_sent_at / retailers.fm_plan_sent_at — kiedy karta
--     zostala wyslana mailem z panelu admina (funkcja fm-plan-send).
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor (migracje nie jada z gita).
-- Front i funkcje czytaja/pisza te kolumny defensywnie — kolejnosc
-- deploy/migracja dowolna; do czasu migracji: "GATE ?" i brak znacznika wysylki.
-- ============================================================================

alter table public.retailers
  add column if not exists fm_gate smallint
  check (fm_gate is null or fm_gate in (1, 2)),
  add column if not exists fm_plan_sent_at timestamptz;

alter table public.companies
  add column if not exists fm_plan_sent_at timestamptz;

comment on column public.retailers.fm_gate is
  'FM 2026: wejscie do strefy spotkan z logo sieci (1 = GATE 1, 2 = GATE 2). NULL = nie ustawione.';
comment on column public.retailers.fm_plan_sent_at is
  'FM 2026: kiedy karta "Kolejka spotkan" poszla mailem do kupcow sieci (fm-plan-send).';
comment on column public.companies.fm_plan_sent_at is
  'FM 2026: kiedy karta "Plan spotkan B2B" poszla mailem do kont firmy (fm-plan-send).';

-- Kontrola:
-- select name, fm_gate, fm_plan_sent_at from public.retailers where fm26_active order by name;
-- select name, fm_plan_sent_at from public.companies where fm_b2b_enabled order by name;
