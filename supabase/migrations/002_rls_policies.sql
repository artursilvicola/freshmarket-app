-- ===================================================================
-- Fresh Market — Row Level Security (RLS)
-- Wykonaj PO 001_schema.sql
-- ===================================================================
-- Zasada: każda tabela ma RLS włączone. Polityki kontrolują, kto co widzi.
-- Reguły:
--   - admin: widzi i edytuje WSZYSTKO
--   - supplier: widzi i edytuje TYLKO swoją firmę i swoje oferty
--   - buyer: widzi TYLKO sends do siebie + dane firm dostawców (publiczne)
-- ===================================================================

-- Włącz RLS na wszystkich tabelach
alter table profiles enable row level security;
alter table companies enable row level security;
alter table company_contacts enable row level security;
alter table company_certs enable row level security;
alter table retailers enable row level security;
alter table offers enable row level security;
alter table offer_photos enable row level security;
alter table sends enable row level security;
alter table buyer_starred enable row level security;
alter table wallet_tx enable row level security;
alter table packages enable row level security;
alter table retailer_limits enable row level security;
alter table fm_settings enable row level security;
alter table fm_prefs enable row level security;
alter table fm_resps enable row level security;
alter table audit_log enable row level security;

-- ===================================================================
-- PROFILES
-- ===================================================================
-- Każdy widzi swój profil; admin widzi wszystkie
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or is_admin());

-- Każdy może edytować swój profil; admin może edytować wszystkie
create policy "profiles_update_own_or_admin" on profiles
  for update using (id = auth.uid() or is_admin());

-- Insert tylko poprzez trigger handle_new_user (security definer); admin też może ręcznie
create policy "profiles_insert_admin" on profiles
  for insert with check (is_admin() or id = auth.uid());

-- ===================================================================
-- COMPANIES
-- ===================================================================
-- Public read: każdy zalogowany widzi firmy (potrzebne dla katalogu)
create policy "companies_select_all_authenticated" on companies
  for select using (auth.uid() is not null);

-- Update: tylko admin albo właściciel firmy (supplier z tym company_id)
create policy "companies_update_owner_or_admin" on companies
  for update using (is_admin() or id = app_company_id());

-- Insert: tylko admin (zakładamy, że firmy są weryfikowane przed dodaniem)
create policy "companies_insert_admin" on companies
  for insert with check (is_admin());

create policy "companies_delete_admin" on companies
  for delete using (is_admin());

-- ===================================================================
-- COMPANY_CONTACTS i COMPANY_CERTS
-- ===================================================================
create policy "contacts_select_all_authenticated" on company_contacts
  for select using (auth.uid() is not null);

create policy "contacts_modify_owner_or_admin" on company_contacts
  for all using (is_admin() or company_id = app_company_id())
  with check (is_admin() or company_id = app_company_id());

create policy "certs_select_all_authenticated" on company_certs
  for select using (auth.uid() is not null);

create policy "certs_modify_owner_or_admin" on company_certs
  for all using (is_admin() or company_id = app_company_id())
  with check (is_admin() or company_id = app_company_id());

-- ===================================================================
-- RETAILERS
-- ===================================================================
-- Public read dla wszystkich zalogowanych (potrzebne aby dostawcy widzieli sieci)
create policy "retailers_select_all_authenticated" on retailers
  for select using (auth.uid() is not null);

-- Modyfikacje: tylko admin
create policy "retailers_modify_admin" on retailers
  for all using (is_admin())
  with check (is_admin());

-- ===================================================================
-- OFFERS
-- ===================================================================
-- Supplier widzi swoje oferty; admin widzi wszystkie; buyer widzi oferty
-- które zostały do niego wysłane (przez join z sends)
create policy "offers_select_supplier_admin_or_sent_to_buyer" on offers
  for select using (
    is_admin()
    or supplier_company_id = app_company_id()
    or exists (
      select 1 from sends s
      where s.offer_id = offers.id
        and s.retailer_id = app_retailer_id()
        and s.status in ('sent','opened','read','read_manual')
    )
  );

-- Supplier może tworzyć/edytować swoje oferty; admin może wszystko
create policy "offers_modify_supplier_or_admin" on offers
  for all using (is_admin() or supplier_company_id = app_company_id())
  with check (is_admin() or supplier_company_id = app_company_id());

