-- ===================================================================
-- 008 — FM 2026 data layer
-- Cel: zastapic localStorage w PreconnectFM realnymi tabelami w Supabase.
-- Wymaga 001-005 (legacy_offers, legacy_sends, profiles, companies, retailers,
-- fm_settings, fm_prefs, fm_resps).
-- ===================================================================

begin;

-- ============================================================
-- 1) RETAILERS - mapowanie hardcoded fmId ('s1', 'b1', '100', ...)
--    z PreconnectFM.jsx FM_CHAINS na realne wpisy retailers.
-- ============================================================
alter table public.retailers
  add column if not exists legacy_chain_id text unique;
comment on column retailers.legacy_chain_id is
  'Mapowanie z hardkoda FM_CHAINS w PreconnectFM.jsx (np. "100" dla Biedronki)';
create index if not exists idx_retailers_legacy_chain on retailers(legacy_chain_id);

-- ============================================================
-- 2) COMPANIES - to samo dla suppliers (FM_SUPPLIERS hardcoded fmId 's1'...)
-- ============================================================
alter table public.companies
  add column if not exists legacy_fm_id text unique;
comment on column companies.legacy_fm_id is
  'Mapowanie z hardkoda FM_SUPPLIERS w PreconnectFM.jsx (np. "s1" dla UNICA)';
create index if not exists idx_companies_legacy_fm on companies(legacy_fm_id);

-- ============================================================
-- 3) COMPANY_TARGET_RETAILERS - preferencje dostawcy vs sieci handlowe
--    (FM 2026 matchmaking: "ktore sieci chce spotkac")
-- ============================================================
create table if not exists public.company_target_retailers (
  company_id uuid not null references companies(id) on delete cascade,
  retailer_id integer not null references retailers(id) on delete cascade,
  priority integer default 0,           -- 1 = najwyzszy priorytet (chcial najbardziej)
  note text,
  created_at timestamptz default now(),
  primary key (company_id, retailer_id)
);
create index if not exists idx_target_retailers_company on company_target_retailers(company_id);
create index if not exists idx_target_retailers_retailer on company_target_retailers(retailer_id);

-- ============================================================
-- 4) FM 2026 STATE TABLES - wczesniej zapisywane w localStorage
-- ============================================================

-- fm_wishlists: kupiec stawia priorytet na konkretnego dostawce w danym slocie
create table if not exists public.fm_wishlists (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer not null references retailers(id) on delete cascade,
  supplier_legacy_id text not null,     -- moze byc 's1' lub uuid - zachowujemy elastycznosc
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unique(retailer_id, supplier_legacy_id)
);
create index if not exists idx_fm_wishlists_retailer on fm_wishlists(retailer_id);

-- fm_late_resps: opozinione odpowiedzi kupca po zamknieciu fazy
create table if not exists public.fm_late_resps (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer not null references retailers(id) on delete cascade,
  supplier_legacy_id text not null,
  zone text,                             -- 'green'/'orange'/'red'/'blocked'
  responded_at timestamptz default now(),
  data jsonb default '{}'::jsonb,
  unique(retailer_id, supplier_legacy_id)
);
create index if not exists idx_fm_late_resps_retailer on fm_late_resps(retailer_id);

-- fm_messages: konwersacje miedzy admin/supplier/buyer w PreconnectFM
create table if not exists public.fm_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_key text,                       -- np. "supplier:s1#retailer:100"
  from_role text,                        -- 'admin'/'supplier'/'buyer'
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
-- 5) RLS - prosta wersja: admin pelny dostep, dostawca/kupiec do swojego
-- ============================================================
alter table public.company_target_retailers enable row level security;
alter table public.fm_wishlists             enable row level security;
alter table public.fm_late_resps            enable row level security;
alter table public.fm_messages              enable row level security;

-- company_target_retailers: admin all; supplier wlasne
create policy "ctr_admin_all" on company_target_retailers
  for all using (is_admin()) with check (is_admin());
create policy "ctr_supplier_own" on company_target_retailers
  for all using (
    app_role() = 'supplier' and company_id = app_company_id()
  ) with check (
    app_role() = 'supplier' and company_id = app_company_id()
  );
-- buyer moze odczytac (zeby admin/buyer wiedzial kto chcial sie z nim spotkac)
create policy "ctr_buyer_read" on company_target_retailers
  for select using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_wishlists: admin all; buyer wlasne (filtruje po retailer_id)
create policy "fmw_admin_all" on fm_wishlists
  for all using (is_admin()) with check (is_admin());
create policy "fmw_buyer_own" on fm_wishlists
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_late_resps: jak fm_wishlists
create policy "fmlr_admin_all" on fm_late_resps
  for all using (is_admin()) with check (is_admin());
create policy "fmlr_buyer_own" on fm_late_resps
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_messages: admin all; user widzi swoje (jako from lub to)
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
    from_user_id = auth.uid()
    or is_admin()
  );

-- ============================================================
-- 6) RLS dla istniejacych tabel fm_settings / fm_prefs / fm_resps
--    (brakowalo w 001 - tabele istnieja ale bez RLS)
-- ============================================================
alter table public.fm_settings enable row level security;
alter table public.fm_prefs    enable row level security;
alter table public.fm_resps    enable row level security;

-- fm_settings: czytaja wszyscy zalogowani; zmienia tylko admin
drop policy if exists "fms_read_all" on fm_settings;
drop policy if exists "fms_admin_write" on fm_settings;
create policy "fms_read_all" on fm_settings
  for select using (auth.uid() is not null);
create policy "fms_admin_write" on fm_settings
  for all using (is_admin()) with check (is_admin());

-- fm_prefs: czytaja wszyscy zalogowani; pisze admin lub buyer (swoje)
drop policy if exists "fmp_read_all" on fm_prefs;
drop policy if exists "fmp_admin_write" on fm_prefs;
drop policy if exists "fmp_buyer_own" on fm_prefs;
create policy "fmp_read_all" on fm_prefs
  for select using (auth.uid() is not null);
create policy "fmp_admin_write" on fm_prefs
  for all using (is_admin()) with check (is_admin());
create policy "fmp_buyer_own" on fm_prefs
  for all using (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  ) with check (
    app_role() = 'buyer' and retailer_id = app_retailer_id()
  );

-- fm_resps: kupiec (buyer) widzi swoje + zmienia swoje; admin all; supplier widzi tylko o sobie
drop policy if exists "fmr_admin_all" on fm_resps;
drop policy if exists "fmr_buyer_own" on fm_resps;
drop policy if exists "fmr_supplier_about_self" on fm_resps;
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
