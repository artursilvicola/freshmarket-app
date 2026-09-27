-- =====================================================================
-- HISTORYCZNE KREDYTY — identyfikatory z archiwów 23.09 (1FMK2026/outputs)
-- Wygenerowane 27.09.2026 z kopii: przed (packages_before, 81 wierszy) i po
-- (packages_after, 204 wiersze). Zużycie (u) = stan z 23.09, NIE dzisiejszy.
-- CZĘŚĆ A = TYLKO ODCZYT (uzgodnienie z bazą). CZĘŚĆ B = zapis przez RPC,
-- wykonać dopiero po akceptacji wyników części A i po migracji.
-- =====================================================================

-- listy identyfikatorów (stałe dla tego wdrożenia)
create temp table if not exists hist_reg (id uuid primary key);      -- prezent rejestracyjny: std_5, 5 kredytów, cena 0, bez payment_ref (75 firm, wszystkie ważne do 31.12.2026)
create temp table if not exists hist_comp (id uuid primary key);     -- rekompensata 23.09: payment_ref compensation:fm2026:… (123 wierszy, 93 firm)
create temp table if not exists hist_legacy (id uuid primary key);   -- std_1, cena 0, bez referencji, źródło NIEUSTALONE (3) — opis neutralny, nie prezent
insert into hist_reg values
  ('bbb13876-9bd9-4582-a11d-66a1f0a2ef69'::uuid)  -- bd879c50 2026-07-02 q5/u0,
  ('afd2af03-0b6f-4297-a1ec-cd3b61f7657b'::uuid)  -- dd9fd7c9 2026-07-03 q5/u0,
  ('8c5f5c07-7d4c-46e7-8df8-18c31dbb08b6'::uuid)  -- dccaa47e 2026-07-09 q5/u2,
  ('64006dc4-6be8-4cca-a54a-a76f2bed6174'::uuid)  -- 4318896e 2026-07-17 q5/u3,
  ('4d9858ef-0a6b-44ed-a9f5-eeb73c6ade7b'::uuid)  -- 6123b1d9 2026-07-17 q5/u1,
  ('c5b9be07-5882-49dd-834c-57e12e1c65f7'::uuid)  -- 7fd2d57e 2026-07-21 q5/u0,
  ('c3d01792-450c-4945-b229-04f6d3a4b945'::uuid)  -- 37afa669 2026-07-28 q5/u0,
  ('467df0ca-90bc-40f2-bf3b-d3f8aa9fcf90'::uuid)  -- 746dd51b 2026-08-03 q5/u0,
  ('77f12a6d-083f-41ec-8b63-69ae3ce18656'::uuid)  -- 0814f3e1 2026-08-06 q5/u1,
  ('b1967baf-a7a6-4b83-ae29-2512f08b5aaa'::uuid)  -- fcb1d3ad 2026-08-10 q5/u0,
  ('bbcd95f0-4005-45e0-ab94-9d5e9b225753'::uuid)  -- 7c7672ea 2026-08-11 q5/u3,
  ('0f2153a7-58a7-4f2b-a4ad-c2a1db538458'::uuid)  -- 43030c3c 2026-08-11 q5/u2,
  ('80aad386-014b-4f9c-aff9-a09f679ee5e6'::uuid)  -- 88d6a20d 2026-08-12 q5/u4,
  ('4eb6e927-0c2e-4f0e-9dbb-7c3fe684fdc8'::uuid)  -- 69c4b9a7 2026-08-12 q5/u0,
  ('02fed6bf-22fe-4a9b-93c2-ba85c9319ee5'::uuid)  -- 9918e043 2026-08-12 q5/u0,
  ('ea23b5a7-e29b-48e2-89a3-706bc6a98a37'::uuid)  -- 5fcee9aa 2026-08-12 q5/u0,
  ('00bcb2d9-d46f-42c7-bfcd-9ac70ac389cc'::uuid)  -- 080ec9b5 2026-08-12 q5/u2,
  ('1edcb43a-0b53-446c-81a7-bdb9d394297f'::uuid)  -- 7007b235 2026-08-13 q5/u0,
  ('c7a0bff6-5b20-4030-a211-d823cc54aa64'::uuid)  -- 62c611d2 2026-08-14 q5/u2,
  ('6007e521-aa0f-47ff-b33c-e6db3b05e730'::uuid)  -- 741c8d0a 2026-08-14 q5/u3,
  ('c56d50d4-3b44-4fbf-8720-be7b7a7ad41a'::uuid)  -- 8676ec94 2026-08-14 q5/u0,
  ('f5068f62-003b-4e09-9c51-1f31f34b78c1'::uuid)  -- b45239a3 2026-08-17 q5/u0,
  ('18c8d95f-8b23-42e2-84a1-989cf7bf1d45'::uuid)  -- ca53bf60 2026-08-17 q5/u0,
  ('3ebc45d6-ad18-4421-baec-0bc009c03da7'::uuid)  -- 91d3877f 2026-08-18 q5/u1,
  ('abe4c586-2e89-46c3-b064-9d1d15c4f040'::uuid)  -- 22aec495 2026-08-18 q5/u3,
  ('536ba0b6-8885-4230-b8d5-9596c455bfc8'::uuid)  -- 5df76d6c 2026-08-19 q5/u0,
  ('762472f1-afa2-48f9-ab90-62965221e79c'::uuid)  -- d0d4c4ee 2026-08-20 q5/u0,
  ('867b74b0-d2f2-4715-9cd9-a74fa6c63f40'::uuid)  -- b43d6616 2026-08-20 q5/u1,
  ('6f266371-6506-44b8-9237-f5b6acd5049c'::uuid)  -- 09090bd6 2026-08-20 q5/u0,
  ('26a37807-3cc4-4c25-90d6-0cda950a47a5'::uuid)  -- a69747c8 2026-08-21 q5/u0,
  ('2d51bd85-e29d-4103-a0f8-ed45d9465f34'::uuid)  -- b345e9da 2026-08-21 q5/u0,
  ('2715b5c5-66df-40d2-b7d9-1e341fc3408d'::uuid)  -- 2cb5d9c8 2026-08-21 q5/u1,
  ('f59f2417-6614-456d-88ed-0efb52fef494'::uuid)  -- 265eac49 2026-08-25 q5/u0,
  ('5efb9d47-ba3b-4c25-9938-6c80f36d513e'::uuid)  -- d43997c7 2026-08-25 q5/u3,
  ('bc5ba057-35f9-444b-a0a8-9382876cf6ba'::uuid)  -- 75053331 2026-08-26 q5/u0,
  ('31f27996-919a-4364-88f1-4d38135944e0'::uuid)  -- 6a581069 2026-08-26 q5/u1,
  ('4dc47823-3ded-4df3-a81d-34d83f548054'::uuid)  -- 4e0f18b8 2026-08-26 q5/u0,
  ('e7442879-c4f0-49e1-ae05-da6680080cdb'::uuid)  -- b7f7492c 2026-08-26 q5/u0,
  ('c8fa499e-3ca2-4b25-9a8a-d01998cf1ed1'::uuid)  -- 6ad07f4a 2026-08-27 q5/u2,
  ('20a36f2a-cf20-49b8-9c96-c50182dbddea'::uuid)  -- e961eac3 2026-08-27 q5/u0,
  ('5b4a3f16-1042-4344-abd0-4f29b18b2a93'::uuid)  -- dfd48dc3 2026-08-27 q5/u0,
  ('ec0244c1-6d6b-456f-b64b-162ef27d8765'::uuid)  -- 3e677bf8 2026-08-27 q5/u1,
  ('8f6ff98c-9e4c-4875-be68-859b5d303a1b'::uuid)  -- ce73f5c6 2026-08-28 q5/u1,
  ('18a1977e-70d9-4662-a368-4a936ec146a5'::uuid)  -- 85a4e06a 2026-08-31 q5/u0,
  ('a9be1156-b7ce-4990-840d-6eb854005653'::uuid)  -- 0dd1181a 2026-08-31 q5/u1,
  ('5d007932-864e-4a6c-ac4e-0e9c8c7096a9'::uuid)  -- 847b0c59 2026-09-01 q5/u0,
  ('d4807a95-b818-4dc8-9a35-512340a0899c'::uuid)  -- 0c4b68aa 2026-09-02 q5/u0,
  ('10ba58dc-4f0b-4df2-93d6-bf6353ec7640'::uuid)  -- 0901b5ac 2026-09-02 q5/u0,
  ('726dc2bb-0a5a-4eea-a41d-19a620607acb'::uuid)  -- 8d571787 2026-09-02 q5/u0,
  ('366b6c7b-7a03-4213-9d0c-dbc3982c81f0'::uuid)  -- 95914993 2026-09-04 q5/u3,
  ('ede61cd8-fadd-4e44-a9db-098eb0f867a4'::uuid)  -- 4db0c153 2026-09-07 q5/u0,
  ('c5a8a110-cdbe-4c69-95fb-4e7fc69a27fc'::uuid)  -- 07e2221b 2026-09-07 q5/u2,
  ('417356de-5c2b-465e-8522-a2dc28fc6024'::uuid)  -- 3c4e8f77 2026-09-07 q5/u1,
  ('2309c1d6-8f21-42ea-b31a-324157013995'::uuid)  -- 9e023dd5 2026-09-08 q5/u0,
  ('a81242d4-24a2-43c7-814b-367d59677119'::uuid)  -- 846b0852 2026-09-09 q5/u1,
  ('1a14d07b-8d29-45d0-8ada-b805d2a50cf5'::uuid)  -- 331dd4bd 2026-09-10 q5/u0,
  ('4baea98f-5b5b-4b4b-89ae-d22f41328e17'::uuid)  -- 2eca2293 2026-09-10 q5/u3,
  ('f6f253aa-eea2-4b8b-a9e1-ad5db7773861'::uuid)  -- b048ba68 2026-09-11 q5/u0,
  ('f73c34a1-39f5-469c-8690-414d0a62be65'::uuid)  -- 21eb9c3c 2026-09-11 q5/u0,
  ('59f74572-5361-4843-b931-ed9ab41baaed'::uuid)  -- 765ea57d 2026-09-14 q5/u1,
  ('a78e8d50-3484-4f3f-a78b-7bf68f001935'::uuid)  -- 280e1b93 2026-09-14 q5/u2,
  ('2bfd403b-6660-485d-b040-301210202398'::uuid)  -- 1c699093 2026-09-15 q5/u0,
  ('d345bd77-63d0-473e-a241-b8022a07131d'::uuid)  -- 40dff114 2026-09-15 q5/u0,
  ('592ac584-0f2d-4369-9b7f-1d92d7f010f6'::uuid)  -- a0f4214b 2026-09-15 q5/u0,
  ('62b24f63-51fb-4378-83db-c70bc1e15520'::uuid)  -- a81929be 2026-09-17 q5/u1,
  ('103f04da-ec62-4348-8314-dd2feb7db046'::uuid)  -- d3ea9add 2026-09-17 q5/u0,
  ('043a2ad3-f37d-4d07-907b-f897f861fc9a'::uuid)  -- 70edd9fc 2026-09-17 q5/u0,
  ('f721cbad-6148-4661-a410-54ae8f55d4f4'::uuid)  -- 8959eb46 2026-09-17 q5/u0,
  ('0b08c89d-3b65-4774-81ae-5c6998db9ca5'::uuid)  -- d27c8b11 2026-09-17 q5/u0,
  ('d5086f96-0875-418d-906e-c7d30894cf9b'::uuid)  -- 4dfd5367 2026-09-17 q5/u0,
  ('911b6a79-ab05-4082-8026-49e12299d289'::uuid)  -- 0b5f8b8a 2026-09-17 q5/u0,
  ('3f35aff3-4525-409c-906f-6197d0ec0d48'::uuid)  -- 74434ed9 2026-09-17 q5/u0,
  ('01b5d9f8-3de3-4e00-ba12-b67e0bfb74ee'::uuid)  -- facd237a 2026-09-17 q5/u0,
  ('5d9ec74c-27f8-4dac-bea0-3e49d276b7c8'::uuid)  -- cd28b99c 2026-09-18 q5/u0,
  ('2b984cba-afaf-46a7-ba14-b7ef1fc9b02b'::uuid)  -- 0801d06d 2026-09-18 q5/u0
