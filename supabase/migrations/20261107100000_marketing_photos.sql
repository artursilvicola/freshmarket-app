-- ============================================================================
-- 20261107100000 — Marketing: biblioteka zdjęć do maili PreConnect (układ v2)
--
-- Zadanie Codexa 06.11 (kierunek Artura): mail z prawdziwym zdjęciem z Fresh Market, jedno zdjęcie
-- na kampanię (wspólne PL/EN), rotacja z biblioteki, ZAMROŻENIE obrazu przy zatwierdzeniu kampanii.
-- Plan: docs/production/mail-v2-makieta-2026-11-06/00-PLAN.md
--
-- Zasady (niezmienne):
--  * Pliki w Storage (bucket `marketing-photos`, publiczny ODCZYT — klient poczty musi pobrać obraz
--    bez logowania), metadane w bazie. Żadnego base64 w treści maila.
--  * ZAPIS do bucketa WYŁĄCZNIE funkcją Netlify z service_role (walidacja prawdziwego formatu,
--    wymiarów, rozmiaru). Brak polityk insert/update/delete dla anon/authenticated.
--  * Wersje plików są NIEZMIENNE: wiersz marketing_photo_versions nie podlega update/delete
--    (odebrane także service_role). Nowy plik = nowa wersja = NOWA ścieżka. Nigdy nie podmieniamy
--    pliku pod adresem użytym w wysłanym mailu.
--  * Wyłączenie zdjęcia (status disabled) nie psuje starych maili: ich HTML jest zamrożony
--    w marketing_messages, a plik zostaje w Storage.
--  * Kampania: photo_id (wybór w szkicu), photo_version_id (konkretny plik), layout_version (1 = stary
--    układ, 2 = układ ze zdjęciem). Zatwierdzenie zapisuje frozen_photo (id zdjęcia + wersji, adres
--    HTTPS, alt/podpis PL/EN, wymiary) — ponowienie/podgląd/test renderują z zamrożenia.
--  * Marketing nadal NIE rozlicza kredytów; migracja nie dotyka tabel rozliczeń.
--
-- Idempotentne: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS. Bez zmian w danych.
-- ============================================================================

begin;

-- ── 1. zdjęcia (metadane) ────────────────────────────────────────────────────
create table if not exists public.marketing_photos (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  alt_pl             text not null,
  alt_en             text not null,
  caption_pl         text,
  caption_en         text,
  kind               text not null default 'authentic' check (kind in ('authentic','ai')),
  source             text,                               -- skąd plik (np. Google Drive 2026/0131_R6M29805.jpg)
  rights             text,                               -- prawa / zgody
  categories         text[] not null default '{}',
  year               integer check (year is null or (year between 2000 and 2100)),
  status             text not null default 'pending' check (status in ('pending','ready','disabled')),
  review_note        text,                               -- np. „zapas — do przeglądu”
  source_sha256      text,                               -- odcisk ORYGINAŁU (wykrywanie duplikatów przy wgrywaniu)
  dhash              text,                               -- odcisk percepcyjny (9×8) wersji do maila
  current_version_id uuid,                               -- FK niżej (tabela wersji powstaje po tej)
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  approved_by        uuid references public.profiles(id) on delete set null,
  approved_at        timestamptz,
  disabled_by        uuid references public.profiles(id) on delete set null,
  disabled_at        timestamptz
);
comment on table public.marketing_photos is
  'Biblioteka zdjęć do maili marketingowych PreConnect (metadane; pliki w Storage marketing-photos). status: pending = wgrane, czeka na zatwierdzenie administratora; ready = w rotacji; disabled = wyłączone (stare maile nietknięte).';
create unique index if not exists uq_marketing_photos_source_sha256 on public.marketing_photos (source_sha256) where source_sha256 is not null;
create index if not exists ix_marketing_photos_status on public.marketing_photos (status, created_at);

-- ── 2. wersje plików (NIEZMIENNE) ────────────────────────────────────────────
create table if not exists public.marketing_photo_versions (
  id             uuid primary key default gen_random_uuid(),
  photo_id       uuid not null references public.marketing_photos(id) on delete restrict,
  version_no     integer not null check (version_no >= 1),
  storage_bucket text not null default 'marketing-photos',
  storage_path   text not null,
  public_url     text not null,
  width          integer not null check (width between 300 and 2400),
  height         integer not null check (height between 200 and 2400),
  bytes          integer not null check (bytes between 1000 and 2097152),
  mime           text not null check (mime in ('image/jpeg','image/png','image/webp')),
  sha256         text not null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (photo_id, version_no),
  unique (storage_path)
);
comment on table public.marketing_photo_versions is
  'Niezmienne wersje plików zdjęć (nowy plik = nowa wersja = nowa ścieżka). Brak update/delete dla wszystkich ról aplikacyjnych.';
