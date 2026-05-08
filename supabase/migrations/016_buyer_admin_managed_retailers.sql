-- ===================================================================
-- 016 - buyer-admin-managed-retailers
-- Cel:
--   - sieci handlowe maja komplet pol admin-managed
--   - kupcy sa prawdziwymi kontami w profiles przypietymi do retailer_id
--   - admin moze aktywowac/dezaktywowac kupca i oznaczyc FM 2026
-- ===================================================================

begin;

alter table public.retailers
  add column if not exists logo_url text,
  add column if not exists active boolean default true,
  add column if not exists fm26_active boolean default false,
  add column if not exists fm26_chain_id text,
  add column if not exists description text;

update public.retailers
set active = true
where active is null;

update public.retailers
set fm26_chain_id = legacy_chain_id
where fm26_chain_id is null and legacy_chain_id is not null;

update public.retailers
set fm26_active = true
where fm26_active is distinct from true
  and (fm26_chain_id is not null or legacy_chain_id is not null);

alter table public.profiles
  add column if not exists active boolean default true,
  add column if not exists fm26_active boolean default false,
  add column if not exists buyer_categories text[] default '{}';

update public.profiles
set active = true
where active is null;

update public.profiles
set buyer_categories = '{}'
where buyer_categories is null;

create index if not exists idx_profiles_role_retailer on public.profiles(role, retailer_id);

comment on column public.retailers.fm26_chain_id is
  'Jawny identyfikator sieci uzywany w module Spotkania FM 2026 (np. ch5).';

comment on column public.retailers.description is
  'Opis / notatka administracyjna dla sieci handlowej.';

comment on column public.profiles.active is
  'Czy kupiec lub inny uzytkownik jest aktywny w panelu B2B.';

comment on column public.profiles.fm26_active is
  'Czy kupiec bierze udzial w module Fresh Market 2026.';

comment on column public.profiles.buyer_categories is
  'Kategorie za ktore odpowiada kupiec w swojej sieci handlowej.';

commit;
