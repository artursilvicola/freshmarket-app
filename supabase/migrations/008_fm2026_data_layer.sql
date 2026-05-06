-- ===================================================================
-- 008 — FM 2026 data layer (idempotentne)
-- Cel: zastapic localStorage w PreconnectFM realnymi tabelami w Supabase.
-- Wymaga 001-005. Plik mozna uruchomic wielokrotnie bez bledow.
-- ===================================================================

begin;

-- ============================================================
-- 1) Mapowanie hardcoded fmId/legacy id z PreconnectFM na rekordy DB.
-- ============================================================
alter table public.retailers
  add column if not exists legacy_chain_id text unique;
comment on column retailers.legacy_chain_id is
  'Mapowanie z hardkoda FM_CHAINS w PreconnectFM.jsx (np. "100" dla Biedronki)';
create index if not exists idx_retailers_legacy_chain on retailers(legacy_chain_id);

alter table public.companies
  add column if not exists legacy_fm_id text unique;
comment on column companies.legacy_fm_id is
  'Mapowanie z hardkoda FM_SUPPLIERS w PreconnectFM.jsx (np. "s1" dla UNICA)';
create index if not exists idx_companies_legacy_fm on companies(legacy_fm_id);

-- ============================================================
-- 2) COMPANY_TARGET_RETAILERS — preferencje dostawca → sieci handlowe.
--    Single source of truth dla wyboru "z kim chcial sie spotkac dostawca".
--    NIE mylic z fm_prefs (preferencje BUYER-a — kategorie, kraje pochodzenia).
-- ============================================================
create table if not exists public.company_target_retailers (
  company_id uuid not null references companies(id) on delete cascade,
  retailer_id integer not null references retailers(id) on delete cascade,
  priority integer default 0,
  note text,
  created_at timestamptz default now(),
  primary key (company_id, retailer_id)
);
create index if not exists idx_target_retailers_company on company_target_retailers(company_id);
create index if not exists idx_target_retailers_retailer on company_target_retailers(retailer_id);

-- ============================================================
-- 3) Dodatkowe tabele FM 2026 dla state przeniesionego z localStorage.
-- ============================================================

create table if not exists public.fm_wishlists (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer not null references retailers(id) on delete cascade,
  supplier_legacy_id text not null,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unique(retailer_id, supplier_legacy_id)
);
create index if not exists idx_fm_wishlists_retailer on fm_wishlists(retailer_id);

create table if not exists public.fm_late_resps (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer not null references retailers(id) on delete cascade,
  supplier_legacy_id text not null,
  zone text,
  responded_at timestamptz default now(),
  data jsonb default '{}'::jsonb,
  unique(retailer_id, supplier_legacy_id)
);
create index if not exists idx_fm_late_resps_retailer on fm_late_resps(retailer_id);

create table if not exists public.fm_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_key text,
  from_role text,
  from_user_id uuid references auth.users(id) on delete set null,
  to_role text,
  body text,
  data jsonb default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_fm_messages_thread on fm_messages(thread_key);
create index if not exists idx_fm_messages_from_user on fm_messages(from_user_id);

-- ============================================================
-- 4) RLS - idempotent (drop wszystko stare przed create)
-- ============================================================
alter table public.company_target_retailers enable row level security;
alter table public.fm_wishlists             enable row level security;
alter table public.fm_late_resps            enable row level security;
alter table public.fm_messages              enable row level security;

-- company_target_retailers
drop policy if exists "ctr_admin_all"       on company_target_retailers;
drop policy if exists "ctr_supplier_own"    on company_target_retailers;
drop policy if exists "ctr_buyer_read"      on company_target_retailers;
create policy "ctr_admin_all" on company_target_retailers
  for all using (is_admin()) with check (is_admin());
create policy "ctr_supplier_own" on company_target_retailers
  for all using (
    app_role() = 'supplier' and company_id = app_company_id()
  ) with check (
    app_role() = 'supplier' and company_id = app_company_id()
  );
create policy "ctr_buyer_read" on company_target_retailers
  for select using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_wishlists