on conflict do nothing;
insert into hist_comp values
  ('006cf617-063c-43c9-8e0d-e759633ae8e6'::uuid)  -- 6123b1d9 2026-09-23 q1/u0,
  ('01559bd3-e872-4ef3-917a-40d0a929a62d'::uuid)  -- dccaa47e 2026-09-23 q1/u0,
  ('02de46cd-c6f6-4638-8d50-86157017f3a4'::uuid)  -- 8959eb46 2026-09-23 q1/u0,
  ('04b75660-bdc4-43e5-99ad-cdb5f841d313'::uuid)  -- a81929be 2026-09-23 q1/u0,
  ('050df966-6195-4799-9eba-68335e09325e'::uuid)  -- 280e1b93 2026-09-23 q1/u0,
  ('06ac08b4-c6db-4240-95d0-70e3d09dfbff'::uuid)  -- 741c8d0a 2026-09-23 q1/u0,
  ('06c80baf-cad7-4646-aefe-15c081349748'::uuid)  -- 62c611d2 2026-09-23 q1/u0,
  ('0725c71c-045c-4a74-ba77-66645c2c9f7b'::uuid)  -- 0c4b68aa 2026-09-23 q1/u0,
  ('08a2fca1-cd1a-4dc3-bba0-13eab6b383dd'::uuid)  -- 741c8d0a 2026-09-23 q1/u0,
  ('0ca77214-2184-4d93-a53d-61de5e100732'::uuid)  -- 88d6a20d 2026-09-23 q1/u0,
  ('0dd91e38-54c1-45a0-98d1-9bd9724b570e'::uuid)  -- ac8c6f1e 2026-09-23 q1/u0,
  ('0de2e51c-1af2-4767-80e0-432d4b2e6268'::uuid)  -- 6a581069 2026-09-23 q1/u0,
  ('149d44f3-d476-473b-83cb-5f033e20501f'::uuid)  -- 4e0f18b8 2026-09-23 q1/u0,
  ('1851f560-22cd-410d-8cce-975b3016c0aa'::uuid)  -- 88d6a20d 2026-09-23 q1/u0,
  ('1e5df110-8f17-47dc-ac0a-39985bac505e'::uuid)  -- 0814f3e1 2026-09-23 q1/u0,
  ('1fb5ccf8-5f1a-408f-afb9-938e9ad340d3'::uuid)  -- 197b9beb 2026-09-23 q1/u0,
  ('20c8c02b-e24a-4684-93ca-07f6548faaa7'::uuid)  -- 3f821801 2026-09-23 q1/u0,
  ('262e2b42-5505-48d5-8c50-1d3d7b053384'::uuid)  -- 746dd51b 2026-09-23 q1/u0,
  ('27d7ca38-a7c1-4ee2-bf59-e0728900efb9'::uuid)  -- ca53bf60 2026-09-23 q1/u0,
  ('27dec45a-2831-480c-984a-6b85d51eb1fa'::uuid)  -- 69c4b9a7 2026-09-23 q1/u0,
  ('29511bd7-3682-43e1-828c-431fa5d0481c'::uuid)  -- 163283e7 2026-09-23 q1/u0,
  ('29ab5158-1e24-46bc-bf6f-8aa2cb842a40'::uuid)  -- c45fcbea 2026-09-23 q1/u0,
  ('2e7ca46a-4989-4cb2-aff8-a810cad98c83'::uuid)  -- 6ad07f4a 2026-09-23 q1/u0,
  ('30887029-df43-4584-bf04-716cf8ce17c9'::uuid)  -- 0801d06d 2026-09-23 q1/u0,
  ('3111b96b-af8a-4da0-a0ed-56b623cc8fed'::uuid)  -- b048ba68 2026-09-23 q1/u0,
  ('348061f2-0403-4b77-becc-109a4600195b'::uuid)  -- 3e677bf8 2026-09-23 q1/u0,
  ('356b7bf3-fba4-4f21-a51e-d63d6d1cc0f6'::uuid)  -- d43997c7 2026-09-23 q1/u0,
  ('3592062e-9b20-442a-9fe9-d7aa4e767ff2'::uuid)  -- ca3eb988 2026-09-23 q1/u0,
  ('361d51f1-17a3-4a80-885d-450690d66b35'::uuid)  -- 4e0f18b8 2026-09-23 q1/u0,
  ('3b2c2fb8-9f48-40a8-a4b0-2330fdb0877f'::uuid)  -- 4dfd5367 2026-09-23 q1/u0,
  ('3ca9f27c-2221-4a6a-9104-e9251ac3082d'::uuid)  -- 74434ed9 2026-09-23 q1/u0,
  ('3cc25c6a-4be2-4194-b88e-f27f3134124a'::uuid)  -- 98c5235b 2026-09-23 q1/u0,
  ('3d8fe44e-9501-4b8f-a553-231c7b4b8b95'::uuid)  -- 69c4b9a7 2026-09-23 q1/u0,
  ('3db73221-7025-40f5-84f6-909b036cdf5e'::uuid)  -- 8d571787 2026-09-23 q1/u0,
  ('3e0dd69d-318e-4c4f-a624-a68f2f5ebc25'::uuid)  -- 7fd2d57e 2026-09-23 q1/u0,
  ('3ed40794-7908-454b-ae4d-a3458ae38638'::uuid)  -- ce73f5c6 2026-09-23 q1/u0,
  ('424434de-3284-4fc2-b97c-38800545026d'::uuid)  -- 846b0852 2026-09-23 q1/u0,
  ('46ad43e0-23f9-435a-86a3-3957cb5bdd89'::uuid)  -- 4e0f18b8 2026-09-23 q1/u0,
  ('4b1e5cb4-209b-4d12-9f9d-420f07d8c13a'::uuid)  -- cd28b99c 2026-09-23 q1/u0,
  ('4c5652e4-6190-4756-8d3c-688692f5f795'::uuid)  -- 5df76d6c 2026-09-23 q1/u0,
  ('4cbf73d1-4ca1-4cf2-b932-d4e209f4d04e'::uuid)  -- 22aec495 2026-09-23 q1/u0,
  ('50564f65-7a60-4e61-9429-d67da164b97d'::uuid)  -- 30cbc793 2026-09-23 q1/u0,
  ('5385807d-884f-40b7-864e-b0527554cad5'::uuid)  -- 6848a61a 2026-09-23 q1/u0,
  ('56b41d1c-0ee1-40bf-86f2-e4c70029c774'::uuid)  -- c1411476 2026-09-23 q1/u0,
  ('5b322a72-27f6-44d0-9d33-175f78aaf386'::uuid)  -- 4dfd5367 2026-09-23 q1/u0,
  ('5e6cedd5-89c2-4e0c-b53f-60d7a25a290c'::uuid)  -- 0b5f8b8a 2026-09-23 q1/u0,
  ('5ec2dc4f-3c42-4a9a-a188-29db7ab5207e'::uuid)  -- 5762c366 2026-09-23 q1/u0,
  ('5fa3fc7a-87c7-4960-8428-dd1659f44bf1'::uuid)  -- b43d6616 2026-09-23 q1/u0,
  ('62d29820-403c-47a5-bc86-555b18152ebd'::uuid)  -- 75053331 2026-09-23 q1/u0,
  ('696cbee3-5d8c-4638-b9ef-357f314f1a90'::uuid)  -- b048ba68 2026-09-23 q1/u0,
  ('69b49ab5-73cc-4821-b796-2daccc38865c'::uuid)  -- 7007b235 2026-09-23 q1/u0,
  ('6a5a00f4-6404-4e44-9396-b8ce531ebe29'::uuid)  -- 1c699093 2026-09-23 q1/u0,
  ('70527b83-2c80-4f8e-9e37-1dc7acf3f459'::uuid)  -- 2cb5d9c8 2026-09-23 q1/u0,
  ('714b2385-48fd-4e5e-8eb3-377702757acc'::uuid)  -- dfd48dc3 2026-09-23 q1/u0,
  ('752eab22-d5dd-4f58-ad12-d39177bf1bde'::uuid)  -- b048ba68 2026-09-23 q1/u0,
  ('75972a35-b045-4eda-bfd2-908dd1d51ac8'::uuid)  -- 0dd1181a 2026-09-23 q1/u0,
  ('79991ac4-8b90-41be-89d6-965d389a1cdf'::uuid)  -- 847b0c59 2026-09-23 q1/u0,
  ('7acc713d-4e7d-4c39-84e1-99e408db4932'::uuid)  -- 75053331 2026-09-23 q1/u0,
  ('7bb884ad-fdf2-4efd-a618-c6a2dd610eca'::uuid)  -- d3ea9add 2026-09-23 q1/u0,
  ('816c9276-7d84-43e3-bb34-1607dfbc1333'::uuid)  -- d0d4c4ee 2026-09-23 q1/u0,
  ('8416fcc5-c501-4706-8969-a61398b315f9'::uuid)  -- 331dd4bd 2026-09-23 q1/u0,
  ('86574f2d-1365-4bb4-a0f3-9859bb4b1021'::uuid)  -- 7c7672ea 2026-09-23 q1/u0,
  ('867c05c0-4657-479f-b924-f771f509056a'::uuid)  -- facd237a 2026-09-23 q1/u0,
  ('88af634a-f0ca-4bf4-8a4e-c6845960f9d6'::uuid)  -- b43d6616 2026-09-23 q1/u0,
  ('89374d03-3441-4b82-a404-f4a012cef8f0'::uuid)  -- a69747c8 2026-09-23 q1/u0,
  ('8940d7ea-80b8-411e-8f12-f18245b65ce3'::uuid)  -- dd9fd7c9 2026-09-23 q1/u0,
  ('898e4c13-152a-4db4-be0c-fb86bf220ef7'::uuid)  -- 62c611d2 2026-09-23 q1/u0,
  ('8b84198c-406b-4902-a8c2-26f84faf6ff1'::uuid)  -- 05902e1f 2026-09-23 q1/u0,
  ('8c794122-f35b-4274-8954-06d397422b35'::uuid)  -- 62c611d2 2026-09-23 q1/u0,
  ('8e2e2504-249c-49a0-a78b-72a1218b2efc'::uuid)  -- 080ec9b5 2026-09-23 q1/u0,
  ('8ee08a3f-af5a-4bb6-a01e-f51193101203'::uuid)  -- 07e2221b 2026-09-23 q1/u0,
  ('9034d197-cf4c-413f-ac47-46452368e891'::uuid)  -- 6848a61a 2026-09-23 q1/u0,
  ('91325931-7470-4736-a893-61462ea91c85'::uuid)  -- a0f4214b 2026-09-23 q1/u0,
  ('95f3781f-0495-4360-b66d-c19219c70eab'::uuid)  -- 7fd2d57e 2026-09-23 q1/u0,
  ('97fbb1f0-6743-4f0a-8ba9-8a560cb335de'::uuid)  -- 847b0c59 2026-09-23 q1/u0,
  ('98adcde9-fd64-4e44-a1ad-6536669ae4e9'::uuid)  -- 88d6a20d 2026-09-23 q1/u0,
  ('9983227c-e38c-4279-b211-23f677da466f'::uuid)  -- 331dd4bd 2026-09-23 q1/u0,
  ('a0330cdd-df16-441b-874f-1044c3a661e6'::uuid)  -- d27c8b11 2026-09-23 q1/u0,
  ('a1234dde-9b8c-400b-b693-711c7030d028'::uuid)  -- dccaa47e 2026-09-23 q1/u0,
  ('a39f27b5-64d2-4a52-94bd-222bcd0b8967'::uuid)  -- b7f7492c 2026-09-23 q1/u0,
  ('a43924e4-f960-42ed-91cb-e5fe8343579f'::uuid)  -- c1411476 2026-09-23 q1/u0,
  ('a4449993-d305-471b-b4e4-6142eae1eb0f'::uuid)  -- 4318896e 2026-09-23 q1/u0,
  ('a4868ff3-ad16-49d9-9f53-82d318b157c1'::uuid)  -- 37afa669 2026-09-23 q1/u0,
  ('a687838d-46c0-4185-9a58-949e9bfee761'::uuid)  -- c2a79f1c 2026-09-23 q1/u0,
  ('a7dd5752-20ca-416e-a917-2b1df983b2c5'::uuid)  -- 9e023dd5 2026-09-23 q1/u0,
  ('a9b8aee7-fc23-4a39-85b5-6bea62a61d11'::uuid)  -- 64c37944 2026-09-23 q1/u0,
  ('ad1672b8-7398-47ff-893c-a15892672cbf'::uuid)  -- 765ea57d 2026-09-23 q1/u0,
  ('adc51213-3a79-411f-a967-d808404552cd'::uuid)  -- 40dff114 2026-09-23 q1/u0,
  ('aeaaef53-d0bb-4c31-a225-3a62e736116a'::uuid)  -- 43030c3c 2026-09-23 q1/u0,
  ('b2827371-000c-48c1-98da-ee37e7599b8f'::uuid)  -- fcb1d3ad 2026-09-23 q1/u0,
  ('b34bf2d4-0ae0-4f9c-8539-d98d463afc85'::uuid)  -- 672c525b 2026-09-23 q1/u0,
  ('b35e9f30-3e3b-475a-8949-5af469131c7f'::uuid)  -- 0dd1181a 2026-09-23 q1/u0,
  ('b3c013d1-3b1c-44f7-b2b0-0438d694b90b'::uuid)  -- 9918e043 2026-09-23 q1/u0,
  ('baa38d5b-d731-406d-a5a4-9dde72a754cd'::uuid)  -- 98c5235b 2026-09-23 q1/u0,
  ('bae1d23d-3e14-4385-8171-4917a8a8b232'::uuid)  -- 5fcee9aa 2026-09-23 q1/u0,
  ('bc4c6b15-fef2-4f0d-976f-6d9eaab97d61'::uuid)  -- 265eac49 2026-09-23 q1/u0,
  ('c3452160-7de1-4706-9140-9df5401166e8'::uuid)  -- b45239a3 2026-09-23 q1/u0,
  ('c3fae986-3637-43b3-9c53-224f95efb0a2'::uuid)  -- 2a9ba343 2026-09-23 q1/u0,
  ('c8a1d9bf-9a17-48f9-ae11-3e3250ca9679'::uuid)  -- 6ad07f4a 2026-09-23 q1/u0,
  ('cd5094fa-0a7e-44d6-b9be-ca940666d6d6'::uuid)  -- 4db0c153 2026-09-23 q1/u0,
  ('d442bfd5-adf6-49ab-8cd2-64cf95cbe3e5'::uuid)  -- 09090bd6 2026-09-23 q1/u0,
  ('d54e6ab2-6d90-42ab-b071-872f781feaf5'::uuid)  -- 2eca2293 2026-09-23 q1/u0,
  ('d7faae0f-625c-4ace-8504-d7df6da83a92'::uuid)  -- 95914993 2026-09-23 q1/u0,
  ('dac25453-685e-4675-9701-bec21326ea49'::uuid)  -- 36a2d1a9 2026-09-23 q1/u0,
  ('dad9300a-448a-4883-886c-af71eb75cab4'::uuid)  -- 4dfd5367 2026-09-23 q1/u0,
  ('dbc7cb01-14f2-4950-954d-256b94cd8e95'::uuid)  -- 21eb9c3c 2026-09-23 q1/u0,
  ('dd7812f7-e3b5-4e58-b4f5-533f1195e37e'::uuid)  -- 0901b5ac 2026-09-23 q1/u0,
  ('defab9be-ee5e-47d2-a5fd-2b064729db00'::uuid)  -- 3c4e8f77 2026-09-23 q1/u0,
  ('e4cf9d7c-c785-4002-8a79-54f215fc43d7'::uuid)  -- b43d6616 2026-09-23 q1/u0,
  ('e74a3dbd-c99e-410d-8774-aaee04b342ea'::uuid)  -- 70edd9fc 2026-09-23 q1/u0,
  ('e7642613-9147-4521-bc5d-6b1492cb4869'::uuid)  -- 91d3877f 2026-09-23 q1/u0,
  ('e7ab345c-1213-4fba-9589-20d34f38ef52'::uuid)  -- 85a4e06a 2026-09-23 q1/u0,
  ('e8c05b0d-fc53-4d41-bf70-06b594e8d2f3'::uuid)  -- 197b9beb 2026-09-23 q1/u0,
  ('e901ea7c-40e4-4809-8a31-62cbe0c4dba6'::uuid)  -- b345e9da 2026-09-23 q1/u0,
  ('ee481fee-15a5-4c41-a8fa-96a000702c82'::uuid)  -- 7c7672ea 2026-09-23 q1/u0,
  ('f1acbbd7-5ace-45e7-bb70-fcc43b1d76bc'::uuid)  -- 765ea57d 2026-09-23 q1/u0,
  ('f1f16e93-9916-4d11-bead-3795d388df10'::uuid)  -- 22aec495 2026-09-23 q1/u0,
  ('f20b90c3-13c2-4ac8-925c-f304e8f6a715'::uuid)  -- 163283e7 2026-09-23 q1/u0,
  ('f49cb7d8-ca5c-46a9-ada4-35e29ac2b617'::uuid)  -- 8676ec94 2026-09-23 q1/u0,
  ('f5cdb117-bc4c-4752-abe7-925f5124744a'::uuid)  -- bd879c50 2026-09-23 q1/u0,
  ('f74fa476-1263-46ef-9a0e-4394423038b2'::uuid)  -- 05902e1f 2026-09-23 q1/u0,
  ('f954a2bd-73dd-481a-8810-191a06a0ad17'::uuid)  -- 3f2e7d5f 2026-09-23 q1/u0,
  ('fa4e25df-ef68-4935-9e5f-7a1cef147ba2'::uuid)  -- e961eac3 2026-09-23 q1/u0
