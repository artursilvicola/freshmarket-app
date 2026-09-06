-- ============================================================================
-- 052_staff_role.sql
-- [feat/fm-queue] Rola `staff` (obsluga eventu) — WYLACZNIE dodanie wartosci
-- do ENUM public.user_role. Nic wiecej w tej migracji.
--
-- Dlaczego osobno: nowej wartosci ENUM nie wolno uzyc w tej samej transakcji,
-- w ktorej zostala dodana (PostgreSQL). Polityki, funkcje i handle_new_user,
-- ktore uzywaja 'staff', sa w 053_fm_queue.sql.
--
-- APLIKOWAC RECZNIE w Supabase SQL Editor, jako OSOBNE uruchomienie,
-- PRZED 053. Bez BEGIN/COMMIT (ALTER TYPE ... ADD VALUE nie moze byc
-- w jawnym bloku transakcji w starszych wersjach; idempotentne przez IF NOT EXISTS).
-- Migracje NIE sa uruchamiane automatycznie z gita.
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'staff';

-- Kontrola:
-- select enum_range(null::public.user_role);
--   -> {admin,supplier,buyer,staff}
