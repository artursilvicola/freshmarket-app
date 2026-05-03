-- ===================================================================
-- 005 — RLS fix: kupiec NIE zobaczy wysylki ani oferty zanim admin
--       jej nie zatwierdzi i wysle (status 'sent' lub dalej).
--
-- Poprawki bezpieczenstwa:
--   1. Brak buyer UPDATE na legacy_sends (read receipt potem przez RPC)
--   2. Podwojny check statusu (kolumna AND data->>'status') zeby nie dalo
--      sie obejsc przez rozjazd kolumna <-> JSON
--
-- Dropuje wszystkie poprzednie polityki dla legacy_offers i legacy_sends,
-- ustawia stan zgodny z business flow PreConnect.
-- ===================================================================

begin;

-- ============== LEGACY_OFFERS ==============
drop policy if exists "legacy_offers_read_authenticated" on legacy_offers;
drop policy if exists "legacy_offers_modify_authenticated" on legacy_offers;
drop policy if exists "legacy_offers_admin_all" on legacy_offers;
drop policy if exists "legacy_offers_supplier_all" on legacy_offers;
drop policy if exists "legacy_offers_buyer_read" on legacy_offers;
drop policy if exists "legacy_offers_read_role_based" on legacy_offers;
drop policy if exists "legacy_offers_admin_write" on legacy_offers;
drop policy if exists "legacy_offers_supplier_write" on legacy_offers;

-- SELECT: admin OR supplier OR (buyer + ma wysylke w status sent+ - check podwojny)
create policy "legacy_offers_read_role_based" on legacy_offers
  for select
  using (
    is_admin()
    or app_role() = 'supplier'
    or (
      app_role() = 'buyer'
      and exists (
        select 1
        from legacy_sends s
        where s.offer_legacy_id = legacy_offers.legacy_id
          and s.retailer_id = app_retailer_id()
          and s.status in (
            'sent', 'opened', 'read', 'read_manual', 'unread_expired', 'refunded'
          )
          and coalesce(s.data->>'status', s.status) in (
            'sent', 'opened', 'read', 'read_manual', 'unread_expired', 'refunded'
          )
      )
    )
  );

-- WRITE: admin (pelny dostep)
create policy "legacy_offers_admin_write" on legacy_offers
  for all
  using (is_admin())
  with check (is_admin());

-- WRITE: supplier (kazdy supplier moze tworzyc/edytowac swoje oferty)
create policy "legacy_offers_supplier_write" on legacy_offers
  for all
  using (app_role() = 'supplier')
  with check (app_role() = 'supplier');


-- ============== LEGACY_SENDS ==============
drop policy if exists "legacy_sends_read_authenticated" on legacy_sends;
drop policy if exists "legacy_sends_modify_authenticated" on legacy_sends;
drop policy if exists "legacy_sends_admin_all" on legacy_sends;
drop policy if exists "legacy_sends_supplier_all" on legacy_sends;
drop policy if exists "legacy_sends_buyer_read" on legacy_sends;
drop policy if exists "legacy_sends_buyer_update" on legacy_sends;
drop policy if exists "legacy_sends_read_role_based" on legacy_sends;
drop policy if exists "legacy_sends_insert_supplier_or_admin" on legacy_sends;
drop policy if exists "legacy_sends_update_admin" on legacy_sends;
drop policy if exists "legacy_sends_update_supplier_pre_moderation" on legacy_sends;
drop policy if exists "legacy_sends_update_buyer_read_receipt" on legacy_sends;
drop policy if exists "legacy_sends_delete_admin" on legacy_sends;

-- SELECT: admin OR supplier OR (buyer + retailer + status sent+ check podwojny)
create policy "legacy_sends_read_role_based" on legacy_sends
  for select
  using (
    is_admin()
    or app_role() = 'supplier'
    or (
      app_role() = 'buyer'
      and retailer_id = app_retailer_id()
      and status in (
        'sent', 'opened', 'read', 'read_manual', 'unread_expired', 'refunded'
      )
      and coalesce(data->>'status', status) in (
        'sent', 'opened', 'read', 'read_manual', 'unread_expired', 'refunded'
      )
    )
  );

-- INSERT: admin OR supplier (tylko queued/pending_moderation - check podwojny)
create policy "legacy_sends_insert_supplier_or_admin" on legacy_sends
  for insert
  with check (
    is_admin()
    or (
      app_role() = 'supplier'
      and status in ('queued', 'pending_moderation')
      and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
    )
  );

-- UPDATE: admin (pelny dostep)
create policy "legacy_sends_update_admin" on legacy_sends
  for update
  using (is_admin())
  with check (is_admin());

-- UPDATE: supplier (tylko pre-moderation - check podwojny)
create policy "legacy_sends_update_supplier_pre_moderation" on legacy_sends
  for update
  using (
    app_role() = 'supplier'
    and status in ('queued', 'pending_moderation')
    and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
  )
  with check (
    app_role() = 'supplier'
    and status in ('queued', 'pending_moderation')
    and coalesce(data->>'status', status) in ('queued', 'pending_moderation')
  );

-- UPDATE: buyer = BRAK
-- (Read receipt - zmiana status na 'opened'/'read'/'read_manual' - bedzie
-- realizowane przez bezpieczna funkcje RPC mark_legacy_send_read(send_id)
-- ktora aktualizuje TYLKO status/readAt, bez mozliwosci dotykania innych pol)

-- DELETE: tylko admin
create policy "legacy_sends_delete_admin" on legacy_sends
  for delete
  using (is_admin());

commit;

-- ============== Weryfikacja ==============
-- Lista wszystkich polityk dla obu tabel
select tablename, policyname, cmd
from pg_policies
where tablename in ('legacy_offers', 'legacy_sends')
order by tablename, cmd, policyname;

-- Oczekiwany wynik (10 polityk):
--   legacy_offers, legacy_offers_admin_write,                ALL
--   legacy_offers, legacy_offers_supplier_write,             ALL
--   legacy_offers, legacy_offers_read_role_based,            SELECT
--   legacy_sends,  legacy_sends_delete_admin,                DELETE
--   legacy_sends,  legacy_sends_insert_supplier_or_admin,    INSERT
--   legacy_sends,  legacy_sends_read_role_based,             SELECT
--   legacy_sends,  legacy_sends_update_admin,                UPDATE
--   legacy_sends,  legacy_sends_update_supplier_pre_moderation, UPDATE
-- Razem: 8 polityk. Nie powinno byc zadnej "_authenticated" ani "_modify_authenticated".