drop policy if exists "fmw_admin_all" on fm_wishlists;
drop policy if exists "fmw_buyer_own" on fm_wishlists;
create policy "fmw_admin_all" on fm_wishlists
  for all using (is_admin()) with check (is_admin());
create policy "fmw_buyer_own" on fm_wishlists
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_late_resps
drop policy if exists "fmlr_admin_all" on fm_late_resps;
drop policy if exists "fmlr_buyer_own" on fm_late_resps;
create policy "fmlr_admin_all" on fm_late_resps
  for all using (is_admin()) with check (is_admin());
create policy "fmlr_buyer_own" on fm_late_resps
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_messages
drop policy if exists "fmm_admin_all"   on fm_messages;
drop policy if exists "fmm_self"        on fm_messages;
drop policy if exists "fmm_insert_self" on fm_messages;
create policy "fmm_admin_all" on fm_messages
  for all using (is_admin()) with check (is_admin());
create policy "fmm_self" on fm_messages
  for select using (
    from_user_id = auth.uid()
    or (
      to_role = 'supplier' and exists (
        select 1 from companies c
        join profiles p on p.company_id = c.id
        where p.id = auth.uid()
      )
    )
    or (
      to_role = 'buyer' and exists (
        select 1 from profiles p where p.id = auth.uid() and p.retailer_id is not null
      )
    )
  );
create policy "fmm_insert_self" on fm_messages
  for insert with check (
    from_user_id = auth.uid() or is_admin()
  );

-- ============================================================
-- 5) RLS dla istniejacych fm_settings / fm_prefs / fm_resps
--    (drop wszystko stare zarowno z 002 jak i z poprzedniej wersji 008,
--     potem create na nowo - idempotent).
-- ============================================================
alter table public.fm_settings enable row level security;
alter table public.fm_prefs    enable row level security;
alter table public.fm_resps    enable row level security;

-- fm_settings: czytaja wszyscy zalogowani (harmonogram jest publiczny dla user-a),
-- pisze tylko admin.
drop policy if exists "fm_settings_select" on fm_settings;
drop policy if exists "fm_settings_admin"  on fm_settings;
drop policy if exists "fms_read_all"       on fm_settings;
drop policy if exists "fms_admin_write"    on fm_settings;
create policy "fms_read_all" on fm_settings
  for select using (auth.uid() is not null);
create policy "fms_admin_write" on fm_settings
  for all using (is_admin()) with check (is_admin());

-- fm_prefs: BUYER preferences (kategorie, kraje pochodzenia).
-- Czytaja: admin + dany buyer (swoje). NIE czyta supplier (to nie jego sprawa).
drop policy if exists "fm_prefs_select"   on fm_prefs;
drop policy if exists "fm_prefs_buyer"    on fm_prefs;
drop policy if exists "fmp_read_all"      on fm_prefs;
drop policy if exists "fmp_admin_write"   on fm_prefs;
drop policy if exists "fmp_buyer_own"     on fm_prefs;
drop policy if exists "fmp_admin_read"    on fm_prefs;
create policy "fmp_admin_read" on fm_prefs
  for select using (is_admin());
create policy "fmp_buyer_own" on fm_prefs
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );
create policy "fmp_admin_write" on fm_prefs
  for all using (is_admin()) with check (is_admin());

-- fm_resps: odpowiedzi BUYER->SUPPLIER (zone/status).
-- Czyta: admin + buyer (swoje) + supplier (rzedy o nim).
-- Pisze: admin + buyer (swoje).
drop policy if exists "fm_resps_select"          on fm_resps;
drop policy if exists "fm_resps_admin"           on fm_resps;
drop policy if exists "fmr_admin_all"            on fm_resps;
drop policy if exists "fmr_buyer_own"            on fm_resps;
drop policy if exists "fmr_supplier_about_self"  on fm_resps;
create policy "fmr_admin_all" on fm_resps
  for all using (is_admin()) with check (is_admin());
create policy "fmr_buyer_own" on fm_resps
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );
create policy "fmr_supplier_about_self" on fm_resps
  for select using (
    app_role() = 'supplier' and supplier_company_id = app_company_id()
  );

commit;
