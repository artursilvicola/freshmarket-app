-- ============================================================================
-- 024 — payu_orders (śledzenie sesji płatności PayU)
-- [B2B Round prod-rollout / faza 3]
--
-- Cel:
--   Trzymać pełen audit-trail każdej próby zakupu pakietu przez PayU. Bez
--   tego po notify nie wiemy CO supplier chciał kupić ani po której stronie
--   coś padło (kasa pobrana ale package nie powstał? user dostał błąd przed
--   redirect na PayU?).
--
-- Lifecycle:
--   1. create-payu-order function:
--        - INSERT payu_orders (status='created', ext_order_id=uuid, plan_id, price)
--        - wywołuje PayU API → dostaje payu_order_id
--        - UPDATE z payu_order_id, status='pending'
--   2. payu-notify webhook od PayU:
--        - znajdź po payu_order_id
--        - jak status=COMPLETED → wywołaj purchase_package RPC, UPDATE status='completed', package_id
--        - jak status=CANCELED/REJECTED → UPDATE status= odpowiedni
--   3. /zakup-ok strona:
--        - czyta payu_orders.status żeby pokazać prawdziwy stan
--
-- Idempotency:
--   - unique(payu_order_id) + unique(ext_order_id) — PayU może retryować notify
--   - purchase_package RPC sam jest idempotentny po payment_ref
--
-- Idempotentne: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS.
-- ============================================================================

begin;

create table if not exists payu_orders (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  plan_id text not null references package_plans(id) on delete restrict,
  price_eur numeric(10,2) not null,
  currency text not null default 'EUR',
  status text not null default 'created'
    check (status in ('created', 'pending', 'completed', 'canceled', 'rejected', 'failed')),
  payu_order_id text,             -- przyznawany przez PayU po create
  ext_order_id text not null,     -- nasz unique ID, przekazywany do PayU jako extOrderId
  payment_method text,            -- 'card', 'pbl', 'blik', ... — z notify
  package_id uuid references packages(id) on delete set null,
  raw_create jsonb,               -- pełny response z PayU create
  raw_notify jsonb,               -- pełny payload notify
  failure_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create unique index if not exists ux_payu_orders_payu_order_id
  on payu_orders(payu_order_id) where payu_order_id is not null;

create unique index if not exists ux_payu_orders_ext_order_id
  on payu_orders(ext_order_id);

create index if not exists idx_payu_orders_company on payu_orders(company_id);
create index if not exists idx_payu_orders_status on payu_orders(status);
create index if not exists idx_payu_orders_created on payu_orders(created_at desc);

drop trigger if exists trg_payu_orders_updated on payu_orders;
create trigger trg_payu_orders_updated
  before update on payu_orders
  for each row execute function set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table payu_orders enable row level security;

-- Supplier widzi swoje zamówienia (do strony /zakup-ok i historii zakupów)
drop policy if exists payu_orders_select_own_or_admin on payu_orders;
create policy payu_orders_select_own_or_admin on payu_orders
  for select using (is_admin() or company_id = app_company_id());

-- Insert/update tylko service_role (z Netlify functions). Authenticated NIE
-- może modyfikować — chronimy integralność płatności.
-- (brak policy dla insert/update/delete = brak dostępu dla authenticated;
--  service_role i tak omija RLS).

commit;
