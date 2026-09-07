-- ===================================================================
-- 010 — Strict RLS replace dla legacy_offers i legacy_sends
-- [B2B Round 2.3]
--
-- RLS w Postgres dziala JAK OR pomiedzy permissive politykami.
-- 005 i 009 zostawily szerokie polityki ('app_role() = supplier' bez
-- supplier_legacy_id check), wiec supplier widzial wszystko niezaleznie
-- od strict polityk z 009.
--
-- Migracja 010:
--   1. Drop WSZYSTKIE istniejace polityki na legacy_offers / legacy_sends.
--   2. Stworz od zera czysty zestaw 5 polityk:
--      - legacy_offers SELECT (admin / supplier-own / buyer-status)
--      - legacy_offers WRITE  (admin / supplier-own)
--      - legacy_sends  SELECT (admin / supplier-own / buyer-status)
--      - legacy_sends  INSERT (admin / supplier-own pre-moderation)
--      - legacy_sends  UPDATE (admin / supplier-own pre-moderation)
--
-- Helper app_supplier_legacy_id() istnieje od 009.
-- ===================================================================

begin;

-- ============================================================
-- LEGACY_OFFERS — drop every existing policy
-- ============================================================
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
drop policy if exists "legacy_offers_insert"                 on legacy_offers;
drop policy if exists "legacy_offers_update"                 on legacy_offers;
drop policy if exists "legacy_offers_delete"                 on legacy_offers;

-- ============================================================
-- LEGACY_OFFERS — clean strict set
-- ============================================================
-- 1) SELECT
create policy "legacy_offers_select" on legacy_offers
  for select using (
    is_admin()
    or (
      app_role() = 'supplier'
      and supplier_legacy_id = app_supplier_legacy_id()
    )
    or (
      app_role() = 'buyer'
      and exists (
        select 1
        from legacy_sends s
        where s.offer_legacy_id = legacy_offers.legacy_id
          and s.retailer_id = app_retailer_id()
          and s.status in (
            'sent', 'opened', 'read', 'read_manual',
            'unread_expired', 'refunded'
          )
          and coalesce(s.data->>'status', s.status) in (
            'sent', 'opened', 'read', 'read_manual',
            'unread_expired', 'refunded'
          )
      )
    )
  );

-- 2) WRITE (insert/update/delete) — admin all + supplier own
create policy "legacy_offers_write_admin" on legacy_offers
  for all
  using (is_admin())
  with check (is_admin());

create policy "legacy_offers_write_supplier_own" on legacy_offers
  for all
  using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  )
  with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  );

-- ============================================================
-- LEGACY_SENDS — drop every existing policy
-- ============================================================
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
drop policy if exists "legacy_sends_insert"                          on legacy_sends;
-- [feat/fm-queue] idempotencja przy instalacji od pustej bazy: 005 tworzy te dwie
-- polityki pod tymi samymi nazwami (na prod 011 i tak je nadpisalo).
drop policy if exists "legacy_sends_update_admin"                    on legacy_sends;
drop policy if exists "legacy_sends_delete_admin"                    on legacy_sends;
drop policy if exists "legacy_sends_update"                          on legacy_sends;
drop policy if exists "legacy_sends_delete"                          on legacy_sends;

-- ============================================================
-- LEGACY_SENDS — clean strict set
-- ============================================================
-- 1) SELECT
create policy "legacy_sends_select" on legacy_sends
  for select using (
    is_admin()
    or (
      app_role() = 'supplier'
      and supplier_legacy_id = app_supplier_legacy_id()
    )
    or (
      app_role() = 'buyer'
      and retailer_id = app_retailer_id()
      and status in (
        'sent', 'opened', 'read', 'read_manual',
        'unread_expired', 'refunded'
      )
      and coalesce(data->>'status', status) in (
        'sent', 'opened', 'read', 'read_manual',
        'unread_expired', 'refunded'
      )
    )
  );

-- 2) INSERT — admin all + supplier own pre-moderation
create policy "legacy_sends_insert_admin" on legacy_sends
  for insert
  with check (is_admin());

create policy "legacy_sends_insert_supplier_own" on legacy_sends
  for insert
  with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued', 'pending_moderation')
    and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
  );

-- 3) UPDATE — admin all + supplier own pre-moderation
create policy "legacy_sends_update_admin" on legacy_sends
  for update
  using (is_admin())
  with check (is_admin());

create policy "legacy_sends_update_supplier_own" on legacy_sends
  for update
  using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued', 'pending_moderation')
    and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
  )
  with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
    and status in ('queued', 'pending_moderation')
    and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
  );

-- 4) DELETE — admin only (supplier nie usuwa wysylek po wyslaniu)
create policy "legacy_sends_delete_admin" on legacy_sends
  for delete
  using (is_admin());

-- ============================================================
-- Walidacja po wgraniu (opcjonalnie):
-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('legacy_offers','legacy_sends')
--   ORDER BY tablename, policyname;
--
-- Oczekiwane:
--   legacy_offers: legacy_offers_select, legacy_offers_write_admin, legacy_offers_write_supplier_own
--   legacy_sends:  legacy_sends_select,
--                  legacy_sends_insert_admin, legacy_sends_insert_supplier_own,
--                  legacy_sends_update_admin, legacy_sends_update_supplier_own,
--                  legacy_sends_delete_admin
-- (ZADNA polityka nie powinna miec qual zawierajacego "app_role() = 'supplier'"
--  bez "supplier_legacy_id = app_supplier_legacy_id()")
-- ============================================================

commit;
