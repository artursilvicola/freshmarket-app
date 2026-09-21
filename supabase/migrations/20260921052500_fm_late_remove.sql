-- Late requests for manual corrections: buyers may also send "Nie chcę" (remove), next to want/chance.
-- Same gates as 20260920171936 (fm_late_selection_allowed: own retailer, access opened by admin,
-- algo_phase matching/algorithm/corrections, active FM retailer; company active and FM-enabled).
-- Never algorithm inputs; no change to fm_resps, company_target_retailers, fm_decision_sources or the plan.
-- Idempotent. Rollback: re-create both policies with zone in ('want','chance') as in 20260920171936.
begin;

drop policy if exists fmlr_buyer_insert on public.fm_late_resps;
create policy fmlr_buyer_insert on public.fm_late_resps for insert to authenticated
  with check (public.fm_late_selection_allowed(retailer_id)
    and zone in ('want','chance','remove')
    and exists (select 1 from public.companies c
      where (c.id::text = supplier_legacy_id or c.legacy_fm_id = supplier_legacy_id)
        and c.fm_b2b_enabled and c.account_status = 'active'));

drop policy if exists fmlr_buyer_update on public.fm_late_resps;
create policy fmlr_buyer_update on public.fm_late_resps for update to authenticated
  using (public.fm_late_selection_allowed(retailer_id))
  with check (public.fm_late_selection_allowed(retailer_id)
    and zone in ('want','chance','remove')
    and exists (select 1 from public.companies c
      where (c.id::text = supplier_legacy_id or c.legacy_fm_id = supplier_legacy_id)
        and c.fm_b2b_enabled and c.account_status = 'active'));

comment on table public.fm_late_resps is 'Buyer late requests (want/chance/remove) for admin manual review only. Never algorithm inputs.';
commit;
