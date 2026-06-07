-- ============================================================================
-- 040 — proformas (faktury proforma dla płatności przelewem)
-- [feat/bank-transfer-proforma / Poprawki Lany #2]
--
-- Cel:
--   Gdy dostawca wybiera płatność PRZELEWEM, system generuje dokument proforma
--   (HTML) z danymi rozliczeniowymi firmy (w tym NIP) + numerem PF/RRRR/NNNNNN,
--   wysyła go mailem, pozwala pobrać i zapisuje w historii płatności. Pakiet
--   pozostaje "oczekuje na płatność" — admin aktywuje go ręcznie po zaksięgowaniu
--   przelewu (NIE dotykamy purchase_package ani PayU).
--
-- Numeracja:
--   proforma_counters(year, last_no) + RPC allocate_proforma_number(year) robi
--   atomowy increment (INSERT ... ON CONFLICT DO UPDATE ... RETURNING) — odporny
--   na współbieżność. Numer formatuje funkcja Netlify jako PF/RRRR/NNNNNN.
--
-- Dokument = snapshot: dane firmy (nazwa, NIP, adres) i HTML są zamrożone w
-- wierszu, więc proforma przeżywa późniejsze zmiany danych firmy.
--
-- Bezpieczeństwo: insert/update tylko service_role (funkcja generate-proforma).
-- RLS select: właściciel firmy + admin (jak payu_orders).
--
-- Idempotentne: CREATE TABLE/FUNCTION IF NOT EXISTS / OR REPLACE.
-- ============================================================================

begin;

-- ── Licznik numeracji per rok ─────────────────────────────────────────────
create table if not exists proforma_counters (
  year     int primary key,
  last_no  int not null default 0
);

-- Atomowa alokacja kolejnego numeru w danym roku. SECURITY DEFINER, bo wołane
-- przez service_role z funkcji Netlify; pojedynczy statement = brak wyścigu.
create or replace function allocate_proforma_number(p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no int;
begin
  insert into proforma_counters (year, last_no)
  values (p_year, 1)
  on conflict (year) do update set last_no = proforma_counters.last_no + 1
  returning last_no into v_no;
  return v_no;
end;
$$;

-- ── Tabela proform ────────────────────────────────────────────────────────
create table if not exists proformas (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete set null,
  number text not null,                 -- PF/2026/000001
  year int not null,
  seq int not null,
  plan_id text not null,                -- snapshot (bez FK — dokument zamrożony)
  qty int not null,
  currency text not null default 'EUR',
  net_amount numeric(10,2) not null,
  vat_rate numeric(5,2) not null default 23,
  vat_amount numeric(10,2) not null,
  gross_amount numeric(10,2) not null,
  -- snapshot danych rozliczeniowych firmy (dokument musi przetrwać zmiany firmy)
  company_name_snapshot text,
  company_nip_snapshot text,
  company_address_snapshot text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled')),
  html text,                            -- wyrenderowany dokument (do pobrania/podglądu)
  locale text not null default 'pl',
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists ux_proformas_number on proformas(number);
create index if not exists idx_proformas_company on proformas(company_id);
create index if not exists idx_proformas_status on proformas(status);
create index if not exists idx_proformas_issued on proformas(issued_at desc);

drop trigger if exists trg_proformas_updated on proformas;
create trigger trg_proformas_updated
  before update on proformas
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table proformas enable row level security;

-- Dostawca widzi proformy swojej firmy (historia płatności); admin widzi wszystko.
drop policy if exists proformas_select_own_or_admin on proformas;
create policy proformas_select_own_or_admin on proformas
  for select using (is_admin() or company_id = app_company_id());

-- Insert/update tylko service_role (funkcja generate-proforma). Authenticated
-- NIE może modyfikować — chronimy integralność dokumentów rozliczeniowych.
-- (brak policy insert/update/delete = brak dostępu dla authenticated).

commit;