on conflict do nothing;
insert into hist_legacy values
  ('46d920fa-40e7-408f-82df-cd44f7c46337'::uuid)  -- 163283e7 2026-09-15 q1/u0,
  ('aedb02e4-9859-492e-a31d-26c1554f5f57'::uuid)  -- 2a9ba343 2026-07-09 q1/u0,
  ('d481abfe-c6d6-43f3-b5f3-edee6f121c0c'::uuid)  -- 3f821801 2026-09-15 q1/u0
on conflict do nothing;

-- ── CZĘŚĆ A: uzgodnienie z dzisiejszą bazą (tylko odczyt) ──────────────
-- A1. Czy wszystkie id istnieją i jak wyglądają dziś (oczekiwane: brakujących 0; plan/qty/cena/ważność jak w archiwum; qty_used może być większe)
select lista, count(*) as w_archiwum, count(p.id) as w_bazie, count(*) - count(p.id) as brakujacych,
       sum(case when p.source = 'grant' then 1 else 0 end) as juz_oznaczone_grant,
       sum(case when p.plan is distinct from oczek_plan or p.price_paid <> 0 or p.expires_at <> date '2026-12-31' then 1 else 0 end) as niezgodne
from (select id, 'rejestracja' lista, 'std_5' oczek_plan from hist_reg
      union all select id, 'rekompensata', 'std_1' from hist_comp
      union all select id, 'nieustalone', 'std_1' from hist_legacy) h
