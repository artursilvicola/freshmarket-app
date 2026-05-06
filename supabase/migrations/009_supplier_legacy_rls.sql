-- ===================================================================
-- 009 — Zaostrzenie RLS dla legacy_offers i legacy_sends.
-- [B2B Round 2.2 blocker 3]
--
-- Stan w 005: supplier mial pelny dostep do wszystkich legacy_offers/sends
-- (`for all using (auth.uid() is not null)` w wczesniejszej wersji,
-- pozniej `legacy_offers_supplier_all` ktore mialo zbyt szeroki using).
--
-- Cel: supplier widzi/edytuje TYLKO swoje rekordy. Filtrujemy po
-- supplier_legacy_id = legacy_fm_id firmy zwiazanej z profile.company_id.
-- ===================================================================

begin;

-- Helper function: mapuje aktualnego supplier-usera na jego supplier_legacy_id.
-- Zwraca companies.legacy_fm_id dla firmy z profile.company_id.
create or replace function app_supplier_legacy_id() returns text as $$
  select c.legacy_fm_id
  from companies c
  join profiles p on p.company_id = c.id
  where p.id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- ============================================================
-- LEGACY_OFFERS — zaostrzenie polityk dla supplier
-- ============================================================
drop policy if exists "legacy_offers_supplier_all"        on legacy_offers;
drop policy if exists "legacy_offers_supplier_own_read"   on legacy_offers;
drop policy if exists "legacy_offers_supplier_own_write"  on legacy_offers;

-- Supplier widzi tylko swoje oferty (po supplier_legacy_id matching legacy_fm_id)
create policy "legacy_offers_supplier_own_read" on legacy_offers
  for select using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  );

-- Supplier moze tworzyc/aktualizowac/usuwac tylko swoje oferty
create policy "legacy_offers_supplier_own_write" on legacy_offers
  for all using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  ) with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  );

-- ============================================================
-- LEGACY_SENDS — zaostrzenie polityk dla supplier
-- ============================================================
drop policy if exists "legacy_sends_supplier_all"          on legacy_sends;
drop policy if exists "legacy_sends_supplier_own_read"     on legacy_sends;
drop policy if exists "legacy_sends_supplier_own_write"    on legacy_sends;

-- Supplier widzi tylko swoje wysylki
create policy "legacy_sends_supplier_own_read" on legacy_sends
  for select using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  );

-- Supplier moze tworzyc/aktualizowac/usuwac tylko swoje wysylki
create policy "legacy_sends_supplier_own_write" on legacy_sends
  for all using (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  ) with check (
    app_role() = 'supplier'
    and supplier_legacy_id = app_supplier_legacy_id()
  );

-- ============================================================
-- WALIDACJA: pokaz nowe polityki (do recznego sprawdzenia po wgraniu)
-- ============================================================
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
--   WHERE tablename IN ('legacy_offers','legacy_sends')
--   ORDER BY tablename, policyname;

commit;
