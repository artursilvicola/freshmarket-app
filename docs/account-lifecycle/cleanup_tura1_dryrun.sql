-- ===========================================================================
-- Tura 1 — DRY-RUN (READ-ONLY). Tylko SELECT. Zero DELETE/UPDATE.
-- Cel: (1) potwierdzić, że 17 firm NADAL ma 0 finansów,
--      (2) policzyć ile wierszy zostałoby usunięte z każdej tabeli,
--      (3) podejrzeć wiersze do backupu.
-- Zakres: TYLKO bucket "USUŃ TURA 1" (17 firm). Unica/Pik/OKSALE i KJOW/admin
-- NIE są tu wymienione i NIE są ruszane.
-- ===========================================================================

-- Wspólna lista 17 firm (jedyne źródło prawdy). Legacy_supplier_id i profile
-- wyliczamy z company_id — nie wpisujemy ich ręcznie.
-- (Skopiuj cały blok 'with tura1 ...' przed każde zapytanie poniżej.)

-- ── ZAPYTANIE A — re-weryfikacja finansów (OCZEKIWANE: wszędzie 0/0/0/0) ──────
with tura1(company_id) as (values
  ('ce29858e-2344-453b-a485-4b2b9e29bcbb'::uuid),('df78bad1-64a9-4809-9c06-fab7bb697d43'),
  ('8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8'),('6a71aa14-701f-4475-85be-ba6da902f6f9'),
  ('11111111-1111-1111-1111-111111111111'),('c4633c15-5b94-45a6-a7e4-d6b17c9613a0'),
  ('eca5955a-c45b-4d56-a481-ea93426259fb'),('a8656d6a-1bd9-4ce8-89db-6f1487926a9c'),
  ('e965d577-481f-4ef6-b5a4-2f14d9bc8227'),('6626ac84-6a9c-40b5-af9c-b648043e6999'),
  ('6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a'),('6dd7d223-fef9-4d7a-abbd-8722f93250f4'),
  ('b001b010-7310-42c5-9754-2058e06b1d95'),('70c10dbb-cd9c-4eb7-ab24-af0fc6070478'),
  ('4d3ddc85-6148-49d4-9a8a-340241060bcc'),('a6365067-785f-4009-a5b7-6e6b24133648'),
  ('6d3ef58a-03ea-4819-bbf4-6bf4074d84df'))
select c.id, c.name,
  (select count(*) from proformas pf  where pf.company_id=c.id)                            as proformas,
  (select count(*) from packages  pk  where pk.company_id=c.id)                            as packages,
  (select coalesce(sum(coalesce(pk.qty_used,0)),0) from packages pk where pk.company_id=c.id) as credits_used,
  (select count(*) from payu_orders po where po.company_id=c.id and po.status='completed') as payu_completed
from companies c join tura1 t on t.company_id=c.id
order by c.name;
-- STOP jeśli gdziekolwiek > 0 — taka firma WYPADA z Tury 1.


-- ── ZAPYTANIE B — liczby wierszy do usunięcia per tabela (transparentność) ────
with tura1(company_id) as (values
  ('ce29858e-2344-453b-a485-4b2b9e29bcbb'::uuid),('df78bad1-64a9-4809-9c06-fab7bb697d43'),
  ('8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8'),('6a71aa14-701f-4475-85be-ba6da902f6f9'),
  ('11111111-1111-1111-1111-111111111111'),('c4633c15-5b94-45a6-a7e4-d6b17c9613a0'),
  ('eca5955a-c45b-4d56-a481-ea93426259fb'),('a8656d6a-1bd9-4ce8-89db-6f1487926a9c'),
  ('e965d577-481f-4ef6-b5a4-2f14d9bc8227'),('6626ac84-6a9c-40b5-af9c-b648043e6999'),
  ('6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a'),('6dd7d223-fef9-4d7a-abbd-8722f93250f4'),
  ('b001b010-7310-42c5-9754-2058e06b1d95'),('70c10dbb-cd9c-4eb7-ab24-af0fc6070478'),
  ('4d3ddc85-6148-49d4-9a8a-340241060bcc'),('a6365067-785f-4009-a5b7-6e6b24133648'),
  ('6d3ef58a-03ea-4819-bbf4-6bf4074d84df')),