create index if not exists ix_marketing_photo_versions_photo on public.marketing_photo_versions (photo_id, version_no desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_marketing_photos_current_version') then
    alter table public.marketing_photos
      add constraint fk_marketing_photos_current_version
      foreign key (current_version_id) references public.marketing_photo_versions(id) on delete set null;
  end if;
end $$;

-- blokada zmian wersji także dla właściciela wywołującego przez PostgREST: trigger odrzuca update/delete
create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
end $$;
drop trigger if exists trg_marketing_photo_versions_immutable on public.marketing_photo_versions;
create trigger trg_marketing_photo_versions_immutable
  before update or delete on public.marketing_photo_versions
  for each row execute function public.marketing_photo_versions_immutable();

-- ── 3. kampania: zdjęcie, wersja, układ, zamrożenie ─────────────────────────
alter table public.marketing_campaigns
  add column if not exists photo_id         uuid references public.marketing_photos(id) on delete set null,
  add column if not exists photo_version_id uuid references public.marketing_photo_versions(id) on delete set null,
  add column if not exists layout_version   integer not null default 1 check (layout_version in (1, 2)),
  add column if not exists frozen_photo     jsonb;
comment on column public.marketing_campaigns.photo_id is 'Zdjęcie wybrane w szkicu (jedno na kampanię, wspólne PL/EN). Zmiana tylko w szkicu, podbija content_version.';
comment on column public.marketing_campaigns.photo_version_id is 'Konkretny plik (wersja) wybrany w szkicu; przy zatwierdzeniu kopiowany do frozen_photo.';
comment on column public.marketing_campaigns.layout_version is '1 = układ bez zdjęcia (kampanie sprzed 07.11), 2 = jasny nagłówek + zdjęcie z biblioteki.';
comment on column public.marketing_campaigns.frozen_photo is 'Zamrożone przy zatwierdzeniu: {photo_id, version_id, url, alt_pl, alt_en, caption_pl, caption_en, width, height}. Null = kampania bez zdjęcia.';
create index if not exists ix_marketing_campaigns_photo on public.marketing_campaigns (photo_id) where photo_id is not null;

-- ── 4. historia użycia (do rotacji i panelu) ─────────────────────────────────
-- Jeden wiersz = jedna kampania z przypisanym zdjęciem (z szkicu albo z zamrożenia). sent_count liczy
-- PRAWDZIWE wysyłki przyjęte przez dostawcę poczty (bez testów) — „kampania, która faktycznie wysyłała”.
create or replace view public.marketing_photo_usage
with (security_invoker = true) as
select
  coalesce(nullif(c.frozen_photo->>'photo_id','')::uuid, c.photo_id)         as photo_id,
  coalesce(nullif(c.frozen_photo->>'version_id','')::uuid, c.photo_version_id) as photo_version_id,
  c.id                                                                        as campaign_id,
  c.name                                                                      as campaign_name,
  c.status                                                                    as campaign_status,
  c.template_key,
  c.created_at,
  c.approved_at,
  c.closed_at,
  (select count(*)::int from public.marketing_messages m
     where m.campaign_id = c.id and m.is_test = false and m.state in ('accepted'))     as sent_count,
  (select min(m.sent_at) from public.marketing_messages m
     where m.campaign_id = c.id and m.is_test = false and m.state in ('accepted'))     as first_sent_at,
  (select max(m.sent_at) from public.marketing_messages m
     where m.campaign_id = c.id and m.is_test = false and m.state in ('accepted'))     as last_sent_at
from public.marketing_campaigns c
where c.photo_id is not null or nullif(c.frozen_photo->>'photo_id','') is not null;
comment on view public.marketing_photo_usage is
  'Użycie zdjęć w kampaniach (szkic + zamrożenie). sent_count > 0 = kampania faktycznie wysyłała (bez testów).';

-- ── 5. uprawnienia / RLS ─────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['marketing_photos','marketing_photo_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_read', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;
grant select, insert, update on table public.marketing_photos to service_role;
revoke delete on table public.marketing_photos from service_role;              -- zdjęć nie kasujemy, tylko wyłączamy
grant select, insert on table public.marketing_photo_versions to service_role;
revoke update, delete on table public.marketing_photo_versions from service_role; -- niezmienne
revoke all on public.marketing_photo_usage from public, anon, authenticated;
grant select on public.marketing_photo_usage to authenticated, service_role;    -- security_invoker: admin przez RLS tabel
revoke all on function public.marketing_photo_versions_immutable() from public, anon, authenticated;

-- ── 6. Storage: bucket publiczny do ODCZYTU, zapis tylko service_role (bez polityk zapisu) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-photos', 'marketing-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketing_photos_public_read" on storage.objects;
create policy "marketing_photos_public_read" on storage.objects
  for select using (bucket_id = 'marketing-photos');
-- celowo BRAK polityk insert/update/delete: anon/authenticated nie zapisują; funkcja Netlify (service_role) omija RLS
drop policy if exists "marketing_photos_admin_insert" on storage.objects;
drop policy if exists "marketing_photos_admin_update" on storage.objects;
drop policy if exists "marketing_photos_admin_delete" on storage.objects;

commit;
