-- ============================================================================
-- 023 — package_plans (katalog pakietów) + RPC purchase_package + view company_capacity
-- [B2B Round prod-rollout / faza 2]
--
-- Cel:
--   Wycofać hardcoded PRICING_PLANS z PreconnectFM.jsx (linie 467-478) i
--   LIMITS_INIT (437-441). Cały katalog pakietów + faktyczne zakupy mają żyć
--   w bazie, żeby:
--     - admin mógł dodać/wycofać plan bez deployu kodu,
--     - lista firm w panelu admina pokazywała pełną prawdę (a nie 3 demo
--       firmy z mocka),
--     - PayU webhook miał gdzie atomowo zapisać zakup.
--
-- Trzy nowe rzeczy:
--   1. tabela `package_plans` — katalog dostępnych planów (seed 10 wpisów
--      identyczny z PRICING_PLANS w UI, EUR-only).
--   2. RPC `purchase_package(p_company_id, p_plan_id, p_price_paid, p_currency,
--      p_payment_ref)` — atomowy: INSERT packages + INSERT wallet_tx
--      (type='package_purchase'). SECURITY DEFINER, RLS-bypass dla
--      atomowości (wołane z service_role w Netlify function po notify
--      od PayU).
--   3. view `company_capacity` — companies + sum(qty_total-qty_used)
--      z packages.where expires_at >= today. Czytane przez admin panel
--      firmy zamiast LIMITS_INIT.
--
-- Backfill:
--   Dla 3 demo firm z LIMITS_INIT (UNICA/PIK/FRESH INSIDE — po nazwie),
--   jeśli istnieją w `companies`, wstawiamy `packages` odpowiadające
--   mockowi (prem_10/std_10/prem_10, qty_used=5/5/4). Idempotentne
--   (on conflict do nothing po unique constraint payment_ref).
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ============================================================================

begin;

