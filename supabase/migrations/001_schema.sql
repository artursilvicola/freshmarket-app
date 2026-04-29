-- ===================================================================
-- Fresh Market — Schemat bazy
-- Wykonaj w SQL Editor Supabase
-- ===================================================================

-- Rozszerzenia
create extension if not exists "uuid-ossp";

-- ===================================================================
-- ENUMS
-- ===================================================================
create type user_role as enum ('admin', 'supplier', 'buyer');
create type offer_status as enum ('draft', 'active', 'paused', 'archived');
create type send_status as enum (
  'queued', 'pending_moderation', 'approved', 'rejected',
  'sent', 'opened', 'read', 'read_manual', 'unread_expired', 'refunded'
);
create type wallet_tx_type as enum ('topup', 'package_purchase', 'send_charge', 'refund', 'adjustment');

-- ===================================================================
-- PROFILES — rozszerza auth.users o rolę i kontekst
-- ===================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'supplier',
  name text,
  email text,
  phone text,
  position text,
  -- Powiązania z firmami (jedno z dwóch będzie ustawione zależnie od roli):
  company_id uuid,         -- supplier => firma dostawcy
  retailer_id integer,     -- buyer    => sieć handlowa
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_profiles_company on profiles(company_id);
create index idx_profiles_retailer on profiles(retailer_id);
create index idx_profiles_role on profiles(role);

-- ===================================================================
-- COMPANIES — firmy dostawców
-- ===================================================================
create table companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  nip text,
  country text,
  city text,
  phone text,
  website text,
  description text,
  types text[] default '{}',          -- producent, eksporter, etc.
  categories text[] default '{}',     -- owoce, warzywa, kwiaty, ...
  products text,
  seasonality text,
  markets text,
  completeness integer default 0,
  logo_url text,
  pkg_plan text,
  pkg_expiry date,
  fm_passport_completeness integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_companies_name on companies(name);

alter table profiles
  add constraint fk_profiles_company foreign key (company_id) references companies(id) on delete set null;

-- ===================================================================
-- COMPANY_CONTACTS — kontakty w firmie (sales, quality, ...)
-- ===================================================================
create table company_contacts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade,
  role text,            -- 'sales', 'quality', ...
  name text,
  position text,
  phone text,
  email text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
create index idx_contacts_company on company_contacts(company_id);

-- ===================================================================
-- COMPANY_CERTS — certyfikaty firmy
-- ===================================================================
create table company_certs (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade,
  type text,            -- 'GlobalGAP', 'BRC', ...
  number text,
  valid_until date,
  document_url text,
  created_at timestamptz default now()
);
create index idx_certs_company on company_certs(company_id);

-- ===================================================================
-- RETAILERS — sieci handlowe (kupcy)
-- ===================================================================
create table retailers (
  id integer primary key,
  name text not null,
  country text,
  cats text[] default '{}',
  color text,
  bg text,
  initials text,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  next_send date,
  created_at timestamptz default now()
);

alter table profiles
  add constraint fk_profiles_retailer foreign key (retailer_id) references retailers(id) on delete set null;

