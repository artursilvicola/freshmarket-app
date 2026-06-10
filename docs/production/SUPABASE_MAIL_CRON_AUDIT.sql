-- ===========================================================================
-- SUPABASE_MAIL_CRON_AUDIT.sql
-- Audyt po incydencie mailowym 2026-06-10 (równoległy system freshmarketb2b).
-- Powiązane: docs/production/EMAIL_INCIDENT_2026-06-10_PARALLEL_SYSTEM.md
-- ===========================================================================
--
-- ⚠️  TYLKO ODCZYT. Same SELECT-y. Plik NIC nie zmienia:
--     ZERO  UPDATE / DELETE / INSERT / ALTER / DROP
--     ZERO  cron.schedule / cron.unschedule / cron.alter_job
--     ZERO  wysyłki maili.
--
-- Cel: pokazać informatykowi, CO w bazie potrafi samodzielnie wysyłać maile
--      (crony + funkcje DB), żeby żaden „duch" nie wysyłał spod radaru.
--
-- Jak uruchomić: Supabase → SQL Editor → wklej całość lub pojedyncze sekcje.
--                Wymaga roli z dostępem do schematu `cron` (pg_cron) i `pg_catalog`.
-- ===========================================================================


-- ── 1. AKTYWNE CRONY (pg_cron) ─────────────────────────────────────────────
-- Pełna lista zaplanowanych zadań. Kolumna `active` = czy job jest włączony.
-- Tu powinno NIE być już `fm-14d-reminder` (został wyłączony przez unschedule).
SELECT jobid,
       jobname,
       schedule,           -- np. '0 9 * * *' = 09:00 UTC codziennie
       active,
       database,
       username,
       command             -- co dokładnie odpala (zwykle SELECT public.<funkcja>())
FROM cron.job
ORDER BY active DESC, jobname;


-- ── 2. FUNKCJE DB ZAWIERAJĄCE send / email / reminder ──────────────────────
-- Skan po NAZWIE oraz po TREŚCI funkcji (źródło). Łapie wszystko, co może
-- dotykać wysyłki maili: net.http_post do Edge Function, słowa email/reminder.
SELECT n.nspname                AS schema,
       p.proname                AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       l.lanname                AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (
        p.proname        ILIKE '%send%'
     OR p.proname        ILIKE '%email%'
     OR p.proname        ILIKE '%mail%'
     OR p.proname        ILIKE '%remind%'
     OR p.proname        ILIKE '%notify%'
     OR pg_get_functiondef(p.oid) ILIKE '%send-email%'      -- wywołanie Edge Function
     OR pg_get_functiondef(p.oid) ILIKE '%net.http_post%'   -- każdy HTTP POST z bazy
     OR pg_get_functiondef(p.oid) ILIKE '%functions/v1/%'   -- każde wołanie Edge Function
  )
ORDER BY n.nspname, p.proname;


-- ── 3. FUNKCJE PODOBNE DO fm_14d_reminder_job (rodzina fm_*) ────────────────
-- Cały „równoległy system" nazewniczo używa prefiksu fm_. Lista + sygnatura.
-- Żeby zobaczyć PEŁNE źródło wybranej funkcji (read-only), użyj:
--     SELECT pg_get_functiondef('public.fm_14d_reminder_job'::regproc);
--     SELECT pg_get_functiondef('public.fm_notify_send_email'::regproc);
SELECT n.nspname                AS schema,
       p.proname                AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       CASE p.prokind WHEN 'f' THEN 'function'
                      WHEN 'p' THEN 'procedure'
                      WHEN 'a' THEN 'aggregate'
                      WHEN 'w' THEN 'window' END AS kind,
       p.prosecdef              AS security_definer   -- true = uruchamia się z prawami właściciela
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ILIKE 'fm\_%'      -- wszystkie funkcje rodziny fm_*
ORDER BY p.proname;


-- ── 3b. TRIGGERY, które mogą wołać Edge Function / wysyłać maile ────────────
-- Triggery na tabelach (np. fm_trigger_legacy_sends_email) odpalające funkcje
-- z sekcji 2/3. Pokazuje tabelę, trigger i wywoływaną funkcję.
SELECT t.tgname                              AS trigger_name,
       c.relname                             AS on_table,
       n.nspname                             AS schema,
       p.proname                             AS calls_function,
       pg_get_triggerdef(t.oid)              AS trigger_def
FROM pg_trigger t
JOIN pg_class     c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc      p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (
        p.proname ILIKE '%email%' OR p.proname ILIKE '%mail%'
     OR p.proname ILIKE '%send%'  OR p.proname ILIKE '%notify%'
     OR pg_get_functiondef(p.oid) ILIKE '%send-email%'
     OR pg_get_functiondef(p.oid) ILIKE '%net.http_post%'
  )
ORDER BY c.relname, t.tgname;


-- ── 4. JOBY pg_cron Z KOMENDAMI + historia ostatnich uruchomień ────────────
-- 4a. Komendy wszystkich jobów (powtórzenie listy z sekcji 1, sam command).
SELECT jobid, jobname, schedule, active, command
FROM cron.job
ORDER BY jobid;

-- 4b. Ostatnie uruchomienia jobów (czy i kiedy coś realnie się odpaliło).
--     Jeśli brak uprawnień do cron.job_run_details — pominąć tę sekcję.
SELECT jrd.jobid,
       j.jobname,
       jrd.status,             -- succeeded / failed
       jrd.return_message,
       jrd.start_time,
       jrd.end_time
FROM cron.job_run_details jrd
LEFT JOIN cron.job j ON j.jobid = jrd.jobid
ORDER BY jrd.start_time DESC
LIMIT 50;


-- ── 5. (OPCJONALNE) Log HTTP z bazy do Edge Function ───────────────────────
-- pg_net zapisuje odpowiedzi każdego net.http_post. Pozwala zobaczyć, ile
-- realnie poszło wywołań do send-email i z jakim kodem odpowiedzi.
-- Jeśli rozszerzenie pg_net / tabela net._http_response niedostępne — pominąć.
SELECT id, status_code, created,
       LEFT(COALESCE(content, ''), 200) AS content_preview
FROM net._http_response
ORDER BY created DESC
LIMIT 50;


-- ===========================================================================
-- KONIEC. Plik wykonuje wyłącznie SELECT-y — nie modyfikuje danych,
-- nie zmienia harmonogramu cron i nie wysyła żadnych maili.
-- ===========================================================================
