-- ===================================================================
-- Fresh Market — Dane testowe (seed)
-- Wykonaj PO migracjach 001-003
-- Bazuje na danych z PreconnectFM.jsx (RETAILERS, COMPANIES_DB)
-- ===================================================================

-- ===================================================================
-- RETAILERS (sieci handlowe)
-- ===================================================================
insert into retailers (id, name, country, cats, color, bg, initials, buyer_name, buyer_email, buyer_phone, next_send) values
  (100, 'Biedronka',          'PL', array['owoce','warzywa'],          '#dc2626', '#fee2e2', 'BIE', 'Monika Wiśniewska',    'owoce@biedronka.pl',              '+48 22 123 4500', '2026-05-06'),
  (101, 'Lidl Polska',        'PL', array['owoce','warzywa'],          '#1e3a8a', '#dbeafe', 'LDL', 'Piotr Zając',          'warzywa@lidl.pl',                 '+48 22 987 6543', '2026-05-06'),
  (102, 'Kaufland Polska',    'PL', array['owoce','warzywa'],          '#b91c1c', '#fef2f2', 'KAU', 'Anna Kowalczyk',       'a.kowalczyk@kaufland.pl',         '+48 22 456 7890', '2026-05-06'),
  (103, 'Carrefour Polska',   'PL', array['owoce','warzywa','kwiaty'], '#1d4ed8', '#eff6ff', 'CAR', 'Marcin Nowak',         'm.nowak@carrefour.pl',            '+48 22 345 6789', '2026-05-06'),
  (104, 'Auchan Polska',      'PL', array['owoce','warzywa','kwiaty'], '#e11d48', '#fff1f2', 'AUC', 'Katarzyna Wróbel',     'k.wrobel@auchan.pl',              '+48 22 567 8901', '2026-05-06'),
  (105, 'Netto Polska',       'DK', array['owoce','warzywa'],          '#f97316', '#fff7ed', 'NET', 'Tomasz Kaczmarek',     't.kaczmarek@netto.pl',            '+48 91 234 5678', '2026-05-06'),
  (106, 'Intermarché',        'FR', array['owoce','warzywa','kwiaty'], '#16a34a', '#f0fdf4', 'INT', 'Sophie Martin',        's.martin@intermarche.pl',         '+33 1 6677 8899', '2026-05-06'),
  (107, 'Dino Polska',        'PL', array['owoce','warzywa'],          '#7c3aed', '#faf5ff', 'DIN', 'Michał Adamski',       'm.adamski@dino.pl',               '+48 62 345 6789', '2026-05-06'),
  (108, 'E.Leclerc',          'FR', array['owoce','warzywa','kwiaty'], '#0369a1', '#e0f2fe', 'LEC', 'Jean Dupuis',          'j.dupuis@leclerc.fr',             '+33 2 5544 3322', '2026-05-06'),
  (109, 'Aldi Polska',        'DE', array['owoce','warzywa'],          '#1e3a5f', '#f1f5f9', 'ALD', 'Klaus Weber',          'k.weber@aldi.de',                 '+49 208 9977 100', '2026-05-06'),
  (110, 'Stokrotka',          'PL', array['owoce','warzywa'],          '#059669', '#ecfdf5', 'STK', 'Beata Kowalska',       'b.kowalska@stokrotka.pl',         '+48 81 234 5678', '2026-05-06'),
  (111, 'Makro Polska',       'DE', array['owoce','warzywa','kwiaty'], '#dc2626', '#fef2f2', 'MAK', 'Przemysław Witek',     'p.witek@makro.pl',                '+48 22 775 5100', '2026-05-06'),
  (112, 'Selgros',            'DE', array['owoce','warzywa','kwiaty'], '#1d4ed8', '#eff6ff', 'SEL', 'Dorota Malinowska',    'd.malinowska@selgros.pl',         '+48 61 898 7000', '2026-05-06'),
  (113, 'Polomarket',         'PL', array['owoce','warzywa'],          '#9333ea', '#fdf4ff', 'POL', 'Łukasz Grabowski',     'l.grabowski@polomarket.pl',       '+48 22 890 1234', '2026-05-06'),
  (114, 'Albert CZ',          'CZ', array['owoce','warzywa'],          '#0891b2', '#ecfeff', 'ALB', 'Jana Nováková',        'j.novakova@albert.cz',            '+420 2 3456 7890', '2026-05-06'),
  (115, 'BILLA CEE',          'AT', array['owoce','warzywa','kwiaty'], '#b91c1c', '#fff1f2', 'BIL', 'Stefan Bauer',         's.bauer@billa-cee.com',           '+43 1 6060 9900', '2026-05-06'),
  (116, 'Maxima LT',          'LT', array['owoce','warzywa'],          '#d97706', '#fffbeb', 'MAX', 'Rasa Kazlauskaitė',    'r.kazlauskaite@maxima.lt',        '+370 5 233 0000', '2026-05-06'),
  (117, 'Rimi Baltic',        'LV', array['owoce','warzywa'],          '#dc2626', '#fff1f2', 'RIM', 'Andris Kārkliņš',     'a.karklins@rimi.lv',              '+371 6733 4455', '2026-05-06'),
  (118, 'ATB Market',         'UA', array['owoce','warzywa'],          '#15803d', '#f0fdf4', 'ATB', 'Олена Петренко',       'o.petrenko@atbmarket.ua',         '+380 56 723 4500', '2026-05-06'),
  (119, 'Delikatesy Centrum', 'PL', array['owoce','warzywa','kwiaty'], '#0d9488', '#f0fdfa', 'DEL', 'Agnieszka Białek',     'a.bialek@eurocash.pl',            '+48 61 334 7770', '2026-05-06'),
  (120, 'Spar Polska',        'NL', array['owoce','warzywa','kwiaty'], '#16a34a', '#f0fdf4', 'SPA', 'Joost van der Berg',   'j.vanderberg@spar.pl',            '+31 20 609 9000', '2026-05-06')
