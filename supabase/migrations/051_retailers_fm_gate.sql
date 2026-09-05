-- ============================================================================
-- 051_retailers_fm_gate.sql
-- [feat/fm-plan-export] Wejscie do strefy spotkan (GATE 1 / GATE 2) per siec.
--
-- Na evencie strefa spotkan ma dwa oznaczone wejscia; przy kazdym logotypy
-- sieci obslugiwanych przez dana bramke. Karta dostawcy (PDF/mail) pokazuje
-- w kolumnie "Wejscie" GATE 1 lub GATE 2 dla kazdej sieci. Bez tej kolumny
-- generator drukuje "GATE ?" — admin ustawia gate w panelu Sieci.
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor (migracje nie jada z gita).
-- Kolejnosc deploy/migracja dowolna: front i generator czytaja kolumne
-- defensywnie (brak = null = "GATE ?").
-- ============================================================================

alter table public.retailers
  add column if not exists fm_gate smallint
  check (fm_gate is null or fm_gate in (1, 2));

comment on column public.retailers.fm_gate is
  'FM 2026: wejscie do strefy spotkan, przy ktorym stoi logo sieci (1 = GATE 1, 2 = GATE 2). NULL = nie ustawione.';

-- Kontrola / szybkie ustawienie:
-- select id, name, fm_gate from public.retailers where fm26_active order by name;
-- update public.retailers set fm_gate = 1 where name in ('Biedronka','Auchan Polska');
