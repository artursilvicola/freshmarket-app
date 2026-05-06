-- ===================================================================
-- 011 — Marker / parity: legacy_offers + legacy_sends supplier RLS final.
-- [B2B Round 2.4]
--
-- Cel: zapewnic ze stan w repo ZAWSZE odpowiada stanowi w Supabase.
--
-- W produkcji 6 maja 2026 wgrano recznie zestaw DROP+CREATE ze strict
-- mapowaniem supplier_legacy_id = app_supplier_legacy_id() (z chatu Round 2.3).
-- 010_legacy_rls_strict.sql ma DOKLADNIE ten sam content. Ten plik (011)
-- jest re-run identycznej tresci, idempotentny, jako "marker" zeby ktokolwiek
-- klonujacy repo i odpalajacy migracje od zera otrzymal taki sam stan.
--
-- ZADNA NOWA POLITYKA. Tylko re-apply 010 strict ruleset.
-- ===================================================================

begin;

-- LEGACY_OFFERS
drop policy if exists "legacy_offers_admin_all"              on legacy_offers;
drop policy if exists "legacy_offers_admin_read"             on legacy_offers;
drop policy if exists "legacy_offers_admin_write"            on legacy_offers;
drop policy if exists "legacy_offers_authenticated_read"     on legacy_offers;
drop policy if exists "legacy_offers_buyer_read"             on legacy_offers;
drop policy if exists "legacy_offers_modify_authenticated"   on legacy_offers;
drop policy if exists "legacy_offers_read_authenticated"     on legacy_offers;
drop policy if exists "legacy_offers_read_role_based"        on legacy_offers;
drop policy if exists "legacy_offers_supplier_all"           on legacy_offers;
drop policy if exists "legacy_offers_supplier_own_read"      on legacy_offers;
drop policy if exists "legacy_offers_supplier_own_write"     on legacy_offers;
drop policy if exists "legacy_offers_supplier_read"          on legacy_offers;
drop policy if exists "legacy_offers_supplier_write"         on legacy_offers;
drop policy if exists "legacy_offers_select"                 on legacy_offers;
drop policy if exists "legacy_offers_write_admin"            on legacy_offers;
drop policy if exists "legacy_offers_write_supplier_own"     on legacy_offers;

create policy "legacy_offers_select" on legacy_offers
  for select using (
    is_admin()
    or (app_role() = 'supplier' and supplier_legacy_id = app_supplier_legacy_id())
    or (
      app_role() = 'buyer'
      and exists (
        select 1 from legacy_sends s
        where s.offer_legacy_id = legacy_offers.legacy_id
          and s.retailer_id = app_retailer_id()
          and s.status in ('sent','opened','read','read_manual','unread_expired','refunded')
          and coalesce(s.data->>'status', s.status) in ('sent','opened','read','read_manual','unread_expired','refunded')
      )
    )
  );

create policy "legacy_offers_write_admin" on legacy_offers
  for all using (is_admin()) with check (is_admin());

create policy "legacy_offers_write_supplier_own" on legacy_offers
  for all
  using (app_role() = 'supplier' and supplier_legacy_id = app_supplier_legacy_id())
  with check (app_role() = 'supplier' and supplier_legacy_id = app_supplier_legacy_id());

-- LEGACY_SENDS
drop policy if exists "legacy_sends_admin_all"                       on legacy_sends;
drop policy if exists "legacy_sends_admin_read"                      on legacy_sends;
drop policy if exists "legacy_sends_admin_write"                     on legacy_sends;
drop policy if exists "legacy_sends_authenticated_read"              on legacy_sends;
drop policy if exists "legacy_sends_buyer_read"                      on legacy_sends;
drop policy if exists "legacy_sends_buyer_update_read_receipt"       on legacy_sends;
drop policy if exists "legacy_sends_modify_authenticated"            on legacy_sends;
drop policy if exists "legacy_sends_read_authenticated"              on legacy_sends;
drop policy if exists "legacy_sends_read_role_based"                 on legacy_sends;
drop policy if exists "legacy_sends_supplier_all"                    on legacy_sends;
drop policy if exists "legacy_sends_supplier_own_read"               on legacy_sends;
drop policy if exists "legacy_sends_supplier_own_write"              on legacy_sends;
drop policy if exists "legacy_sends_insert_supplier_or_admin"        on legacy_sends;
drop policy if exists "legacy_sends_update_supplier_pre_moderation"  on legacy_sends;
drop policy if exists "legacy_sends_supplier_read"                   on legacy_sends;
drop policy if exists "legacy_sends_supplier_write"                  on legacy_sends;
drop policy if exists "legacy_sends_select"                          on legacy_sends;
drop policy if exists "legacy_sends_insert_admin"                    on legacy_sends;
drop policy if exists "legacy_sends_insert_supplier_own"             on legacy_sends;
drop policy if exists "legacy_sends_update_admin"                    on legacy_sends;
drop policy if exists "legacy_sends_update_supplier_own"             on legacy_sends;
drop policy if exists "legacy_sends_delete_admin"                    on legacy_sends;

create policy "legacy_sends_select" on legacy_sends
  for select using (
    is_admin()
    or (app_role() = 'supplier' and supplier_legacy_id = app_supplier_legacy_id())
    or (
      app_role() = 'buyer'
      and retailer_id = app_retailer_id()
      and status in ('sent','opened','read','read_manual','unread_expired','refunded')
      and coalesce(data->>'status', status) in ('sent','opened','read','read_manual','unread_expired','refunded')
    )
  );

create policy "legacy_sends_insert_admin" on legacy_sends
  for insert with check (is_admin());

create policy "legacy_sends_insert_supplier_own" on legacy_sends
  for insert with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued','pending_moderation')
    and coalesce(data->>'status', status) in ('queued','pending_moderation')
  );

create policy "legacy_sends_update_admin" on legacy_sends
  for update using (is_admin()) with check (is_admin());

create policy "legacy_sends_update_supplier_own" on legacy_sends
  for update
  using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued','pending_moderation')
    and coalesce(data->>'status', status) in ('queued','pending_moderation')
  )
  with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued','pending_moderation')
    and coalesce(data->>'status', status) in ('queued','pending_moderation')
  );

create policy "legacy_sends_delete_admin" on legacy_sends
  for delete using (is_admin());

commit;