on conflict (id) do nothing;

-- ===================================================================
-- COMPANIES (przykładowe firmy dostawcy)
-- ===================================================================
-- Po wgraniu seed-u: w aplikacji każdy nowy supplier-user dostaje przypisaną tę firmę,
-- albo admin tworzy mu osobną.
insert into companies (id, name, nip, country, city, phone, website, description, types, categories, products, seasonality, markets, completeness)
values
  ('11111111-1111-1111-1111-111111111111', 'Food Market', 'PL1181976336', 'PL', 'Recz',
   '+48 789 464 307', 'https://2pm.slupsk.pl',
   'Food Market – producent i eksporter jabłek deserowych (Gala, Szampion) oraz warzyw gruntowych. Własna pakowalnia z sortownią optyczną i chłodnią CA 2000 ton.',
   array['producent','eksporter','pakowalnia'],
   array['owoce','warzywa'],
   'jabłka Gala, cukinia, brokuły', 'IX-II, V-X', 'CEE, DE, NL', 85),
  ('22222222-2222-2222-2222-222222222222', 'Unica Group',  null, 'ES', 'Almería',
   '+34 950 123 456', 'https://unicagroup.es',
   'Hiszpańska kooperatywa producencka — cytrusy, winogrona, owoce pestkowe.',
   array['producent','kooperatywa','eksporter'],
   array['owoce'],
   'pomarańcze, mandarynki, winogrona, brzoskwinie', 'X-III, VI-IX', 'EU, CEE', 90),
  ('33333333-3333-3333-3333-333333333333', 'Pik Global', null, 'PL', 'Bydgoszcz',
   '+48 22 456 7890', 'https://pikglobal.pl',
   'Polski producent warzyw — marchew, ziemniaki, cebula, kapusta. Pakowalnia retail-ready.',
   array['producent','pakowalnia','eksporter'],
   array['warzywa'],
   'marchew, ziemniaki, cebula', 'cały rok', 'PL, DE, CZ', 80)
on conflict (id) do nothing;

-- Kontakty firm
insert into company_contacts (company_id, role, name, position, phone, email, sort_order) values
  ('11111111-1111-1111-1111-111111111111', 'sales',   'Joanna Emilianowicz', 'Export Manager',  '+48 789 464 307', 'joanna@i-f.online', 0),
  ('11111111-1111-1111-1111-111111111111', 'quality', 'Adam Kowalski',       'Quality Manager', '+48 999 111 222', 'adam@i-f.online',   1),
  ('22222222-2222-2222-2222-222222222222', 'sales',   'María García',        'Export Manager',  '+34 950 123 456', 'sales@unicagroup.es', 0),
  ('22222222-2222-2222-2222-222222222222', 'quality', 'Carlos López',        'Quality Manager', '+34 950 123 457', 'quality@unicagroup.es', 1),
  ('33333333-3333-3333-3333-333333333333', 'sales',   'Piotr Kowalski',      'Export Manager',  '+48 22 456 7890', 'sales@pikglobal.pl', 0),
  ('33333333-3333-3333-3333-333333333333', 'quality', 'Anna Nowak',          'Quality Manager', '+48 22 456 7891', 'quality@pikglobal.pl', 1)
on conflict do nothing;

-- Certyfikaty
insert into company_certs (company_id, type, number, valid_until) values
  ('11111111-1111-1111-1111-111111111111', 'GlobalGAP', '4056186695431', '2026-11-21'),
  ('11111111-1111-1111-1111-111111111111', 'BRC',       'BRC-FM-2024',   '2026-06-12'),
  ('22222222-2222-2222-2222-222222222222', 'GlobalGAP', 'GGN-UNICA-2026-001', '2026-12-31'),
  ('22222222-2222-2222-2222-222222222222', 'BRC',       'BRC-UNICA-2026',     '2026-08-15')
on conflict do nothing;

-- ===================================================================
-- LIMITY (po jednym wpisie na retailera)
-- ===================================================================
insert into retailer_limits (retailer_id, monthly_limit, active)
select id, 50, true from retailers
on conflict (retailer_id) do nothing;

-- ===================================================================
-- USTAWIENIA FRESH MARKET (wydarzenie)
-- ===================================================================
insert into fm_settings (venue, event_date, message, algo_phase)
values (
  'MCC Mazurkas Conference Centre, Ożarów Mazowiecki',
  '2026-09-24',
  'Fresh Market — pierwsze targi B2B fresh produce w Polsce.',
  'preferences_open'
);
