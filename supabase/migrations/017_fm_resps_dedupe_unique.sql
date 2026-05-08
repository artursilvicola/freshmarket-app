-- ===================================================================
-- 017 - fm_resps dedupe + unique buyer/supplier pair
-- [B2B Round FM-final-cleanup]
--
-- Why:
--   fm_resps should represent one durable buyer decision for one pair:
--   retailer_id + supplier_company_id. Earlier rounds could create duplicate
--   rows, which made maybeSingle()/single() unstable and surfaced as
--   PGRST116/406 noise during fallback saves.
-- ===================================================================

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by retailer_id, supplier_company_id
      order by created_at desc nulls last, id desc
    ) as rn
  from public.fm_resps
)
delete from public.fm_resps f
using ranked r
where f.id = r.id
  and r.rn > 1;

drop index if exists idx_fm_resps_retailer_supplier_unique;
create unique index idx_fm_resps_retailer_supplier_unique
  on public.fm_resps(retailer_id, supplier_company_id);

commit;
