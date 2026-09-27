-- =====================================================================
-- KONTROLA PRZED MIGRACJĄ 20260927120000_free_credit_grants — TYLKO ODCZYT
-- Cel: ustalić, czy rekompensaty za nieobecne sieci (skrypt z 23.09,
--      plan 'std_1', cena 0) zostały już wstawione do produkcji.
-- Nic nie zapisuje. Wynik wklej do notatki / przekaż Claude'owi lub Codexowi.
-- =====================================================================

-- 0. Czy migracja już poszła? (kolumna source istnieje → tak)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'packages'
  and column_name in ('source', 'grant_reason', 'grant_batch_id');

-- 1. Wiersze, które MOGŁYBY być rekompensatą (cena 0 / brak ceny / plan std_1 / brak payment_ref)
select p.id, c.name as firma, p.plan, p.qty_total, p.qty_used, p.price_paid, p.payment_ref,
       p.purchased_at, p.expires_at
from public.packages p
join public.companies c on c.id = p.company_id
where p.price_paid = 0 or p.price_paid is null or p.plan = 'std_1' or p.payment_ref is null
order by p.purchased_at desc;

-- 2. Partie po znaczniku czasu (skrypt z 23.09 wstawiał wszystko z jednym now())
select purchased_at, plan, price_paid, count(*) as wierszy, sum(qty_total) as kredytow,
       count(distinct company_id) as firm
from public.packages
where price_paid = 0 or price_paid is null or plan = 'std_1'
group by purchased_at, plan, price_paid
order by purchased_at desc;

-- 3. Rozkład planów i referencji płatności (kontekst)
select plan, count(*) as wierszy, count(payment_ref) as z_payment_ref, sum(qty_total) as kredytow
from public.packages
group by plan order by plan;

-- 4. Typy transakcji portfela (po migracji przyznania dopisują 'adjustment' z meta.kind = free_credit_grant)
select type, count(*) from public.wallet_tx group by type order by type;

-- =====================================================================
-- Interpretacja:
--  * Zapytanie 1 puste → rekompensat nie ma; po wdrożeniu przyznać je RPC-em
--    admin_grant_free_credits (powód 'compensation') z panelu admina.
--  * Zapytanie 2 pokazuje partię z 23–27.09 z plan='std_1', cena 0 → rekompensaty
--    JUŻ SĄ. NIE przyznawać ponownie. Oznaczenie ich jako source='grant' wymaga
--    osobnej, świadomej aktualizacji po tej dokładnej liście id (patrz notatka,
--    sekcja „Istniejące rekompensaty”), nie po samej cenie zero.
-- =====================================================================