-- ── 1. package_plans — katalog ──────────────────────────────────────────
create table if not exists package_plans (
  id text primary key,                  -- 'std_5', 'prem_10', ...
  tier text not null check (tier in ('STANDARD', 'PREMIUM')),
  qty integer not null check (qty > 0),
  price_eur numeric(10,2) not null check (price_eur >= 0),
  per_send_eur numeric(10,2) generated always as (price_eur / qty) stored,
  discount_pct integer default 0,
  display_order integer default 100,
  popular boolean default false,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_package_plans_active on package_plans(active) where active = true;

-- Seed planów (zgodny z PRICING_PLANS z PreconnectFM.jsx:467-478).
-- on conflict do update, żeby przy zmianie cennika w przyszłości
-- wystarczyło re-runnąć migrację z nowymi liczbami.
insert into package_plans (id, tier, qty, price_eur, discount_pct, display_order, popular) values
  ('std_1',   'STANDARD',  1,   50.00,  0, 11, false),
  ('std_5',   'STANDARD',  5,  225.00, 10, 12, false),
  ('std_10',  'STANDARD', 10,  400.00, 20, 13, true),
  ('std_20',  'STANDARD', 20,  700.00, 30, 14, false),
  ('std_50',  'STANDARD', 50, 1500.00, 40, 15, false),
  ('prem_1',  'PREMIUM',   1,   80.00,  0, 21, false),
  ('prem_5',  'PREMIUM',   5,  350.00, 13, 22, false),
  ('prem_10', 'PREMIUM',  10,  600.00, 25, 23, true),
  ('prem_20', 'PREMIUM',  20, 1000.00, 38, 24, false),
  ('prem_50', 'PREMIUM',  50, 2250.00, 44, 25, false)
on conflict (id) do update set
  tier = excluded.tier,
  qty = excluded.qty,
  price_eur = excluded.price_eur,
  discount_pct = excluded.discount_pct,
  display_order = excluded.display_order,
  popular = excluded.popular,
  updated_at = now();

-- RLS: czytanie publiczne (każdy zalogowany), edycja tylko admin.
alter table package_plans enable row level security;

drop policy if exists package_plans_select_all on package_plans;
create policy package_plans_select_all on package_plans
  for select using (auth.uid() is not null);

drop policy if exists package_plans_admin_modify on package_plans;
create policy package_plans_admin_modify on package_plans
  for all using (is_admin()) with check (is_admin());

-- ── 2. packages — dorzucamy plan_id jako FK + payment_ref dla idempotencji ─
-- Tabela packages istnieje od 001_schema.sql:297. Nie zmieniamy istniejących
-- kolumn (plan text), tylko dorzucamy FK do package_plans i payment_ref
-- (unique key z PayU, żeby webhook nie zaksięgował tego samego zakupu 2 razy).
alter table packages
  add column if not exists payment_ref text;

create unique index if not exists ux_packages_payment_ref
  on packages(payment_ref) where payment_ref is not null;

-- ── 3. RPC purchase_package — atomowy zapis zakupu ──────────────────────
-- Wołane z server-side (Netlify function po notify od PayU). SECURITY DEFINER
-- omija RLS. Zwraca id stworzonej packages (lub istniejącej, jeśli idempotent
-- hit na payment_ref).
create or replace function purchase_package(
  p_company_id uuid,
  p_plan_id text,
  p_price_paid numeric default null,    -- jak null → bierzemy z package_plans
  p_currency text default 'EUR',
  p_payment_ref text default null       -- ID transakcji z PayU (lub null dla manual)
)
returns uuid as $$
declare
  v_plan package_plans%rowtype;
  v_price numeric;
  v_package_id uuid;
  v_existing_id uuid;
begin
  -- Idempotency check: jeśli payment_ref już zaksięgowany, zwróć istniejący id
  if p_payment_ref is not null then
    select id into v_existing_id from packages where payment_ref = p_payment_ref;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  -- Validacje
  select * into v_plan from package_plans where id = p_plan_id and active = true;
  if not found then
    raise exception 'Plan % nie istnieje lub jest nieaktywny', p_plan_id
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Firma % nie istnieje', p_company_id
      using errcode = 'P0001';
  end if;

  v_price := coalesce(p_price_paid, v_plan.price_eur);

  -- 1. INSERT packages
  insert into packages (company_id, plan, qty_total, qty_used, price_paid, currency, expires_at, payment_ref)
  values (
    p_company_id,
    p_plan_id,
    v_plan.qty,
    0,
    v_price,
    p_currency,
    (current_date + interval '1 year')::date,
    p_payment_ref
  )
  returning id into v_package_id;

  -- 2. INSERT wallet_tx (debit, bo to wydatek dla firmy)
  insert into wallet_tx (company_id, type, amount, currency, description, reference_id)
  values (
    p_company_id,
    'package_purchase',
    -v_price,
    p_currency,
    'Zakup pakietu ' || v_plan.tier || ' ' || v_plan.qty || ' wysyłek',
    v_package_id
  );

  -- 3. Update companies.pkg_plan żeby legacy panel admina pokazywał aktualny tier
  update companies set pkg_plan = p_plan_id where id = p_company_id;

  return v_package_id;
end;
$$ language plpgsql security definer;

-- Tylko service_role może wołać (Netlify functions po notify od PayU + admin
-- manual override). Authenticated supplier NIE może wywołać bezpośrednio,
-- żeby nie obejść płatności.
revoke all on function purchase_package(uuid, text, numeric, text, text) from public;
grant execute on function purchase_package(uuid, text, numeric, text, text) to service_role;

-- ── 4. View company_capacity — pełna lista firm + remaining sends ───────
-- Czytane przez admin panel zamiast LIMITS_INIT.
create or replace view company_capacity as
select
  c.id,
  c.name,
  c.country,
  c.account_status,
  c.preconnect_enabled,
  c.fm_b2b_enabled,
  c.pkg_plan,
  c.legacy_supplier_id,
  c.logo_url,
  -- Suma kupionych - użytych z aktywnych pakietów
  coalesce(sum(case when p.expires_at >= current_date then p.qty_total else 0 end), 0)::integer as qty_total,
  coalesce(sum(case when p.expires_at >= current_date then p.qty_used  else 0 end), 0)::integer as qty_used,
  coalesce(sum(case when p.expires_at >= current_date then p.qty_total - p.qty_used else 0 end), 0)::integer as qty_remaining,
  -- Najpóźniejsza data ważności aktywnego pakietu
  max(case when p.expires_at >= current_date then p.expires_at end) as pkg_expiry,
  c.created_at
from companies c
left join packages p on p.company_id = c.id
group by c.id;

grant select on company_capacity to authenticated;

-- ── 5. Backfill — 3 demo firmy z LIMITS_INIT ────────────────────────────
-- Jeśli UNICA/PIK/FRESH INSIDE istnieją w companies (po nazwie LIKE), a nie
-- mają jeszcze packages — wstaw odpowiadające mockowi. payment_ref typu
-- 'backfill-LIMITS_INIT-{name}' robi to idempotentnym (drugi run nic nie zmieni).

do $$
declare
  v_unica uuid;
  v_pik uuid;
  v_fresh uuid;
begin
  select id into v_unica from companies where name ilike 'unica%' limit 1;
  select id into v_pik   from companies where name ilike 'pik global%' limit 1;
  select id into v_fresh from companies where name ilike 'fresh inside%' limit 1;

  if v_unica is not null then
    insert into packages (company_id, plan, qty_total, qty_used, price_paid, currency, expires_at, payment_ref)
    values (v_unica, 'prem_10', 10, 5, 600.00, 'EUR', '2026-12-31', 'backfill-LIMITS_INIT-unica')
    on conflict (payment_ref) where payment_ref is not null do nothing;
    update companies set pkg_plan = 'prem_10' where id = v_unica and pkg_plan is null;
  end if;

  if v_pik is not null then
    insert into packages (company_id, plan, qty_total, qty_used, price_paid, currency, expires_at, payment_ref)
    values (v_pik, 'std_10', 10, 5, 400.00, 'EUR', '2026-12-31', 'backfill-LIMITS_INIT-pik')
    on conflict (payment_ref) where payment_ref is not null do nothing;
    update companies set pkg_plan = 'std_10' where id = v_pik and pkg_plan is null;
  end if;

  if v_fresh is not null then
    insert into packages (company_id, plan, qty_total, qty_used, price_paid, currency, expires_at, payment_ref)
    values (v_fresh, 'prem_10', 10, 4, 600.00, 'EUR', '2026-12-31', 'backfill-LIMITS_INIT-fresh')
    on conflict (payment_ref) where payment_ref is not null do nothing;
    update companies set pkg_plan = 'prem_10' where id = v_fresh and pkg_plan is null;
  end if;
end $$;

commit;
