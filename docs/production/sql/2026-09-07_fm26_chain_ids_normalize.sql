-- ============================================================================
-- Ujednolicenie identyfikatorow sieci FM 2026 (retailers.fm26_chain_id) do konwencji chN
-- (jak Auchan=ch2, Carrefour=ch9, Dobronom=ch37, Fantastico=ch38 z 7.09).
--
-- Identyfikator to klucz wewnetrzny uzywany w: company_target_retailers.note ('chain:<id>' —
-- aplikacja czyta chain z note PRZED retailers!), fm_resps.meta.chain_id, fm_wishlists.data.chain_id,
-- fm_late_resps.data.chain_id, fm_settings.schedule (plan — dzis pusty). Dlatego wszystkie
-- odwolania zmieniamy w JEDNEJ transakcji. Idempotentne (WHERE stare = ...).
-- Stan 7.09.2026 (eksport): fm_resps tylko Rohlik (ch31 — bez zmian); note: 100:9, 113:5, 114:15,
-- Topazfn1:4, FM2026yjhuyhg:5, fm26yhghgy:14, FM26(ljbgik):9, o1:12, fm26buyersTM:4, FracFM26:3.
-- Uruchomic PRZED algorytmem 17.09.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE chain_map (retailer_id int PRIMARY KEY, old_id text NOT NULL, new_id text NOT NULL) ON COMMIT DROP;
INSERT INTO chain_map VALUES
  (100, '100',            'ch39'),   -- Biedronka
  (113, '113',            'ch40'),   -- Polomarket
  (114, '114',            'ch41'),   -- Albert CZ/Bakker
  (121, 'Topazfn1',       'ch42'),   -- TOPAZ
  (123, 'FM2026yjhuyhg',  'ch43'),   -- Arhelan
  (125, 'fm26yhghgy',     'ch44'),   -- PROMO Cash and Carry
  (127, 'FM26(ljbgik)',   'ch45'),   -- Fozzy Group
  (136, 'o1',             'ch46'),   -- AIBĖ
  (139, 'fm26buyersTM',   'ch47'),   -- Twój Market
  (142, 'FracFM26',       'ch48');   -- FRAC

-- bezpiecznik: nowe id nie moga byc juz zajete
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.retailers r JOIN chain_map m ON r.fm26_chain_id = m.new_id AND r.id <> m.retailer_id) THEN
    RAISE EXCEPTION 'nowe id juz uzywane przez inna siec';
  END IF;
END $$;

UPDATE public.retailers r SET fm26_chain_id = m.new_id
  FROM chain_map m WHERE r.id = m.retailer_id AND r.fm26_chain_id = m.old_id;

UPDATE public.company_target_retailers t SET note = 'chain:' || m.new_id
  FROM chain_map m WHERE t.retailer_id = m.retailer_id AND t.note = 'chain:' || m.old_id;

UPDATE public.fm_resps f SET meta = jsonb_set(coalesce(f.meta, '{}'::jsonb), '{chain_id}', to_jsonb(m.new_id))
  FROM chain_map m WHERE f.retailer_id = m.retailer_id AND f.meta->>'chain_id' = m.old_id;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM chain_map LOOP
    IF to_regclass('public.fm_wishlists') IS NOT NULL THEN
      UPDATE public.fm_wishlists SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{chain_id}', to_jsonb(r.new_id))
        WHERE retailer_id = r.retailer_id AND data->>'chain_id' = r.old_id;
    END IF;
    IF to_regclass('public.fm_late_resps') IS NOT NULL THEN
      UPDATE public.fm_late_resps SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{chain_id}', to_jsonb(r.new_id))
        WHERE retailer_id = r.retailer_id AND data->>'chain_id' = r.old_id;
    END IF;
  END LOOP;
END $$;

-- KONTROLA 1: kazda siec FM ma id w konwencji chN
SELECT id, name, fm26_chain_id FROM public.retailers WHERE fm26_active ORDER BY id;
-- KONTROLA 2: zadna notatka wyboru nie wskazuje na stare id (oczekiwane 0 wierszy)
SELECT t.retailer_id, t.note, count(*) FROM public.company_target_retailers t JOIN chain_map m ON m.retailer_id = t.retailer_id
 WHERE t.note = 'chain:' || m.old_id GROUP BY 1, 2;

COMMIT;
