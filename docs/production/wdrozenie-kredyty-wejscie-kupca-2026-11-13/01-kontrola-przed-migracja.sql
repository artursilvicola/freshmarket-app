-- [fix/buyer-entry-seen] KONTROLA PRZED MIGRACJĄ 20261113120000 — tylko odczyt, jedno zapytanie.
-- Uruchom w Supabase → SQL Editor na PRODUKCJI. Każdy wiersz z oceną „ŹLE” = STOP, nie wgrywaj migracji.
-- Wiersze „informacja” nie blokują; zapisz ich wartości w dzienniku wdrożenia.
with checks(lp, kontrola, wynik, oczekiwane) as (
  select 1, 'funkcja charge_legacy_send_first_seen istnieje (zależność)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'charge_legacy_send_first_seen')::text, '1'
  union all
  select 2, 'funkcja mark_legacy_send_seen istnieje',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'mark_legacy_send_seen')::text, '1'
  union all
  select 3, 'funkcja business_today istnieje (zależność)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'business_today')::text, '1'
  union all
  select 4, 'typ wallet_tx_type ma wartości send_charge i refund',
         (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
           where t.typname = 'wallet_tx_type' and e.enumlabel in ('send_charge', 'refund'))::text, '2'
  union all
  select 5, 'nowych funkcji jeszcze nie ma (brak kolizji nazw)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('confirm_legacy_send_manual', 'undo_legacy_send_manual_confirm'))::text, '0'
  union all
  select 6, 'legacy_sends ma kolumny id, legacy_id, supplier_legacy_id, status, data',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'legacy_sends'
             and column_name in ('id', 'legacy_id', 'supplier_legacy_id', 'status', 'data'))::text, '5'
  union all
  select 7, 'packages ma kolumny id, company_id, qty_total, qty_used',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'packages'
             and column_name in ('id', 'company_id', 'qty_total', 'qty_used'))::text, '4'
  union all
  select 8, 'wallet_tx ma kolumny company_id, type, amount, currency, description, reference_id, meta',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'wallet_tx'
             and column_name in ('company_id', 'type', 'amount', 'currency', 'description', 'reference_id', 'meta'))::text, '7'
  union all
  select 20, 'INFO: propozycje czekające na odczyt (sent/opened bez rozliczenia) — tyle rozliczą pierwsze wejścia kupców po wdrożeniu kodu',
         (select count(*) from public.legacy_sends s
           where s.status in ('sent', 'opened')
             and coalesce(s.data->>'billingStatus', '') <> 'charged' and (s.data->>'chargeAt') is null)::text, 'informacja'
  union all
  select 21, 'INFO: sieci, do których należą te czekające propozycje',
         (select count(distinct s.retailer_id) from public.legacy_sends s
           where s.status in ('sent', 'opened')
             and coalesce(s.data->>'billingStatus', '') <> 'charged' and (s.data->>'chargeAt') is null)::text, 'informacja'
  union all
  select 22, 'INFO: odczyty aplikacji zapisane na administratora (dotychczasowe rozliczenia z podglądu konta kupca)',
         (select count(*) from public.legacy_send_app_reads r where r.reader_role = 'admin')::text, 'informacja'
  union all
  select 23, 'INFO: propozycje read_manual bez rozliczenia (stare ręczne potwierdzenia; migracja ich nie rusza)',
         (select count(*) from public.legacy_sends s
           where s.status = 'read_manual'
             and coalesce(s.data->>'billingStatus', '') <> 'charged' and (s.data->>'chargeAt') is null)::text, 'informacja'
)
select lp, kontrola, wynik, oczekiwane,
       case when oczekiwane = 'informacja' then 'informacja' when wynik = oczekiwane then 'OK' else 'ŹLE' end as ocena
from checks
order by lp;
