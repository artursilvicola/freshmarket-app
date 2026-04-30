-- ===================================================================
-- Fresh Market — Legacy sync tables
-- Tabele pomocnicze dla migracji localStorage -> Supabase
-- Trzymają oferty i wysyłki w formacie zgodnym z PreconnectFM (JSONB)
-- ===================================================================

create table if not exists legacy_offers (
  id uuid primary key default uuid_generate_v4(),
  legacy_id bigint unique not null,           -- offer.id z PreconnectFM
  supplier_legacy_id text not null,           -- offer.supplierId
  status text,
  category text,
  origin text,
  data jsonb not null,                        -- pełna oferta w formacie legacy
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_legacy_offers_legacy_id on legacy_offers(legacy_id);
create index if not exists idx_legacy_offers_supplier on legacy_offers(supplier_legacy_id);
create index if not exists idx_legacy_offers_status on legacy_offers(status);

create table if not exists legacy_sends (
  id uuid primary key default uuid_generate_v4(),
  legacy_id bigint unique not null,           -- send.id
  supplier_legacy_id text not null,           -- send.supplierId
  offer_legacy_id bigint,                     -- send.offerId
  retailer_id integer,                        -- send.retailerId
  status text,                                -- send.status
  data jsonb not null,                        -- pełen send
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_legacy_sends_legacy_id on legacy_sends(legacy_id);
create index if not exists idx_legacy_sends_supplier on legacy_sends(supplier_legacy_id);
create index if not exists idx_legacy_sends_retailer on legacy_sends(retailer_id);
create index if not exists idx_legacy_sends_status on legacy_sends(status);

-- updated_at triggers
create trigger trg_legacy_offers_updated before update on legacy_offers for each row execute function set_updated_at();
create trigger trg_legacy_sends_updated before update on legacy_sends for each row execute function set_updated_at();

-- RLS
alter table legacy_offers enable row level security;
alter table legacy_sends enable row level security;

-- Każdy zalogowany user czyta wszystko (admin, supplier, buyer)
create policy "legacy_offers_read_authenticated" on legacy_offers
  for select using (auth.uid() is not null);

-- Każdy zalogowany user może zmieniać (na początek - potem zaostrzymy)
create policy "legacy_offers_modify_authenticated" on legacy_offers
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "legacy_sends_read_authenticated" on legacy_sends
  for select using (auth.uid() is not null);

create policy "legacy_sends_modify_authenticated" on legacy_sends
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
