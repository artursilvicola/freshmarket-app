-- ===================================================================
-- E2E ROLE SWITCHER - przelaczanie roli testowego konta
-- Test konto: test.dostawca.20260430@freshmarket.test (haslo TestPass2026!)
-- Uruchom JEDEN z 3 blokow w zaleznosci od tego co testujesz.
-- Po wykonaniu wyloguj sie i zaloguj ponownie.
-- ===================================================================

-- ============== BLOK 1: USTAW KONTO JAKO ADMIN ==============
update profiles set
  role = 'admin',
  name = 'Test Admin',
  retailer_id = null,
  company_id = null
where id = (select id from auth.users where email = 'test.dostawca.20260430@freshmarket.test')
returning role::text, name;
-- ============================================================


-- ============== BLOK 2: USTAW KONTO JAKO SUPPLIER (Food Market) ==============
-- Aby uruchomic - zakomentuj Blok 1 (--), odkomentuj Blok 2.
-- update profiles set
--   role = 'supplier',
--   name = 'Test Dostawca',
--   retailer_id = null,
--   company_id = '11111111-1111-1111-1111-111111111111'
-- where id = (select id from auth.users where email = 'test.dostawca.20260430@freshmarket.test')
-- returning role::text, name;
-- ===========================================================================


-- ============== BLOK 3: USTAW KONTO JAKO BUYER (Biedronka, retailer 100) ==============
-- update profiles set
--   role = 'buyer',
--   name = 'Test Kupiec Biedronka',
--   retailer_id = 100,
--   company_id = null
-- where id = (select id from auth.users where email = 'test.dostawca.20260430@freshmarket.test')
-- returning role::text, name, retailer_id;
-- =====================================================================================


-- ============== BLOK 4: USTAW KONTO JAKO BUYER (Lidl, retailer 101) ==============
-- update profiles set
--   role = 'buyer',
--   name = 'Test Kupiec Lidl',
--   retailer_id = 101,
--   company_id = null
-- where id = (select id from auth.users where email = 'test.dostawca.20260430@freshmarket.test')
-- returning role::text, name, retailer_id;
-- ================================================================================


-- ============== ADMINISTRATOR: szybka moderacja oferty 8888 ==============
-- Po uruchomieniu jako admin lub przez UI panel admina, mozesz tez recznie zatwierdzic SQL:

-- ZATWIERDZ:
-- update legacy_sends set
--   status = 'approved',
--   data = data || jsonb_build_object('status', 'approved')
-- where legacy_id = 8888;

-- WYSLIJ (zmiana approved -> sent):
-- update legacy_sends set
--   status = 'sent',
--   data = data || jsonb_build_object('status', 'sent', 'sentAt', now()::text)
-- where legacy_id = 8888;
-- =========================================================================


-- ============== SPRAWDZ STAN: ile co widzi ==============
select 'Oferty w bazie' as info, count(*)::text c from legacy_offers
union all
select 'Wysylki PENDING_MODERATION', count(*)::text from legacy_sends where status = 'pending_moderation'
union all
select 'Wysylki APPROVED', count(*)::text from legacy_sends where status = 'approved'
union all
select 'Wysylki SENT', count(*)::text from legacy_sends where status = 'sent'
union all
select 'Wysylki do Biedronki (100)', count(*)::text from legacy_sends where retailer_id = 100;
-- =========================================================
