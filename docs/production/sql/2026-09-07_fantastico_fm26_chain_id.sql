-- ============================================================================
-- Fantastico (retailers.id = 129): poprawka identyfikatora sieci FM 2026
--   'FM26(,kjhgf;hf)'  ->  'ch38'   (konwencja jak Auchan=ch2, Carrefour=ch9, Dobronom=ch37)
--
-- Identyfikator jest kluczem wewnetrznym uzywanym w: fm_settings.schedule (plan),
-- fm_resps.meta.chain_id (odpowiedzi kupca), fm_wishlists / fm_late_resps (data.chain_id),
-- company_target_retailers.note ('chain:<id>' — aplikacja czyta chain z note PRZED retailers,
-- wiec note MUSI byc zmienione razem z retailers, inaczej 13 wyborow dostawcow "zniknie").
-- Stan 7.09.2026 (eksport): retailers 1 wiersz, company_target_retailers.note 13 wierszy,
-- fm_resps 0, plan niepublikowany. Uruchomic PRZED algorytmem 17.09 i przed odpowiedziami
-- kupca Fantastico. Jedna transakcja; kontrola na koncu.
-- ============================================================================
BEGIN;

UPDATE public.retailers SET fm26_chain_id = 'ch38'
 WHERE id = 129 AND fm26_chain_id = 'FM26(,kjhgf;hf)';

UPDATE public.fm_resps SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{chain_id}', '"ch38"'::jsonb)
 WHERE meta->>'chain_id' = 'FM26(,kjhgf;hf)';

UPDATE public.company_target_retailers SET note = 'chain:ch38'
 WHERE retailer_id = 129 AND note LIKE 'chain:FM26(,kjhgf;hf%';

DO $$ BEGIN
  IF to_regclass('public.fm_wishlists') IS NOT NULL THEN
    UPDATE public.fm_wishlists SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{chain_id}', '"ch38"'::jsonb) WHERE data->>'chain_id' = 'FM26(,kjhgf;hf)';
  END IF;
  IF to_regclass('public.fm_late_resps') IS NOT NULL THEN
    UPDATE public.fm_late_resps SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{chain_id}', '"ch38"'::jsonb) WHERE data->>'chain_id' = 'FM26(,kjhgf;hf)';
  END IF;
END $$;

COMMIT;

-- KONTROLA (oczekiwane: retailers 'ch38'; note: 13 wierszy 'chain:ch38', 0 starych):
SELECT id, name, fm26_chain_id, fm26_active FROM public.retailers WHERE id = 129;
SELECT note, count(*) FROM public.company_target_retailers WHERE retailer_id = 129 GROUP BY note;
