-- [fix/buyer-entry-seen] WYCOFANIE MIGRACJI 20261113120000 — uruchamiać TYLKO po cofnięciu kodu
-- (Netlify → Deploys → opublikuj poprzedni deploy 6af2db23 = main 9c8e747) i tylko, gdy to potrzebne.
-- Stary kod tych funkcji nie woła, więc mogą zostać w bazie bez skutków; usunięcie jest opcjonalne.
-- NIE cofa rozliczeń wykonanych w czasie działania nowego kodu — te koryguje się przyciskiem
-- „Cofnij potwierdzenie” (przed cofnięciem kodu) albo bezpłatnym kredytem od organizatora.
drop function if exists public.undo_legacy_send_manual_confirm(uuid, timestamptz);
drop function if exists public.confirm_legacy_send_manual(uuid, uuid, text, text, timestamptz);
