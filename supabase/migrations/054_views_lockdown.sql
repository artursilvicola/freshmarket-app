-- ============================================================================
-- 054_views_lockdown.sql — PILNE: koniec publicznego dostępu przez widoki
-- (wydzielone z hotfixu 055 na wniosek Codexa, review 16.09.2026)
-- ============================================================================
-- Stan na produkcji 16.09: widoki poniżej mają właściciela postgres i domyślne
-- uprawnienia projektu (anon/authenticated: SELECT + INSERT/UPDATE/DELETE), a bez
-- security_invoker czytają tabele Z POMINIĘCIEM RLS. Skutki:
--   * anon czyta consent_audit (e-maile 24 kupców) i v_admin_registrations;
--   * consent_audit to prosty widok na profiles → jest aktualizowalny, więc anon
--     ma prawo DELETE/UPDATE przez widok bez RLS profiles.
-- Zmiana:
--   1. security_invoker = true → RLS tabel bazowych obowiązuje także przez widok
--      (company_capacity: anon 0 wierszy, dostawca jak katalog companies, admin
--      wszystko; v_admin_*: przez RLS event_registrations → nie-admin widzi tylko
--      własne rejestracje);
--   2. revoke INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER przez widoki;
--   3. anon bez SELECT na consent_audit i v_admin_*.
-- Bez zmian: SELECT authenticated (admin czyta jak dotąd), articles_with_facts
-- (publiczne newsy) — tylko odbieramy prawa zapisu. Idempotentna; widoki spoza
-- tego repo (druga aplikacja, scraper) są pomijane, jeśli nie istnieją.
-- Nie dotyka danych, wyborów, planu ani maili.
-- ============================================================================
begin;

do $$
declare v text;
begin
  foreach v in array array['consent_audit', 'company_capacity', 'v_admin_registrations', 'v_admin_stats'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v);
    end if;
  end loop;
  foreach v in array array['consent_audit', 'company_capacity', 'v_admin_registrations', 'v_admin_stats', 'articles_with_facts'] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v);
    end if;
  end loop;
  foreach v in array array['consent_audit', 'v_admin_registrations', 'v_admin_stats'] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke select on public.%I from anon', v);
    end if;
  end loop;
end $$;

-- ślad (pomijany w pustej bazie testowej bez administratora)
insert into public.audit_log (user_id, action, entity, entity_id, meta)
select coalesce(auth.uid(), a.id), 'security_views_lockdown', 'migration', '054',
       jsonb_build_object('views', array['consent_audit', 'company_capacity', 'v_admin_registrations', 'v_admin_stats', 'articles_with_facts'])
  from (select id from public.profiles where role = 'admin' order by created_at limit 1) a;

commit;

-- Kontrola po zastosowaniu (SQL Editor):
--   select relname, reloptions from pg_class where relname in ('consent_audit','company_capacity','v_admin_registrations','v_admin_stats');
--   select table_name, grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
--    where table_name in ('consent_audit','company_capacity','v_admin_registrations','v_admin_stats','articles_with_facts')
--      and grantee in ('anon','authenticated') group by 1,2 order by 1,2;
-- Oczekiwane: reloptions = {security_invoker=true}; anon: SELECT tylko na
-- company_capacity i articles_with_facts; authenticated: tylko SELECT.
