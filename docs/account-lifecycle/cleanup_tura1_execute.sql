-- ===========================================================================
-- Tura 1 — PLIK WYKONAWCZY (SZABLON). NIE URUCHAMIAĆ "JAK JEST".
-- ===========================================================================
-- ⛔ WSZYSTKIE DELETE SĄ ZAKOMENTOWANE. Ten plik nic nie kasuje dopóki ręcznie
--    nie odkomentujesz linii DELETE i nie zmienisz ROLLBACK → COMMIT.
--
-- WARUNKI WEJŚCIA (wszystkie muszą być spełnione, w tej kolejności):
--   1. Pełny backup bazy (Supabase → Database → Backups: snapshot / PITR).
--   2. Backup logiczny 17 firm do CSV (cleanup_tura1_dryrun.sql, ZAPYTANIE D).
--   3. DRY-RUN: ZAPYTANIE A = wszędzie 0/0/0/0 (zero finansów).
--   4. Najlepiej: wykonać najpierw na SANDBOXIE (kopia bazy), nie od razu prod.
--   5. Sign-off Artura na liczby z ZAPYTANIA B.
--
-- ZAKRES: tylko 17 firm "USUŃ TURA 1". Unica/Pik/OKSALE i KJOW/admin NIETKNIĘTE.
-- ===========================================================================

-- Transakcja: domyślnie kończy się ROLLBACK (nic nie zostaje zapisane).
-- Dopiero po sprawdzeniu, że liczby się zgadzają, zmień ostatnią linię na COMMIT.
BEGIN;

-- Lista 17 firm (jedyne źródło). legacy_supplier_id / profile.id wyliczane z niej.
-- (W realnym uruchomieniu trzymaj tę listę w jednym miejscu — np. tymczasowej
--  tabeli — albo powtórz podzapytanie w każdym DELETE.)
--
--   companies do usunięcia:
--     ce29858e-2344-453b-a485-4b2b9e29bcbb  df78bad1-64a9-4809-9c06-fab7bb697d43
--     8bbc4f7f-2eba-49bc-8600-f0e1c1ed87d8  6a71aa14-701f-4475-85be-ba6da902f6f9
--     11111111-1111-1111-1111-111111111111  c4633c15-5b94-45a6-a7e4-d6b17c9613a0
--     eca5955a-c45b-4d56-a481-ea93426259fb  a8656d6a-1bd9-4ce8-89db-6f1487926a9c
--     e965d577-481f-4ef6-b5a4-2f14d9bc8227  6626ac84-6a9c-40b5-af9c-b648043e6999
--     6a39171a-b8ee-4cb5-911c-fa4c83ac3b4a  6dd7d223-fef9-4d7a-abbd-8722f93250f4
--     b001b010-7310-42c5-9754-2058e06b1d95  70c10dbb-cd9c-4eb7-ab24-af0fc6070478
--     4d3ddc85-6148-49d4-9a8a-340241060bcc  a6365067-785f-4009-a5b7-6e6b24133648
--     6d3ef58a-03ea-4819-bbf4-6bf4074d84df

-- Pomocniczy alias listy (do podzapytań poniżej):
--   (SELECT id FROM companies WHERE id IN ( ...17 uuid... ))            -- company_id
--   (SELECT legacy_supplier_id FROM companies WHERE id IN (...) AND legacy_supplier_id IS NOT NULL)
--   (SELECT id FROM profiles  WHERE company_id IN (...))                 -- auth user ids


-- ── KROK 1: legacy_sends / legacy_offers (BRAK FK → trzeba usunąć JAWNIE) ─────
-- DELETE FROM legacy_sends
--   WHERE supplier_legacy_id IN (
--     SELECT legacy_supplier_id FROM companies
--      WHERE id IN ( /* 17 uuid */ ) AND legacy_supplier_id IS NOT NULL );
--
-- DELETE FROM legacy_offers
--   WHERE supplier_legacy_id IN (
--     SELECT legacy_supplier_id FROM companies
--      WHERE id IN ( /* 17 uuid */ ) AND legacy_supplier_id IS NOT NULL );

-- ── KROK 1b (OPCJONALNIE): wiadomości testów (inaczej zostaną osierocone) ─────
-- DELETE FROM fm_messages
--   WHERE from_user_id IN (SELECT id FROM profiles WHERE company_id IN ( /* 17 */ ))
--      OR to_user_id   IN (SELECT id FROM profiles WHERE company_id IN ( /* 17 */ ));

-- ── KROK 2: profiles (konta-loginy w aplikacji) ──────────────────────────────
-- DELETE FROM profiles WHERE company_id IN ( /* 17 uuid */ );

-- ── KROK 3: companies (kaskaduje packages / payu_orders / company_buyers) ─────
-- UWAGA: proformas.company_id → NULL (osierocenie, ale tu i tak proformas=0).
-- DELETE FROM companies WHERE id IN ( /* 17 uuid */ );


-- ⛔ ZOSTAW ROLLBACK do czasu pełnej weryfikacji. Zmień na COMMIT świadomie.
ROLLBACK;
-- COMMIT;


-- ===========================================================================
-- KROK 4 — auth.users (OSOBNY, RĘCZNY krok — NIE tutaj jako zwykły SQL)
-- ===========================================================================
-- Usunięcie samych profili NIE usuwa loginów z Supabase Auth. Loginy
-- (auth.users) usuń OSOBNO, dla user_id z dry-run ZAPYTANIE C, przez:
--   • Supabase Dashboard → Authentication → Users → (usuń pojedynczo), lub
--   • Admin API: supabase.auth.admin.deleteUser(userId) (service role, skrypt),
-- po potwierdzeniu, że profile/companies już usunięte.
-- Rób to DOPIERO po KROKU 1-3 i po sprawdzeniu, że to na pewno konta testowe.
