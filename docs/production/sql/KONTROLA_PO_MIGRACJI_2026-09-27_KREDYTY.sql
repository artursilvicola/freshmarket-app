-- =====================================================================
-- KONTROLA PO MIGRACJI 20260927120000_free_credit_grants — TYLKO ODCZYT
-- Każde zapytanie ma kolumnę `oczekiwane`. Wdrożenie kodu dopiero,
-- gdy wszystko się zgadza.
-- =====================================================================

-- A. Kolumny packages: 7 nowych, BEZ grant_note ------------------------
select array_agg(column_name order by column_name) as kolumny,
       count(*) filter (where column_name in ('source','grant_reason','grant_message','granted_by','granted_at','grant_batch_id','grant_seen_at','grant_historical','grant_recorded_by','grant_recorded_at')) as nowych,
       '10 nowych, brak grant_note' as oczekiwane
from information_schema.columns
where table_schema = 'public' and table_name = 'packages'
  and (column_name like 'grant%' or column_name in ('source','granted_by','granted_at'));

-- B. Stare wiersze = purchase (DEFAULT), zero grant ---------------------
select source, grant_reason, grant_historical, count(*), sum(qty_total), sum(qty_used)
from public.packages group by 1,2,3 order by 1,2;
-- oczekiwane TUŻ PO MIGRACJI: tylko purchase. PO ODNOTOWANIU HISTORII (krok 4b): grant/registration/true = 75,
-- grant/compensation/true = 123, legacy = 3, reszta purchase; sumy qty_total/qty_used identyczne jak w części A4 uzgodnienia.

-- C. Plan katalogowy grant: nieaktywny, cena 0 --------------------------
select id, tier, qty, price_eur, active, '(grant, STANDARD, 1, 0, false)' as oczekiwane
from public.package_plans where id = 'grant';

-- D. Funkcje i uprawnienia ----------------------------------------------
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role,
       case p.proname
         when 'admin_grant_free_credits'            then 'anon=f auth=t svc=t'
         when 'admin_record_historical_grants'      then 'anon=f auth=t svc=t'
         when 'mark_credit_grant_seen'              then 'anon=f auth=t svc=t'
         when 'charge_legacy_send_first_seen'       then 'anon=f auth=f svc=t'
         when 'mark_legacy_send_seen'               then 'anon=f auth=f svc=t'
         when 'mark_legacy_sends_supplier_notified' then 'anon=f auth=f svc=t'
         when 'business_today'                      then 'wszyscy t'
       end as oczekiwane
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_grant_free_credits','admin_record_historical_grants','mark_credit_grant_seen','charge_legacy_send_first_seen',
                    'mark_legacy_send_seen','mark_legacy_sends_supplier_notified','business_today')
order by p.proname;

-- E. Historia partii: RLS włączone, tylko polityka SELECT dla admina -----
select c.relname, c.relrowsecurity as rls,
       (select string_agg(policyname || ':' || cmd, ', ') from pg_policies where tablename = 'package_grant_batches') as polityki,
       'rls=t, package_grant_batches_admin_select:SELECT' as oczekiwane
from pg_class c where c.relname = 'package_grant_batches';
select grantee, string_agg(privilege_type, ',') as prawa, 'authenticated: tylko SELECT; anon: nic' as oczekiwane
from information_schema.role_table_grants
where table_name = 'package_grant_batches' and grantee in ('anon','authenticated') group by grantee;

-- F. Widok company_capacity: security_invoker, dzień biznesowy, nowe kolumny
select reloptions::text like '%security_invoker=true%' as security_invoker,
       pg_get_viewdef('public.company_capacity'::regclass) like '%business_today()%' as dzien_biznesowy,
       pg_get_viewdef('public.company_capacity'::regclass) not like '%current_date%' as bez_current_date,
       (select count(*) from information_schema.columns where table_name = 'company_capacity'
         and column_name in ('qty_remaining_free','qty_remaining_paid','qty_total_free','qty_total_paid','free_expiry','paid_expiry','qty_remaining_legacy')) as nowe_kolumny,
       't, t, t, 7' as oczekiwane
from pg_class where relname = 'company_capacity';

-- G. Dzień biznesowy = dzisiejsza data w Warszawie ----------------------
select public.business_today() as dzien_biznesowy, now() at time zone 'Europe/Warsaw' as teraz_warszawa;

-- H. Suma pojemności w widoku bez zmian wobec stanu sprzed migracji ------
select sum(qty_remaining) as kredyty_wolne, sum(qty_remaining_free) as bezplatne, sum(qty_remaining_paid) as kupione, sum(qty_remaining_legacy) as nieustalone,
       'tuż po migracji: bezplatne = 0; po kroku 4b: bezplatne = pozostałe z 75+123, nieustalone = pozostałe z 3; kredyty_wolne ZAWSZE = kredyty_wolne_dzis sprzed migracji (ten sam dzień)' as oczekiwane
from public.company_capacity;

-- I. ODCISKI — identyczne jak przed migracją (te same zapytania) ---------
select 'packages' as tabela, count(*) as wierszy,
       md5(string_agg(concat_ws('|', id, company_id, plan, qty_total, qty_used, price_paid, currency,
                                 purchased_at, expires_at, payment_ref, expiry_reminder_sent_at), E'\n'
                      order by id)) as odcisk
from public.packages
union all
select 'package_plans', count(*),
       md5(string_agg(concat_ws('|', id, tier, qty, price_eur, discount_pct, display_order, popular, active), E'\n' order by id))
from public.package_plans where id <> 'grant'      -- nowy wiersz katalogu jest jedyną spodziewaną różnicą
union all
select 'wallet_tx', count(*),
       md5(string_agg(concat_ws('|', id, company_id, type, amount, currency, description, reference_id, created_at, meta::text), E'\n' order by id))
from public.wallet_tx
union all
select 'legacy_sends', count(*),
       md5(string_agg(concat_ws('|', id, legacy_id, status, data::text, email_opened_at), E'\n' order by id))
from public.legacy_sends
union all
select 'companies(pkg)', count(*),
       md5(string_agg(concat_ws('|', id, pkg_plan, pkg_expiry, preconnect_enabled, account_status), E'\n' order by id))
from public.companies;