lsids as (select c.legacy_supplier_id from companies c join tura1 t on t.company_id=c.id where c.legacy_supplier_id is not null),
pids  as (select p.id from profiles p join tura1 t on t.company_id=p.company_id)
select
  (select count(*) from companies   c where c.id in (select company_id from tura1))                       as companies_rows,
  (select count(*) from profiles    p where p.company_id in (select company_id from tura1))               as profiles_rows,
  (select count(*) from legacy_sends ls where ls.supplier_legacy_id in (select legacy_supplier_id from lsids)) as legacy_sends_rows,
  (select count(*) from legacy_offers lo where lo.supplier_legacy_id in (select legacy_supplier_id from lsids)) as legacy_offers_rows,
  (select count(*) from payu_orders  po where po.company_id in (select company_id from tura1))            as payu_orders_rows_all,
  (select count(*) from fm_messages  m  where m.from_user_id in (select id from pids) or m.to_user_id in (select id from pids)) as fm_messages_rows,
  (select count(*) from pids)                                                                              as auth_users_to_remove;
-- "auth_users_to_remove" = liczba loginów (profiles.id) do usunięcia OSOBNO w kroku 4.


-- ── ZAPYTANIE C — lista user_id (auth.users) do ręcznego usunięcia w kroku 4 ──
with tura1(company_id) as (values
  ('ce29858e-2344-453b-a485-4b2b9e29bcbb'::uuid),('df78bad1-64a9-4809-9c06-fab7bb697d43'),
  ('8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8'),('6a71aa14-701f-4475-85be-ba6da902f6f9'),
  ('11111111-1111-1111-1111-111111111111'),('c4633c15-5b94-45a6-a7e4-d6b17c9613a0'),
  ('eca5955a-c45b-4d56-a481-ea93426259fb'),('a8656d6a-1bd9-4ce8-89db-6f1487926a9c'),
  ('e965d577-481f-4ef6-b5a4-2f14d9bc8227'),('6626ac84-6a9c-40b5-af9c-b648043e6999'),
  ('6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a'),('6dd7d223-fef9-4d7a-abbd-8722f93250f4'),
  ('b001b010-7310-42c5-9754-2058e06b1d95'),('70c10dbb-cd9c-4eb7-ab24-af0fc6070478'),
  ('4d3ddc85-6148-49d4-9a8a-340241060bcc'),('a6365067-785f-4009-a5b7-6e6b24133648'),
  ('6d3ef58a-03ea-4819-bbf4-6bf4074d84df'))
select p.id as auth_user_id, p.email, c.name as company
from profiles p join tura1 t on t.company_id=p.company_id
left join companies c on c.id=p.company_id
order by c.name;


-- ── ZAPYTANIE D — BACKUP: podgląd wszystkich wierszy do eksportu CSV ──────────
-- Uruchom każdy SELECT, kliknij Export → CSV. To Twój backup logiczny przed kasacją.
-- (companies, profiles, legacy_sends, legacy_offers, payu_orders, fm_messages
--  — przefiltrowane do 17 firm). Przykład dla companies:
with tura1(company_id) as (values
  ('ce29858e-2344-453b-a485-4b2b9e29bcbb'::uuid),('df78bad1-64a9-4809-9c06-fab7bb697d43'),
  ('8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8'),('6a71aa14-701f-4475-85be-ba6da902f6f9'),
  ('11111111-1111-1111-1111-111111111111'),('c4633c15-5b94-45a6-a7e4-d6b17c9613a0'),
  ('eca5955a-c45b-4d56-a481-ea93426259fb'),('a8656d6a-1bd9-4ce8-89db-6f1487926a9c'),
  ('e965d577-481f-4ef6-b5a4-2f14d9bc8227'),('6626ac84-6a9c-40b5-af9c-b648043e6999'),
  ('6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a'),('6dd7d223-fef9-4d7a-abbd-8722f93250f4'),
  ('b001b010-7310-42c5-9754-2058e06b1d95'),('70c10dbb-cd9c-4eb7-ab24-af0fc6070478'),
  ('4d3ddc85-6148-49d4-9a8a-340241060bcc'),('a6365067-785f-4009-a5b7-6e6b24133648'),
  ('6d3ef58a-03ea-4819-bbf4-6bf4074d84df'))
select c.* from companies c join tura1 t on t.company_id=c.id;
-- Analogicznie: profiles (where company_id in tura1), legacy_sends/legacy_offers
-- (where supplier_legacy_id in (select legacy_supplier_id ...)), payu_orders, fm_messages.