left join public.packages p on p.id = h.id
group by lista order by lista;

-- A2. Rekompensaty po znaczniku — czy w bazie nie ma więcej/mniej niż w archiwum (oczekiwane: 123 i 123, roznica_id = 0)
select (select count(*) from public.packages where payment_ref like 'compensation:fm2026:%') as w_bazie_po_znaczniku,
       (select count(*) from hist_comp) as w_archiwum,
       (select count(*) from public.packages p where p.payment_ref like 'compensation:fm2026:%' and p.id not in (select id from hist_comp)) as roznica_id;

-- A3. Pakiety z ceną 0 / bez referencji, których NIE MA na żadnej liście (oczekiwane: 0 — jeśli >0, wyjaśnić przed częścią B)
select p.id, c.name, p.plan, p.qty_total, p.qty_used, p.purchased_at, p.expires_at, p.payment_ref
from public.packages p join public.companies c on c.id = p.company_id
where (p.price_paid = 0 or p.price_paid is null or p.payment_ref is null)
  and p.id not in (select id from hist_reg union all select id from hist_comp union all select id from hist_legacy)
order by p.purchased_at;

-- A4. Podsumowanie sald tych list dziś (do notatki; nic z tego nie zmienia część B)
select lista, count(*) as pakietow, sum(p.qty_total) as kredytow, sum(p.qty_used) as zuzytych, sum(p.qty_total - p.qty_used) as pozostalych
from (select id, 'rejestracja' lista from hist_reg union all select id, 'rekompensata' from hist_comp union all select id, 'nieustalone' from hist_legacy) h
join public.packages p on p.id = h.id group by lista order by lista;