-- ===================================================================
-- OFFER_PHOTOS
-- ===================================================================
create policy "offer_photos_select_via_offer" on offer_photos
  for select using (
    is_admin()
    or exists (
      select 1 from offers o
      where o.id = offer_photos.offer_id
        and (o.supplier_company_id = app_company_id()
             or exists (select 1 from sends s
                        where s.offer_id = o.id
                          and s.retailer_id = app_retailer_id()))
    )
  );

create policy "offer_photos_modify_supplier_or_admin" on offer_photos
  for all using (
    is_admin()
    or exists (select 1 from offers o
               where o.id = offer_photos.offer_id
                 and o.supplier_company_id = app_company_id())
  )
  with check (
    is_admin()
    or exists (select 1 from offers o
               where o.id = offer_photos.offer_id
                 and o.supplier_company_id = app_company_id())
  );

-- ===================================================================
-- SENDS
-- ===================================================================
-- Supplier: widzi swoje wysyłki
-- Buyer: widzi wysyłki do swojego retailera (jeśli status = sent/read/...)
-- Admin: wszystko
create policy "sends_select_role_based" on sends
  for select using (
    is_admin()
    or supplier_company_id = app_company_id()
    or (retailer_id = app_retailer_id() and status in ('sent','opened','read','read_manual','unread_expired'))
  );

-- Supplier może tworzyć (status queued/pending_moderation)
create policy "sends_insert_supplier" on sends
  for insert with check (
    is_admin() or supplier_company_id = app_company_id()
  );

-- Update: admin (moderacja) lub supplier (anulowanie własnych queued) lub buyer (read_manual)
create policy "sends_update_role_based" on sends
  for update using (
    is_admin()
    or supplier_company_id = app_company_id()
    or retailer_id = app_retailer_id()
  );

-- Delete: tylko admin
create policy "sends_delete_admin" on sends
  for delete using (is_admin());

-- ===================================================================
-- BUYER_STARRED
-- ===================================================================
create policy "starred_select_own" on buyer_starred
  for select using (buyer_user_id = auth.uid() or is_admin());

create policy "starred_modify_own" on buyer_starred
  for all using (buyer_user_id = auth.uid())
  with check (buyer_user_id = auth.uid());

-- ===================================================================
-- WALLET_TX & PACKAGES
-- ===================================================================
create policy "wallet_select_own_or_admin" on wallet_tx
  for select using (is_admin() or company_id = app_company_id());

create policy "wallet_modify_admin" on wallet_tx
  for all using (is_admin())
  with check (is_admin());

create policy "packages_select_own_or_admin" on packages
  for select using (is_admin() or company_id = app_company_id());

create policy "packages_modify_admin" on packages
  for all using (is_admin())
  with check (is_admin());

-- ===================================================================
-- RETAILER_LIMITS
-- ===================================================================
create policy "limits_select_authenticated" on retailer_limits
  for select using (auth.uid() is not null);

create policy "limits_modify_admin" on retailer_limits
  for all using (is_admin())
  with check (is_admin());

-- ===================================================================
-- FM_* (Fresh Market — wydarzenie)
-- ===================================================================
create policy "fm_settings_select_authenticated" on fm_settings
  for select using (auth.uid() is not null);

create policy "fm_settings_modify_admin" on fm_settings
  for all using (is_admin()) with check (is_admin());

-- fm_prefs: buyer może edytować swoje preferencje, admin wszystko
create policy "fm_prefs_select_role_based" on fm_prefs
  for select using (
    is_admin()
    or retailer_id = app_retailer_id()
    or app_role() = 'supplier'   -- supplier widzi też preferencje (do podglądu, BEZ edycji)
  );

create policy "fm_prefs_modify_buyer_or_admin" on fm_prefs
  for all using (is_admin() or retailer_id = app_retailer_id())
  with check (is_admin() or retailer_id = app_retailer_id());

-- fm_resps: każda strona widzi swój kawałek
create policy "fm_resps_select_role_based" on fm_resps
  for select using (
    is_admin()
    or retailer_id = app_retailer_id()
    or supplier_company_id = app_company_id()
  );

create policy "fm_resps_modify_admin" on fm_resps
  for all using (is_admin()) with check (is_admin());

-- ===================================================================
-- AUDIT_LOG
-- ===================================================================
create policy "audit_select_admin" on audit_log
  for select using (is_admin());

create policy "audit_insert_authenticated" on audit_log
  for insert with check (auth.uid() is not null);