-- ===================================================================
-- OFFERS — oferty dostawców
-- ===================================================================
create table offers (
  id uuid primary key default uuid_generate_v4(),
  supplier_company_id uuid not null references companies(id) on delete cascade,

  -- Identyfikacja produktu
  product text not null,
  variety text,
  category text,           -- owoce / warzywa / kwiaty / zioła / inne
  subcategory text,
  origin text,             -- kod kraju
  region text,

  -- Marketing oferty
  offer_type text,         -- 'Program stały', 'Propozycja sezonowa', ...
  positioning text,
  title text,
  description text,
  internal_title text,

  -- Specyfikacja
  size text,
  quality_class text,
  is_bio boolean default false,
  brix text,
  color_spec text,
  quality_spec text,

  -- Branding
  brand text,
  sale_mode text,

  -- Dostępność
  available_from text,     -- 'YYYY-MM' format dla elastyczności
  available_to text,
  availability_model text,
  volume_min text,
  volume_max text,
  volume_unit text,
  moq text,
  lead_time text,
  promo_volume text,
  promo_volume_pct text,
  delivery_days text[] default '{}',

  -- Opakowania
  packaging text[] default '{}',
  custom_packaging text,
  packaging_desc text,
  pallet_type text,
  pallet_height text,
  cartons_per_layer text,
  layers_per_pallet text,
  units_per_pallet text,
  srp text,

  -- Logistyka
  delivery_model text,
  loading_point text,
  delivery_regions text,
  cold_chain text,
  temp_transport text,

  -- Jakość / certyfikaty
  traceability text,
  certs text[] default '{}',
  custom_cert text,
  cert_number text,
  cert_valid date,
  current_tests text,

  -- Cena
  currency text,
  price_offer text,
  price_unit text,
  incoterm text,
  price_from date,
  price_to date,
  promo_price text,
  contract_program text,
  samples_avail text,

  -- Korzyści (pola marketingowe)
  benefit1 text,
  benefit2 text,
  benefit3 text,
  shop_benefit text,
  risk_mitigation text,
  risk_proof text,
  risk_now text,

  -- CTA i meta
  cta text[] default '{}',
  status offer_status default 'active',
  tier text default 'standard',  -- 'premium' | 'standard'

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_offers_supplier on offers(supplier_company_id);
create index idx_offers_status on offers(status);
create index idx_offers_category on offers(category);

-- ===================================================================
-- OFFER_PHOTOS — zdjęcia oferty (linki do Storage)
-- ===================================================================
create table offer_photos (
  id uuid primary key default uuid_generate_v4(),
  offer_id uuid references offers(id) on delete cascade,
  storage_path text not null,    -- ścieżka w bucket 'offer-photos'
  url text,                      -- publiczny URL
  alt text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
create index idx_offer_photos_offer on offer_photos(offer_id);

-- ===================================================================
-- SENDS — wysyłki ofert do retailerów
-- ===================================================================
create table sends (
  id uuid primary key default uuid_generate_v4(),
  offer_id uuid references offers(id) on delete cascade,
  retailer_id integer references retailers(id),
  supplier_company_id uuid references companies(id),

  status send_status default 'queued',
  scheduled_for date,
  sent_at timestamptz,
  read_at timestamptz,
  read_manual_at timestamptz,
  expires_at timestamptz,

  position_in_queue integer,
  package_used text,
  cost_credits numeric(10,2) default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_sends_offer on sends(offer_id);
create index idx_sends_retailer on sends(retailer_id);
create index idx_sends_supplier on sends(supplier_company_id);
create index idx_sends_status on sends(status);

-- ===================================================================
-- BUYER_STARRED — ulubione oferty kupca
-- ===================================================================
create table buyer_starred (
  buyer_user_id uuid references auth.users(id) on delete cascade,
  send_id uuid references sends(id) on delete cascade,
  starred_at timestamptz default now(),
  primary key (buyer_user_id, send_id)
);

-- ===================================================================
-- WALLET_TX — transakcje portfela dostawcy
-- ===================================================================
create table wallet_tx (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade,
  type wallet_tx_type not null,
  amount numeric(10,2) not null,        -- może być ujemna
  currency text default 'EUR',
  description text,
  reference_id uuid,                    -- np. send_id lub package_id
  created_at timestamptz default now()
);
create index idx_wallet_company on wallet_tx(company_id);
create index idx_wallet_type on wallet_tx(type);

-- ===================================================================
-- PACKAGES — zakupione pakiety wysyłek
-- ===================================================================
create table packages (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade,
  plan text not null,                   -- 'std_10', 'prem_5', ...
  qty_total integer not null,
  qty_used integer default 0,
  price_paid numeric(10,2),
  currency text default 'EUR',
  purchased_at timestamptz default now(),
  expires_at date
);
create index idx_packages_company on packages(company_id);

-- ===================================================================
-- LIMITS — limity wysyłek per retailer (dla admina)
-- ===================================================================
create table retailer_limits (
  retailer_id integer primary key references retailers(id) on delete cascade,
  monthly_limit integer default 50,
  active boolean default true,
  updated_at timestamptz default now()
);

-- ===================================================================
-- FRESH MARKET (wydarzenie) — preferencje, odpowiedzi, schedule
-- ===================================================================
create table fm_settings (
  id uuid primary key default uuid_generate_v4(),
  venue text,
  event_date date,
  open_date timestamptz,
  message text,
  algo_phase text,
  schedule jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table fm_prefs (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer references retailers(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,  -- kategorie, kraje pochodzenia, etc.
  submitted_at timestamptz default now(),
  unique(retailer_id)
);

create table fm_resps (
  id uuid primary key default uuid_generate_v4(),
  retailer_id integer references retailers(id) on delete cascade,
  supplier_company_id uuid references companies(id) on delete cascade,
  position integer,
  zone text,                  -- 'green' | 'orange' | 'red' | 'blocked'
  status text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index idx_fm_resps_retailer on fm_resps(retailer_id);
create index idx_fm_resps_supplier on fm_resps(supplier_company_id);

-- ===================================================================
-- AUDIT LOG (przydatne dla admina)
-- ===================================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index idx_audit_user on audit_log(user_id);
create index idx_audit_entity on audit_log(entity, entity_id);

-- ===================================================================
-- AUTOMATYCZNE updated_at na tabelach
-- ===================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();
create trigger trg_companies_updated before update on companies for each row execute function set_updated_at();
create trigger trg_offers_updated before update on offers for each row execute function set_updated_at();
create trigger trg_sends_updated before update on sends for each row execute function set_updated_at();

-- ===================================================================
-- TRIGGER: po rejestracji w auth.users — twórz profil
-- ===================================================================
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'supplier')   -- domyślnie supplier; admin to zmieni
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===================================================================
-- POMOCNICZE FUNKCJE (do RLS)
-- UWAGA: nie nazywamy "current_role" bo to wbudowane słowo w SQL/PostgreSQL
-- ===================================================================
create or replace function app_role() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function app_company_id() returns uuid as $$
  select company_id from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function app_retailer_id() returns integer as $$
  select retailer_id from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function is_admin() returns boolean as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$ language sql security definer stable;
