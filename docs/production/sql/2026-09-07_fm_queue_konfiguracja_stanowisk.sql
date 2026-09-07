-- ============================================================================
-- Konfiguracja stanowisk dnia eventu FM 2026 (24.09.2026) - krok 12 wdrozenia kolejek (7.09.2026)
-- Odpowiednik przycisku Admin -> Spotkania B2B -> Dzien wydarzenia -> Stanowiska -> "Utworz grupy"
-- (te same tabele i wartosci domyslne co UI: 60 spotkan/stanowisko, stanowiska ZAMKNIETE, bez logu).
-- Zasady od Artura: Dino = split Owoce / Kwiaty (2 grupy x 1 stanowisko), Auchan = 1 grupa x 2 stanowiska
-- (wspolna kolejka i numeracja), pozostale sieci FM = 1 grupa x 1 stanowisko.
-- GATE: przepisany z retailers.fm_gate (dzis NULL dla wszystkich) - decyzja Artura, potem:
--   UPDATE public.fm_queue_groups SET gate = 1 WHERE event_date = '2026-09-24' AND retailer_id IN (...);
-- Idempotentne (ON CONFLICT DO NOTHING). NIE otwiera dnia i NIE importuje planu.
-- ============================================================================
BEGIN;

-- 1) jedna grupa (bez etykiety = catch-all) dla kazdej aktywnej sieci FM poza Dino
INSERT INTO public.fm_queue_groups (event_date, retailer_id, label, categories, gate, meetings_per_station)
SELECT DATE '2026-09-24', r.id, NULL, '{}', r.fm_gate, 60
  FROM public.retailers r
 WHERE r.fm26_active AND r.id <> 107
ON CONFLICT (event_date, retailer_id, COALESCE(label, '')) DO NOTHING;

-- 2) Dino Polska (107): split Owoce (catch-all) + Kwiaty (kategoria firmy 'kwiaty')
INSERT INTO public.fm_queue_groups (event_date, retailer_id, label, categories, gate, meetings_per_station) VALUES
  (DATE '2026-09-24', 107, 'Owoce',  '{}',       (SELECT fm_gate FROM public.retailers WHERE id = 107), 60),
  (DATE '2026-09-24', 107, 'Kwiaty', '{kwiaty}', (SELECT fm_gate FROM public.retailers WHERE id = 107), 60)
ON CONFLICT (event_date, retailer_id, COALESCE(label, '')) DO NOTHING;

-- 3) stanowisko #1 dla kazdej grupy; Auchan Polska (104) dodatkowo #2 (rownolegle)
INSERT INTO public.fm_stations (queue_group_id, idx)
SELECT g.id, 1 FROM public.fm_queue_groups g WHERE g.event_date = DATE '2026-09-24'
ON CONFLICT (queue_group_id, idx) DO NOTHING;
INSERT INTO public.fm_stations (queue_group_id, idx)
SELECT g.id, 2 FROM public.fm_queue_groups g WHERE g.event_date = DATE '2026-09-24' AND g.retailer_id = 104 AND g.label IS NULL
ON CONFLICT (queue_group_id, idx) DO NOTHING;

-- KONTROLA (oczekiwane: 23 grupy, 24 stanowiska, wszystkie 'closed')
SELECT r.name, g.label, g.gate, g.categories, g.meetings_per_station,
       count(s.id) AS stanowiska, string_agg(s.mode, ',') AS tryby
  FROM public.fm_queue_groups g JOIN public.retailers r ON r.id = g.retailer_id
  LEFT JOIN public.fm_stations s ON s.queue_group_id = g.id
 WHERE g.event_date = DATE '2026-09-24'
 GROUP BY r.name, g.label, g.gate, g.categories, g.meetings_per_station
 ORDER BY r.name, g.label NULLS FIRST;

COMMIT;
