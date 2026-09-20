-- Separate late requests; never write fm_resps, company_target_retailers or the plan.
-- Apply manually after review. No existing preferences, requests or schedules are changed.
-- Rollback fail-closed: publish previous frontend, set all access.enabled=false,
-- leave this table and the stricter RLS in place. No need to rebuild the meeting plan.
begin;

create table if not exists public.fm_late_selection_access (
  retailer_id integer primary key references public.retailers(id) on delete cascade,
  enabled boolean not null default false
);
alter table public.fm_late_selection_access enable row level security;
revoke all on public.fm_late_selection_access from anon, public;
grant select, insert, update, delete on public.fm_late_selection_access to authenticated;
grant all on public.fm_late_selection_access to service_role;

drop policy if exists fmla_admin_all on public.fm_late_selection_access;
create policy fmla_admin_all on public.fm_late_selection_access
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists fmla_buyer_read on public.fm_late_selection_access;
create policy fmla_buyer_read on public.fm_late_selection_access
  for select to authenticated using (
    (select public.app_role()) = 'buyer' and retailer_id = (select public.app_retailer_id())
  );

-- Invoker: respects RLS on settings, access and retailers; exposes no privileged data.
create or replace function public.fm_late_selection_allowed(p_retailer_id integer)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null
    and public.app_role() = 'buyer'
    and p_retailer_id = public.app_retailer_id()
    and coalesce((select s.algo_phase in ('matching','algorithm','corrections')
        from public.fm_settings s order by s.updated_at desc nulls last limit 1), false)
    and exists (select 1 from public.fm_late_selection_access a
        join public.retailers r on r.id = a.retailer_id
        where a.retailer_id = p_retailer_id and a.enabled and r.active and r.fm26_active);
$$;
revoke all on function public.fm_late_selection_allowed(integer) from public, anon;
grant execute on function public.fm_late_selection_allowed(integer) to authenticated, service_role;

alter table public.fm_late_resps enable row level security;
revoke all on public.fm_late_resps from anon, public;
grant select, insert, update, delete on public.fm_late_resps to authenticated;
grant all on public.fm_late_resps to service_role;
drop policy if exists fmlr_admin_all on public.fm_late_resps;
drop policy if exists fmlr_buyer_own on public.fm_late_resps;
drop policy if exists fmlr_buyer_read on public.fm_late_resps;
drop policy if exists fmlr_buyer_insert on public.fm_late_resps;
drop policy if exists fmlr_buyer_update on public.fm_late_resps;
drop policy if exists fmlr_buyer_delete on public.fm_late_resps;
create policy fmlr_admin_all on public.fm_late_resps for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Read history after closing access; buyers never see another chain's requests.
create policy fmlr_buyer_read on public.fm_late_resps for select to authenticated
  using ((select public.app_role()) = 'buyer' and retailer_id = (select public.app_retailer_id()));
create policy fmlr_buyer_insert on public.fm_late_resps for insert to authenticated
  with check (public.fm_late_selection_allowed(retailer_id)
    and zone in ('want','chance')
    and exists (select 1 from public.companies c
      where (c.id::text = supplier_legacy_id or c.legacy_fm_id = supplier_legacy_id)
        and c.fm_b2b_enabled and c.account_status = 'active'));
create policy fmlr_buyer_update on public.fm_late_resps for update to authenticated
  using (public.fm_late_selection_allowed(retailer_id))
  with check (public.fm_late_selection_allowed(retailer_id)
    and zone in ('want','chance')
    and exists (select 1 from public.companies c
      where (c.id::text = supplier_legacy_id or c.legacy_fm_id = supplier_legacy_id)
        and c.fm_b2b_enabled and c.account_status = 'active'));
create policy fmlr_buyer_delete on public.fm_late_resps for delete to authenticated
  using (public.fm_late_selection_allowed(retailer_id));

comment on table public.fm_late_selection_access is 'Admin opens late requests per retailer. Independent of algorithm inputs and meeting plan.';
comment on table public.fm_late_resps is 'Buyer late requests for admin manual review only. Never algorithm inputs.';
notify pgrst, 'reload schema';
commit;