-- ── CZĘŚĆ B: odnotowanie historii (zapis przez RPC; po migracji, po akceptacji A) ──
-- Wykonuje admin z SQL Editora: p_recorded_by = id profilu admina (autor ODNOTOWANIA, nie pierwotnego przyznania).
-- RPC nie zmienia qty/qty_used/expires_at, nie tworzy banera (grant_seen_at = now()), nie zwiększa salda.
-- Powtórka z tym samym kluczem = already_done. Odkomentować po decyzji.
--
-- select public.admin_record_historical_grants('registration', (select array_agg(id) from hist_reg),
--   'hist-registration-2026-09-27', 'Prezent rejestracyjny FM 2026 — odnotowanie historii wg archiwum 23.09 (75 pakietów)',
--   (select id from public.profiles where email = 'artur.stasiak@freshmarket.eu' and role = 'admin'));
-- select public.admin_record_historical_grants('compensation', (select array_agg(id) from hist_comp),
--   'hist-compensation-2026-09-27', 'Rekompensata za nieobecne sieci (Biedronka 46, Mega Image 52, Stokrotka 25) — wykonana 23.09 11:52, odnotowanie historii',
--   (select id from public.profiles where email = 'artur.stasiak@freshmarket.eu' and role = 'admin'));
-- select public.admin_record_historical_grants('legacy', (select array_agg(id) from hist_legacy),
--   'hist-legacy-2026-09-27', 'Pakiety std_1 z ceną 0 bez referencji — źródło nieustalone, opis neutralny',
--   (select id from public.profiles where email = 'artur.stasiak@freshmarket.eu' and role = 'admin'));
--
-- Kontrola po części B (oczekiwane: rejestracja 75 grant/registration, rekompensata 123 grant/compensation, nieustalone 3 legacy; saldo A4 bez zmian):
-- select source, grant_reason, grant_historical, count(*), sum(qty_total), sum(qty_used) from public.packages group by 1,2,3 order by 1,2;
