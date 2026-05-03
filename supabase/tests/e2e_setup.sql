-- ===================================================================
-- E2E TEST SETUP - Fresh Market
-- Uruchom ten skrypt RAZ w Supabase SQL Editor.
-- Tworzy: 1 profesjonalna oferta + 1 wysylka pending_moderation do Biedronki.
-- Po uruchomieniu zaloguj sie jako roznetestowe konta i sprawdzaj.
-- ===================================================================

-- Czyszczenie poprzednich testow
delete from legacy_offers where legacy_id in (8888, 8889, 9999);
delete from legacy_sends   where legacy_id in (8888, 8889, 9999);

-- ===================================================================
-- PROFESJONALNA OFERTA TESTOWA: Pomidory malinowe z Mazur
-- supplier_legacy_id = 'sup-s1' (UNICA GROUP w legacy)
-- 3 zdjecia placeholder (czerwone glowne, turkusowe opakowanie, zolte pakowalnia)
-- ===================================================================
insert into legacy_offers (legacy_id, supplier_legacy_id, status, category, origin, data) values (
  8888, 'sup-s1', 'active', 'warzywa', 'PL',
  jsonb_build_object(
    'id', 8888,
    'supplierId', 'sup-s1',
    'product', 'Pomidory malinowe Premium',
    'title', 'Pomidory malinowe PL Premium — Plantacja Mazurska, sezon V–IX',
    'variety', 'Pink Lady F1, Tigerella, Roma',
    'category', 'warzywa',
    'subcategory', 'pomidory',
    'origin', 'PL',
    'region', 'Mazury',
    'offerType', 'Program staly',
    'positioning', 'Premium',
    'status', 'active',
    'tier', 'premium',
    'photos', jsonb_build_array(
      'https://placehold.co/1200x900/dc2626/white.webp?text=Pomidory+Premium+Glowne',
      'https://placehold.co/1200x900/0d9488/white.webp?text=Opakowanie+karton+5kg',
      'https://placehold.co/1200x900/f59e0b/white.webp?text=Pakowalnia+sortownia'
    ),
    'priceOffer', '4.50',
    'priceUnit', 'kg',
    'currency', 'EUR',
    'incoterm', 'DDP',
    'priceFrom', '2026-05-01',
    'priceTo', '2026-09-30',
    'volumeMin', '20',
    'volumeMax', '80',
    'volumeUnit', 'T/tyg.',
    'moq', '1 paleta',
    'leadTime', '24h',
    'qualityClass', 'Klasa Extra',
    'brix', 'min. 6.5°Bx',
    'isBio', false,
    'colorSpec', 'Intensywny czerwony, jednolity',
    'qualitySpec', 'Pomidory malinowe odmiany Pink Lady F1, kaliber AA-AAA. Sortownia optyczna. Brak uszkodzen mechanicznych. Trwalosc 14 dni przy 12°C.',
    'brand', 'Mazurska Plantacja',
    'saleMode', 'Marka producenta',
    'packaging', jsonb_build_array('Karton', 'Punnet'),
    'packagingDesc', 'Karton 5kg lub punnet 500g retail-ready z EAN',
    'palletType', 'EUR',
    'palletHeight', '180 cm',
    'srp', 'Tak',
    'deliveryModel', 'Centrum dystrybucyjne (CD)',
    'loadingPoint', 'Olsztyn, woj. warminsko-mazurskie',
    'deliveryRegions', 'PL, DE, CZ, SK, HU',
    'coldChain', 'Po stronie dostawcy',
    'tempTransport', '8-12°C',
    'traceability', 'Tak',
    'certs', jsonb_build_array('GlobalGAP', 'BRC'),
    'certNumber', 'GGN-MAZUR-2026-001',
    'certValid', '2026-12-31',
    'currentTests', 'Tak',
    'samplesAvail', 'Tak — wyslemy 5kg',
    'promoPrice', 'Tak',
    'contractProgram', 'Tak',
    'from', '2026-05',
    'to', '2026-09',
    'availabilityModel', 'Sezonowo',
    'deliveryDays', jsonb_build_array('Pon','Sr','Pt'),
    'benefit1', 'Sezon V–IX, 80T/tyg w szczycie — zerowe przerwy w dostawach',
    'benefit2', 'Marka producenta + retail-ready punnet 500g — gotowe na polke bez przepakowania',
    'benefit3', 'GlobalGAP + BRC + Klasa Extra = mozesz pozycjonowac jako Premium',
    'shopBenefit', 'Pomidory malinowe to top kategoria pomidorow w sezonie. Marza +25% vs zwykle.',
    'riskMitigation', 'Wlasna plantacja 50ha + sortownia. Zero zaleznosci od skupu.',
    'riskProof', 'Dostawca dla Lidla DE i Auchana FR od 2024.',
    'riskNow', 'Sezon V–IX — kontrakt do 30 kwietnia, potem ceny rynkowe.',
    'cta', jsonb_build_array('long_term', 'samples', 'meet_fm'),
    'description', 'Pomidory malinowe Premium z Mazur. Wlasna plantacja 50ha, sortownia optyczna, certyfikaty GlobalGAP+BRC. Sezonowo V–IX, 80T/tyg w szczycie. Retail-ready punnet 500g lub karton 5kg.',
    'volume', '80',
    'volumeUnit2', 'T/tyg.'
  )
);

-- WYSYLKA do Biedronki (retailer_id = 100), status pending_moderation
insert into legacy_sends (legacy_id, supplier_legacy_id, offer_legacy_id, retailer_id, status, data) values (
  8888, 'sup-s1', 8888, 100, 'pending_moderation',
  jsonb_build_object(
    'id', 8888,
    'supplierId', 'sup-s1',
    'offerId', 8888,
    'retailerId', 100,
    'month', '2026-05',
    'pos', 1,
    'status', 'pending_moderation',
    'sendDate', '2026-05-06',
    'price', 60,
    'daysLeft', 14,
    'confirmHistory', jsonb_build_array()
  )
);

-- Status — 1 oferta + 1 wysylka pending_moderation
select 'OFFER' as t, count(*) c from legacy_offers where legacy_id = 8888
union all
select 'SEND_PENDING_MODERATION' as t, count(*) c from legacy_sends where legacy_id = 8888 and status = 'pending_moderation';
-- Oczekiwane: 1 i 1
