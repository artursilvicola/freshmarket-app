-- =====================================================================
-- KOPIA + ODCISKI PRZED MIGRACJĄ 20260927120000_free_credit_grants
-- TYLKO ODCZYT. Uruchom w SQL Editorze PRZED migracją, zapisz wyniki
-- (JSON → plik w C:\Users\Artur\FreshMarket-Backups\FM-KREDYTY-<data>\przed.json,
--  odciski → MANIFEST.txt). Te same odciski uruchamiasz PO migracji
-- (plik KONTROLA_PO_MIGRACJI…) — muszą być identyczne, bo migracja
-- nie zmienia żadnego istniejącego wiersza (dodaje kolumny z DEFAULT).
-- =====================================================================

-- 1. ODCISKI (md5 po istniejących kolumnach, w stałej kolejności) ------
select 'packages' as tabela, count(*) as wierszy,
       md5(string_agg(concat_ws('|', id, company_id, plan, qty_total, qty_used, price_paid, currency,
                                 purchased_at, expires_at, payment_ref, expiry_reminder_sent_at), E'\n'
                      order by id)) as odcisk
from public.packages
union all
select 'package_plans', count(*),
       md5(string_agg(concat_ws('|', id, tier, qty, price_eur, discount_pct, display_order, popular, active), E'\n' order by id))
from public.package_plans
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

-- 2. STAN LICZBOWY (do porównania po migracji i po przyznaniach) -------
select (select count(*) from public.packages)                                   as packages,
       (select coalesce(sum(qty_total - qty_used), 0) from public.packages
         where expires_at >= current_date)                                       as kredyty_wolne_dzis,
       (select count(*) from public.wallet_tx where type = 'send_charge')       as rozliczenia,
       (select count(*) from public.wallet_tx where type = 'adjustment')        as korekty,
       (select count(*) from public.legacy_sends where data->>'billingStatus' = 'charged') as wysylki_rozliczone,
       (select count(*) from public.legacy_sends where status in ('sent','opened')) as wysylki_nieodczytane;

-- 3. KOPIA DANYCH (JSON) — każdy wynik zapisz do osobnego pliku ---------
select json_agg(p order by p.id) from public.packages p;
select json_agg(w order by w.id) from public.wallet_tx w;
select json_agg(pp order by pp.id) from public.package_plans pp;
-- legacy_sends: tylko pola istotne dla rozliczeń (pełny JSON bywa duży)
select json_agg(json_build_object('id', s.id, 'legacy_id', s.legacy_id, 'status', s.status,
                                  'billingStatus', s.data->>'billingStatus', 'chargeAt', s.data->>'chargeAt',
                                  'packageId', s.data->>'packageId', 'chargeTxId', s.data->>'chargeTxId',
                                  'supplierNotifiedAt', s.data->>'supplierNotifiedAt', 'updated_at', s.updated_at)
                order by s.legacy_id)
from public.legacy_sends s;

-- 4. WIDOK company_capacity — definicja przed migracją (do porównania) --
select pg_get_viewdef('public.company_capacity'::regclass, true);
select relname, reloptions from pg_class where relname = 'company_capacity';
