-- Wdrożenie mail v2 + biblioteka zdjęć: 8 migracji w kolejności, każda we własnej transakcji (begin/commit z pliku).
-- Złożone 1:1 z supabase/migrations/ (scripts/marketing-photos-deploy-check.mjs --write). Tylko projekt sklyfuvzjikkqerxtulo, jeden Run.

-- ===== PLIK: 20261107100000_marketing_photos.sql =====
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

-- ===== PLIK: 20261107110000_marketing_photo_versions_approval.sql =====
-- ============================================================================
-- 20261107110000 — Marketing: biblioteka zdjęć — wersje oczekujące PRYWATNE, zatwierdzenie per wersja
--
-- Review Codexa (06.11, gałąź feat/marketing-photos):
--  P1  wgrany plik trafiał od razu do publicznego bucketa (także status pending) — zatwierdzenie ograniczało tylko
--      wybór w panelu, nie dostęp do zdjęcia.
--  P2  nowa wersja zatwierdzonego zdjęcia podmieniała current_version_id i dziedziczyła status ready — nowy kadr
--      mógł wejść do rotacji bez ponownej akceptacji.
--
-- Rozwiązanie:
--  * bucket `marketing-photos-pending` — PRYWATNY (bez polityk; tylko service_role przez funkcję). Każdy upload ląduje tam.
--  * marketing_photo_versions: `public_url` dopuszcza NULL (= nieopublikowana), `published_at/published_by`.
--    Publikacja = funkcja kopiuje bajty pod NIEZMIENNĄ ścieżkę w publicznym `marketing-photos` i ustawia public_url.
--    Niezmienność: trigger dopuszcza WYŁĄCZNIE przejście publikacji (storage_bucket/storage_path/public_url/published_*)
--    przy identycznych pozostałych kolumnach, oraz cofnięcie publikacji wersji, której NIE używa żadna kampania
--    (porządki na bazie testowej). Wersja opublikowana i użyta w kampanii jest nietykalna. DELETE nadal zabroniony.
--  * marketing_photos.approved_version_id — konkretna ZATWIERDZONA (i opublikowana) wersja, której używa rotacja
--    i wybór w kampanii. current_version_id = ostatnio wgrany plik (może czekać na akceptację). Nowy kadr nie dziedziczy
--    zatwierdzenia poprzedniego: do rotacji wchodzi dopiero po `approve` z jego version_id.
--
-- Dane istniejące: wersje z public_url dostają published_at = created_at (były publiczne); zdjęcia `ready` dostają
-- approved_version_id = current_version_id. Pliki pending opublikowane przed tą migracją porządkuje osobny skrypt
-- (scripts/marketing-photos-unpublish-pending.mjs) po sprawdzeniu użycia.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

-- ── 1. wersje: publikacja jako osobny krok ───────────────────────────────────
alter table public.marketing_photo_versions
  alter column public_url drop not null,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id) on delete set null;
comment on column public.marketing_photo_versions.published_at is 'NULL = plik tylko w prywatnym buckecie marketing-photos-pending (czeka na zatwierdzenie). Ustawione = skopiowany pod niezmienny adres w publicznym marketing-photos.';

-- ── 1b. trigger niezmienności: tylko przejścia publikacji (PRZED backfillem — stary trigger odrzuciłby update) ──
create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
declare
  referenced boolean;
begin
  if TG_OP = 'DELETE' then
    raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
  end if;
  -- kolumny tożsamości pliku nigdy się nie zmieniają
  if new.id is distinct from old.id or new.photo_id is distinct from old.photo_id or new.version_no is distinct from old.version_no
     or new.width is distinct from old.width or new.height is distinct from old.height or new.bytes is distinct from old.bytes
     or new.mime is distinct from old.mime or new.sha256 is distinct from old.sha256
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'marketing_photo_versions is immutable (only publication fields may change)' using errcode = 'P0001';
  end if;
  -- publikacja: pending → published (raz)
  if old.published_at is null and new.published_at is not null then
    if new.public_url is null or new.public_url not like 'https://%' then
      raise exception 'publication requires https public_url' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- cofnięcie publikacji (porządki): tylko wersja nieużywana przez żadną kampanię ani jako zatwierdzona
  if old.published_at is not null and new.published_at is null then
    select exists (
      select 1 from public.marketing_campaigns c
        where c.photo_version_id = old.id or nullif(c.frozen_photo->>'version_id','')::uuid = old.id
      union all
      select 1 from public.marketing_photos p where p.approved_version_id = old.id
    ) into referenced;
    if referenced then
      raise exception 'published version is referenced by a campaign or approved photo and cannot be unpublished' using errcode = 'P0001';
    end if;
    if new.public_url is not null then
      raise exception 'unpublished version must have null public_url' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- każda inna zmiana (np. podmiana adresu opublikowanej wersji) zabroniona
  if new.public_url is distinct from old.public_url or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path or new.published_by is distinct from old.published_by then
    raise exception 'published marketing_photo_versions row is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_photo_versions_immutable on public.marketing_photo_versions;
create trigger trg_marketing_photo_versions_immutable
  before update or delete on public.marketing_photo_versions
  for each row execute function public.marketing_photo_versions_immutable();

-- service_role: UPDATE tylko kolumn publikacji (reszta i tak pilnowana triggerem); DELETE nadal odebrany
grant update (storage_bucket, storage_path, public_url, published_at, published_by) on table public.marketing_photo_versions to service_role;
revoke delete on table public.marketing_photo_versions from service_role;


-- dane sprzed tej migracji: wersja z adresem była publiczna od chwili wgrania (porządki pending — osobny skrypt)
-- UWAGA: najpierw backfill, potem check — inaczej istniejące wiersze łamią ograniczenie i migracja się wycofuje
update public.marketing_photo_versions set published_at = created_at where public_url is not null and published_at is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_marketing_photo_versions_published_url') then
    alter table public.marketing_photo_versions
      add constraint ck_marketing_photo_versions_published_url
      check ((published_at is null and public_url is null) or (published_at is not null and public_url like 'https://%'));
  end if;
end $$;

-- ── 2. zdjęcie: zatwierdzona wersja ≠ ostatnio wgrana ───────────────────────
alter table public.marketing_photos
  add column if not exists approved_version_id uuid references public.marketing_photo_versions(id) on delete set null;
comment on column public.marketing_photos.approved_version_id is 'Konkretna zatwierdzona i opublikowana wersja pliku używana przez rotację i wybór w kampanii. current_version_id = ostatnio wgrany kadr (może czekać na akceptację).';
update public.marketing_photos p set approved_version_id = p.current_version_id
  where p.status = 'ready' and p.approved_version_id is null
    and exists (select 1 from public.marketing_photo_versions v where v.id = p.current_version_id and v.published_at is not null);

-- ── 3. prywatny bucket na wersje oczekujące: bez polityk = tylko service_role ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-photos-pending', 'marketing-photos-pending', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "marketing_photos_pending_read" on storage.objects;
drop policy if exists "marketing_photos_pending_insert" on storage.objects;

commit;

-- ===== PLIK: 20261107120000_marketing_photo_unpublish_state.sql =====
-- ============================================================================
-- 20261107120000 — Marketing: biblioteka zdjęć — trwały, ponawialny stan wycofywania publikacji wersji
--
-- Review Codexa (e3f14b3, narzędzie porządkowe):
--  P1  plik publiczny był usuwany ZANIM baza sprawdziła, czy wolno (trigger odrzucał dopiero zapis wiersza) — kampania,
--      która w międzyczasie przypisała wersję, wskazywała plik, którego już nie ma.
--  P2  każdy błąd pobrania (także przejściowy 503) był traktowany jak „brak pliku” (poprawka w kodzie funkcji).
--
-- Rozwiązanie (bez odwracania kolejności operacji na plikach):
--  * marketing_photo_versions.unpublishing_at — stan „wycofywanie w toku”, ZAJMOWANY ATOMOWO jednym UPDATE w funkcji
--    marketing_photo_version_claim_unpublish(): tylko wersja opublikowana, NIEużywana przez żadną kampanię (photo_version_id,
--    frozen_photo) i NIEbędąca zatwierdzoną wersją zdjęcia. Ponowne zajęcie już zajętej wersji = sukces (ponawialność).
--  * Dopóki unpublishing_at jest ustawione, triggery w bazie BLOKUJĄ: przypisanie tej wersji do kampanii (insert/update
--    photo_version_id) i zatwierdzenie jej jako approved_version_id. Dopiero po zajęciu kod usuwa plik; cofnięcie
--    publikacji (published_at → NULL) wymaga wcześniejszego zajęcia (trigger niezmienności).
--  * marketing_photo_version_release_unpublish() zwalnia stan (plik nadal publiczny) — ręczne odblokowanie po nieudanej próbie.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

alter table public.marketing_photo_versions
  add column if not exists unpublishing_at timestamptz,
  add column if not exists unpublishing_by uuid references public.profiles(id) on delete set null;
comment on column public.marketing_photo_versions.unpublishing_at is 'Wycofywanie publikacji w toku (zajęte atomowo po sprawdzeniu użycia). Blokuje przypisania do kampanii i zatwierdzenia tej wersji do czasu zakończenia.';

-- ── 1. zajęcie / zwolnienie stanu (service_role) ────────────────────────────
create or replace function public.marketing_photo_version_claim_unpublish(p_version_id uuid, p_by uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.marketing_photo_versions v
     set unpublishing_at = coalesce(v.unpublishing_at, now()), unpublishing_by = coalesce(v.unpublishing_by, p_by)
   where v.id = p_version_id
     and v.published_at is not null
     and not exists (select 1 from public.marketing_campaigns c
                      where c.photo_version_id = v.id or nullif(c.frozen_photo->>'version_id','')::uuid = v.id)
     and not exists (select 1 from public.marketing_photos p where p.approved_version_id = v.id);
  get diagnostics n = row_count;
  return n = 1;
end $$;
create or replace function public.marketing_photo_version_release_unpublish(p_version_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.marketing_photo_versions set unpublishing_at = null, unpublishing_by = null
   where id = p_version_id and unpublishing_at is not null and published_at is not null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.marketing_photo_version_claim_unpublish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.marketing_photo_version_release_unpublish(uuid) from public, anon, authenticated;
grant execute on function public.marketing_photo_version_claim_unpublish(uuid, uuid) to service_role;
grant execute on function public.marketing_photo_version_release_unpublish(uuid) to service_role;
grant update (unpublishing_at, unpublishing_by) on table public.marketing_photo_versions to service_role;

-- ── 2. trigger niezmienności: cofnięcie publikacji tylko po zajęciu; pola stanu zmienne ─
create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
declare
  referenced boolean;
begin
  if TG_OP = 'DELETE' then
    raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.photo_id is distinct from old.photo_id or new.version_no is distinct from old.version_no
     or new.width is distinct from old.width or new.height is distinct from old.height or new.bytes is distinct from old.bytes
     or new.mime is distinct from old.mime or new.sha256 is distinct from old.sha256
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'marketing_photo_versions is immutable (only publication fields may change)' using errcode = 'P0001';
  end if;
  -- publikacja: pending → published (raz)
  if old.published_at is null and new.published_at is not null then
    if new.public_url is null or new.public_url not like 'https://%' then
      raise exception 'publication requires https public_url' using errcode = 'P0001';
    end if;
    if new.unpublishing_at is not null then
      raise exception 'cannot publish a version marked for unpublishing' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- cofnięcie publikacji: WYŁĄCZNIE po zajęciu stanu (claim) i tylko wersja nieużywana
  if old.published_at is not null and new.published_at is null then
    if old.unpublishing_at is null then
      raise exception 'unpublish requires a prior claim (marketing_photo_version_claim_unpublish)' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.marketing_campaigns c
        where c.photo_version_id = old.id or nullif(c.frozen_photo->>'version_id','')::uuid = old.id
      union all
      select 1 from public.marketing_photos p where p.approved_version_id = old.id
    ) into referenced;
    if referenced then
      raise exception 'published version is referenced by a campaign or approved photo and cannot be unpublished' using errcode = 'P0001';
    end if;
    if new.public_url is not null then
      raise exception 'unpublished version must have null public_url' using errcode = 'P0001';
    end if;
    new.unpublishing_at := null; new.unpublishing_by := null;  -- stan zakończony
    return new;
  end if;
  -- poza publikacją/wycofaniem zmienne są tylko pola stanu wycofywania
  if new.public_url is distinct from old.public_url or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'published marketing_photo_versions row is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_photo_versions_immutable on public.marketing_photo_versions;
create trigger trg_marketing_photo_versions_immutable
  before update or delete on public.marketing_photo_versions
  for each row execute function public.marketing_photo_versions_immutable();

-- ── 3. blokady na czas wycofywania: przypisanie do kampanii i zatwierdzenie ──
create or replace function public.marketing_photo_version_usable(p_version_id uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.marketing_photo_versions v
                  where v.id = p_version_id and v.published_at is not null and v.unpublishing_at is null)
$$;
revoke all on function public.marketing_photo_version_usable(uuid) from public, anon, authenticated;
grant execute on function public.marketing_photo_version_usable(uuid) to service_role;

create or replace function public.marketing_campaigns_photo_version_guard()
returns trigger language plpgsql as $$
begin
  if new.photo_version_id is not null and (TG_OP = 'INSERT' or new.photo_version_id is distinct from old.photo_version_id) then
    if not public.marketing_photo_version_usable(new.photo_version_id) then
      raise exception 'photo version is not published or is being unpublished' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_campaigns_photo_version_guard on public.marketing_campaigns;
create trigger trg_marketing_campaigns_photo_version_guard
  before insert or update of photo_version_id on public.marketing_campaigns
  for each row execute function public.marketing_campaigns_photo_version_guard();

create or replace function public.marketing_photos_approved_version_guard()
returns trigger language plpgsql as $$
begin
  if new.approved_version_id is not null and (TG_OP = 'INSERT' or new.approved_version_id is distinct from old.approved_version_id) then
    if not public.marketing_photo_version_usable(new.approved_version_id) then
      raise exception 'approved version must be published and not being unpublished' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_photos_approved_version_guard on public.marketing_photos;
create trigger trg_marketing_photos_approved_version_guard
  before insert or update of approved_version_id on public.marketing_photos
  for each row execute function public.marketing_photos_approved_version_guard();

commit;

-- ===== PLIK: 20261107130000_marketing_photo_unpublish_locks.sql =====
-- ============================================================================
-- 20261107130000 — Marketing: biblioteka zdjęć — wspólna blokada wiersza wersji (wyścig transakcji)
--
-- Review Codexa (7fa031f) P1: strażnicy sprawdzali dostępność wersji zwykłym SELECT, bez wspólnej blokady z zajęciem
-- do wycofania. Dwie równoległe transakcje (przypisanie / zatwierdzenie vs. zajęcie) mogły obie przejść: READ COMMITTED
-- daje każdej własną migawkę, a zajęcie oceniało NOT EXISTS na migawce sprzed przypisania.
--
-- Rozwiązanie: WSZYSTKIE trzy operacje biorą blokadę tego samego wiersza marketing_photo_versions:
--  * zajęcie do wycofania: SELECT … FOR UPDATE (czeka na zwolnienie blokad współdzielonych), a DOPIERO PO uzyskaniu blokady
--    osobna instrukcja sprawdza użycie (nowa migawka widzi zatwierdzone w międzyczasie przypisanie) i dopiero wtedy UPDATE;
--  * strażnicy przypisania (marketing_campaigns.photo_version_id, frozen_photo) i zatwierdzenia (marketing_photos.approved_version_id):
--    SELECT … FOR SHARE — czekają na trwające zajęcie, a po uzyskaniu blokady widzą NAJNOWSZĄ wersję wiersza
--    (unpublishing_at ustawione → odmowa). Dwie transakcje nie mogą więc obie przejść: albo przypisanie zdąży przed zajęciem
--    (zajęcie po blokadzie widzi referencję → false), albo zajęcie zdąży (przypisanie po blokadzie widzi stan → wyjątek).
-- Test dwóch niezależnych połączeń: scripts/marketing-photos-race-test.mjs (baza testowa, prawdziwy Postgres).
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

-- ── 1. zajęcie: blokada wiersza, potem kontrola użycia, potem UPDATE ─────────
create or replace function public.marketing_photo_version_claim_unpublish(p_version_id uuid, p_by uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row public.marketing_photo_versions%rowtype;
  referenced boolean;
begin
  -- 1) blokada wyłączna wiersza wersji: czeka na transakcje, które właśnie przypisują/zatwierdzają tę wersję (FOR SHARE)
  select * into v_row from public.marketing_photo_versions where id = p_version_id for update;
  if not found or v_row.published_at is null then return false; end if;
  -- 2) kontrola użycia PO uzyskaniu blokady — osobna instrukcja = świeża migawka (READ COMMITTED), widzi zatwierdzone przypisania
  select exists (
    select 1 from public.marketing_campaigns c
      where c.photo_version_id = p_version_id or nullif(c.frozen_photo->>'version_id','')::uuid = p_version_id
    union all
    select 1 from public.marketing_photos p where p.approved_version_id = p_version_id
  ) into referenced;
  if referenced then return false; end if;
  -- 3) zajęcie (ponowne zajęcie już zajętej = sukces)
  update public.marketing_photo_versions
     set unpublishing_at = coalesce(unpublishing_at, now()), unpublishing_by = coalesce(unpublishing_by, p_by)
   where id = p_version_id;
  return true;
end $$;

-- ── 2. strażnicy: blokada współdzielona + ocena NAJNOWSZEGO wiersza ─────────
-- (funkcja musi być VOLATILE — FOR SHARE nie jest dozwolone w funkcji STABLE)
create or replace function public.marketing_photo_version_usable(p_version_id uuid)
returns boolean language plpgsql volatile as $$
declare ok boolean;
begin
  select (v.published_at is not null and v.unpublishing_at is null) into ok
    from public.marketing_photo_versions v where v.id = p_version_id for share;
  return coalesce(ok, false);
end $$;
revoke all on function public.marketing_photo_version_usable(uuid) from public, anon, authenticated;
grant execute on function public.marketing_photo_version_usable(uuid) to service_role;

create or replace function public.marketing_campaigns_photo_version_guard()
returns trigger language plpgsql as $$
declare frozen_v uuid;
begin
  if new.photo_version_id is not null and (TG_OP = 'INSERT' or new.photo_version_id is distinct from old.photo_version_id) then
    if not public.marketing_photo_version_usable(new.photo_version_id) then
      raise exception 'photo version is not published or is being unpublished' using errcode = 'P0001';
    end if;
  end if;
  -- zamrożenie zdjęcia w kampanii też bierze blokadę współdzieloną (ta sama wersja, ten sam wyścig)
  frozen_v := nullif(new.frozen_photo->>'version_id','')::uuid;
  if frozen_v is not null and (TG_OP = 'INSERT' or frozen_v is distinct from nullif(old.frozen_photo->>'version_id','')::uuid) then
    if not public.marketing_photo_version_usable(frozen_v) then
      raise exception 'frozen photo version is not published or is being unpublished' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_campaigns_photo_version_guard on public.marketing_campaigns;
create trigger trg_marketing_campaigns_photo_version_guard
  before insert or update of photo_version_id, frozen_photo on public.marketing_campaigns
  for each row execute function public.marketing_campaigns_photo_version_guard();

-- strażnik zatwierdzenia bez zmian logicznych — korzysta z nowej, blokującej wersji marketing_photo_version_usable()

commit;

-- ===== PLIK: 20261107140000_marketing_photo_drop_release.sql =====
-- ============================================================================
-- 20261107140000 — Marketing: biblioteka zdjęć — usunięcie ręcznego zwalniania stanu wycofywania
--
-- Review Codexa (e4513f2) P1: `--release` mógł odblokować wersję, którą drugi proces właśnie wycofywał (blokady SQL nie
-- obejmują operacji w Storage). Decyzja: bezpieczne zwalnianie nie jest potrzebne — stan `unpublishing_at` kończy WYŁĄCZNIE
-- dokończone wycofanie publikacji (trigger zeruje go przy published_at → NULL). Wycofanie jest idempotentne i ponawialne,
-- więc „utknięty” stan rozwiązuje się przez ponowne uruchomienie skryptu porządkowego, nigdy przez wyzerowanie znacznika.
--  * funkcja marketing_photo_version_release_unpublish — USUNIĘTA;
--  * service_role traci UPDATE kolumn unpublishing_at/unpublishing_by (ustawia je tylko RPC claim, zeruje trigger);
--  * trigger niezmienności: zmiana unpublishing_at poza zajęciem (NULL → wartość przez RPC) i zakończeniem wycofania
--    jest odrzucana — także dla właściciela bazy (porządki testowe muszą dokończyć wycofanie, nie „odblokować”).
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

drop function if exists public.marketing_photo_version_release_unpublish(uuid);
revoke update (unpublishing_at, unpublishing_by) on table public.marketing_photo_versions from service_role;

create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
declare
  referenced boolean;
begin
  if TG_OP = 'DELETE' then
    raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.photo_id is distinct from old.photo_id or new.version_no is distinct from old.version_no
     or new.width is distinct from old.width or new.height is distinct from old.height or new.bytes is distinct from old.bytes
     or new.mime is distinct from old.mime or new.sha256 is distinct from old.sha256
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'marketing_photo_versions is immutable (only publication fields may change)' using errcode = 'P0001';
  end if;
  -- publikacja: pending → published (raz)
  if old.published_at is null and new.published_at is not null then
    if new.public_url is null or new.public_url not like 'https://%' then
      raise exception 'publication requires https public_url' using errcode = 'P0001';
    end if;
    if new.unpublishing_at is not null then
      raise exception 'cannot publish a version marked for unpublishing' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- cofnięcie publikacji: WYŁĄCZNIE po zajęciu stanu (claim) i tylko wersja nieużywana; kończy stan
  if old.published_at is not null and new.published_at is null then
    if old.unpublishing_at is null then
      raise exception 'unpublish requires a prior claim (marketing_photo_version_claim_unpublish)' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.marketing_campaigns c
        where c.photo_version_id = old.id or nullif(c.frozen_photo->>'version_id','')::uuid = old.id
      union all
      select 1 from public.marketing_photos p where p.approved_version_id = old.id
    ) into referenced;
    if referenced then
      raise exception 'published version is referenced by a campaign or approved photo and cannot be unpublished' using errcode = 'P0001';
    end if;
    if new.public_url is not null then
      raise exception 'unpublished version must have null public_url' using errcode = 'P0001';
    end if;
    new.unpublishing_at := null; new.unpublishing_by := null;
    return new;
  end if;
  -- poza publikacją/wycofaniem: pola pliku i publikacji nietykalne
  if new.public_url is distinct from old.public_url or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'published marketing_photo_versions row is immutable' using errcode = 'P0001';
  end if;
  -- stan wycofywania: wolno tylko ZAJĄĆ (NULL → wartość, przez RPC claim); zwolnienie bez dokończenia wycofania zabronione
  if old.unpublishing_at is not null and new.unpublishing_at is null then
    raise exception 'unpublishing state can only end by completing the unpublish (no manual release)' using errcode = 'P0001';
  end if;
  if old.unpublishing_at is not null and new.unpublishing_at is distinct from old.unpublishing_at then
    raise exception 'unpublishing_at cannot be changed once set' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_photo_versions_immutable on public.marketing_photo_versions;
create trigger trg_marketing_photo_versions_immutable
  before update or delete on public.marketing_photo_versions
  for each row execute function public.marketing_photo_versions_immutable();

commit;

-- ===== PLIK: 20261107150000_marketing_photo_unpublish_final.sql =====
-- ============================================================================
-- 20261107150000 — Marketing: biblioteka zdjęć — wycofanie publikacji wersji jest NIEODWRACALNE
--
-- Decyzja Artura (po review Codexa, 06.11): wycofana wersja nigdy nie wraca do publikacji. Trwały znacznik
-- `unpublished_at` ustawia trigger w chwili zakończenia wycofania (published_at → NULL) i nie da się go wyzerować.
-- Ponowna publikacja takiej wersji jest odrzucana w bazie (i w kodzie, przed operacjami Storage). Ponowne użycie
-- zdjęcia = NOWA wersja pliku z NOWĄ ścieżką (upload → approve), nigdy ten sam wiersz.
-- Zamyka to ostatni wyścig narzędzia porządkowego: starszy, wznowiony proces nie może „odpublikować” ani „opublikować”
-- czegoś, co drugi proces już domknął — stan końcowy wersji jest jeden i trwały.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

alter table public.marketing_photo_versions
  add column if not exists unpublished_at timestamptz;
comment on column public.marketing_photo_versions.unpublished_at is 'Trwały znacznik: wersja wycofana z publikacji (plik usunięty z publicznego bucketa). NIEODWRACALNE — ponowna publikacja tej wersji odrzucana; ponowne użycie zdjęcia = nowa wersja z nową ścieżką.';
-- dane sprzed migracji: wersje bez publikacji, które kiedyś były opublikowane, nie są rozpoznawalne — zostają jak są (pending).

create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
declare
  referenced boolean;
begin
  if TG_OP = 'DELETE' then
    raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.photo_id is distinct from old.photo_id or new.version_no is distinct from old.version_no
     or new.width is distinct from old.width or new.height is distinct from old.height or new.bytes is distinct from old.bytes
     or new.mime is distinct from old.mime or new.sha256 is distinct from old.sha256
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'marketing_photo_versions is immutable (only publication fields may change)' using errcode = 'P0001';
  end if;
  -- trwały znacznik wycofania: nigdy nie znika ani się nie zmienia
  if old.unpublished_at is not null and new.unpublished_at is distinct from old.unpublished_at then
    raise exception 'unpublished_at is permanent' using errcode = 'P0001';
  end if;
  -- publikacja: pending → published (raz; NIGDY dla wersji wycofanej)
  if old.published_at is null and new.published_at is not null then
    if old.unpublished_at is not null then
      raise exception 'version was unpublished and cannot be published again (create a new version with a new path)' using errcode = 'P0001';
    end if;
    if new.unpublished_at is not null then
      raise exception 'cannot publish and mark unpublished at once' using errcode = 'P0001';
    end if;
    if new.public_url is null or new.public_url not like 'https://%' then
      raise exception 'publication requires https public_url' using errcode = 'P0001';
    end if;
    if new.unpublishing_at is not null then
      raise exception 'cannot publish a version marked for unpublishing' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- cofnięcie publikacji: WYŁĄCZNIE po zajęciu stanu (claim) i tylko wersja nieużywana; kończy stan i stawia TRWAŁY znacznik
  if old.published_at is not null and new.published_at is null then
    if old.unpublishing_at is null then
      raise exception 'unpublish requires a prior claim (marketing_photo_version_claim_unpublish)' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.marketing_campaigns c
        where c.photo_version_id = old.id or nullif(c.frozen_photo->>'version_id','')::uuid = old.id
      union all
      select 1 from public.marketing_photos p where p.approved_version_id = old.id
    ) into referenced;
    if referenced then
      raise exception 'published version is referenced by a campaign or approved photo and cannot be unpublished' using errcode = 'P0001';
    end if;
    if new.public_url is not null then
      raise exception 'unpublished version must have null public_url' using errcode = 'P0001';
    end if;
    new.unpublishing_at := null; new.unpublishing_by := null;
    new.unpublished_at := coalesce(old.unpublished_at, now());
    return new;
  end if;
  -- poza publikacją/wycofaniem: pola pliku i publikacji nietykalne, znacznik wycofania nie do ustawienia ręcznie
  if new.public_url is distinct from old.public_url or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'published marketing_photo_versions row is immutable' using errcode = 'P0001';
  end if;
  if new.unpublished_at is distinct from old.unpublished_at then
    raise exception 'unpublished_at is set only by completing an unpublish' using errcode = 'P0001';
  end if;
  -- stan wycofywania: wolno tylko ZAJĄĆ (NULL → wartość, przez RPC claim); zwolnienie bez dokończenia wycofania zabronione
  if old.unpublishing_at is not null and new.unpublishing_at is null then
    raise exception 'unpublishing state can only end by completing the unpublish (no manual release)' using errcode = 'P0001';
  end if;
  if old.unpublishing_at is not null and new.unpublishing_at is distinct from old.unpublishing_at then
    raise exception 'unpublishing_at cannot be changed once set' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_marketing_photo_versions_immutable on public.marketing_photo_versions;
create trigger trg_marketing_photo_versions_immutable
  before update or delete on public.marketing_photo_versions
  for each row execute function public.marketing_photo_versions_immutable();

-- zajęcie do wycofania: wersja już wycofana nie jest zajmowana (nic do zrobienia) — claim zwraca false
create or replace function public.marketing_photo_version_claim_unpublish(p_version_id uuid, p_by uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row public.marketing_photo_versions%rowtype;
  referenced boolean;
begin
  select * into v_row from public.marketing_photo_versions where id = p_version_id for update;
  if not found or v_row.published_at is null or v_row.unpublished_at is not null then return false; end if;
  select exists (
    select 1 from public.marketing_campaigns c
      where c.photo_version_id = p_version_id or nullif(c.frozen_photo->>'version_id','')::uuid = p_version_id
    union all
    select 1 from public.marketing_photos p where p.approved_version_id = p_version_id
  ) into referenced;
  if referenced then return false; end if;
  update public.marketing_photo_versions
     set unpublishing_at = coalesce(unpublishing_at, now()), unpublishing_by = coalesce(unpublishing_by, p_by)
   where id = p_version_id;
  return true;
end $$;

commit;

-- ===== PLIK: 20261107160000_marketing_suppression_lifts.sql =====
-- ============================================================================
-- 20261107160000 — Marketing: zniesienie wypisu tylko z zapisaną ponowną zgodą, z zachowaniem historii
--
-- Review Codexa (07.11): „wypisów nie usuwajmy bez śladu” — samo „wdrażaj” nie cofa wypisu.
--  * marketing_suppression_lifts: rejestr TYLKO DO DOPISYWANIA. Każde zniesienie = wiersz z kopią pierwotnego wypisu,
--    dosłowną treścią zgody, źródłem zgody i osobą, która zgodę wyraziła.
--  * marketing_lift_suppression(): jedyna droga zniesienia. Znosi WYŁĄCZNIE wypis z powodu `unsubscribe` (własna decyzja
--    adresata). Odbicie, skarga i blokada ręczna zostają: tych nie cofa zgoda w czacie.
--  * Trigger na marketing_suppressions: usunięcie wiersza bez wpisu w rejestrze jest odrzucane — także dla właściciela bazy.
-- Kolejny wypis tego samego adresu działa jak dotąd (nowy wiersz), a następne zniesienie wymaga nowej zgody.
-- Silnik wysyłki (claim, precheck, kandydaci) bez zmian: nadal patrzy tylko na marketing_suppressions.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

create table if not exists public.marketing_suppression_lifts (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  suppression       jsonb not null,            -- pełna kopia wiersza wypisu z chwili zniesienia
  consent_text      text not null check (length(btrim(consent_text)) >= 10),
  consent_source    text not null check (length(btrim(consent_source)) >= 3),
  consent_given_by  text not null check (length(btrim(consent_given_by)) >= 3),
  lifted_at         timestamptz not null default now()
);
comment on table public.marketing_suppression_lifts is
  'Rejestr zniesień wypisu (tylko dopisywanie): kopia pierwotnego wypisu + dosłowna ponowna zgoda. Historia zostaje po usunięciu wiersza z marketing_suppressions.';
create index if not exists ix_marketing_suppression_lifts_email on public.marketing_suppression_lifts (email, lifted_at desc);

alter table public.marketing_suppression_lifts enable row level security;
drop policy if exists marketing_suppression_lifts_admin_read on public.marketing_suppression_lifts;
create policy marketing_suppression_lifts_admin_read on public.marketing_suppression_lifts for select using (public.is_admin());
revoke all on table public.marketing_suppression_lifts from public, anon, authenticated, service_role;
grant select on table public.marketing_suppression_lifts to authenticated, service_role;

-- rejestr jest nienaruszalny także dla właściciela bazy
create or replace function public.marketing_suppression_lifts_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'marketing_suppression_lifts is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists trg_marketing_suppression_lifts_append_only on public.marketing_suppression_lifts;
create trigger trg_marketing_suppression_lifts_append_only
  before update or delete on public.marketing_suppression_lifts
  for each row execute function public.marketing_suppression_lifts_append_only();

-- usunięcie wypisu bez śladu w rejestrze jest niemożliwe
create or replace function public.marketing_suppressions_no_silent_delete()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.marketing_suppression_lifts l
                  where l.email = old.email
                    and (l.suppression->>'created_at')::timestamptz = old.created_at) then
    raise exception 'suppression of % cannot be deleted without a recorded consent (marketing_lift_suppression)', old.email using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_marketing_suppressions_no_silent_delete on public.marketing_suppressions;
create trigger trg_marketing_suppressions_no_silent_delete
  before delete on public.marketing_suppressions
  for each row execute function public.marketing_suppressions_no_silent_delete();

create or replace function public.marketing_lift_suppression(
  p_email text, p_consent_text text, p_consent_source text, p_consent_given_by text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.marketing_suppressions%rowtype;
begin
  select * into v_row from public.marketing_suppressions where email = v_email for update;
  if not found then return false; end if;
  if v_row.reason <> 'unsubscribe' then
    raise exception 'only an unsubscribe can be lifted (reason of %: %)', v_email, v_row.reason using errcode = 'P0001';
  end if;
  insert into public.marketing_suppression_lifts (email, suppression, consent_text, consent_source, consent_given_by)
  values (v_email, to_jsonb(v_row), p_consent_text, p_consent_source, p_consent_given_by);
  delete from public.marketing_suppressions where email = v_email;
  return true;
end $$;
revoke all on function public.marketing_lift_suppression(text, text, text, text) from public, anon, authenticated, service_role;

commit;

-- ===== PLIK: 20261107170000_marketing_review_fixes.sql =====
-- ============================================================================
-- 20261107170000 — Marketing: poprawki po review Codexa pakietu wdrożeniowego (07.11)
--
--  P2 stara zgoda mogła przepuścić usunięcie innego wypisu: strażnik dopasowywał tylko email + created_at, więc wpis odtworzony
--     z kopii (np. jako `bounce`) dawał się usunąć dzięki dawnej zgodzie. Teraz usunięcie wymaga wpisu w rejestrze utworzonego
--     W TEJ SAMEJ TRANSAKCJI (lifted_at = now(), czas startu transakcji) i obejmującego PEŁNY aktualny wiersz, a powód musi być
--     `unsubscribe`. Czasu w rejestrze nie da się podać ręcznie: ustawia go trigger przy dopisaniu.
--  P2 usunięcie profilu autora blokowało się na triggerze niezmienności: FK `on delete set null` na created_by / published_by
--     zerował kolumnę, a trigger odrzucał każdą jej zmianę. Teraz wolno WYŁĄCZNIE wyzerować te odwołania; zmiana na inną osobę
--     nadal jest odrzucana.
-- Idempotentne. Bez zmian w rozliczeniach.
-- ============================================================================

begin;

-- ── 1. rejestr zgód: czas zniesienia zawsze z transakcji ─────────────────────
create or replace function public.marketing_suppression_lifts_stamp()
returns trigger language plpgsql as $$
begin
  new.lifted_at := now();
  return new;
end $$;
drop trigger if exists trg_marketing_suppression_lifts_stamp on public.marketing_suppression_lifts;
create trigger trg_marketing_suppression_lifts_stamp
  before insert on public.marketing_suppression_lifts
  for each row execute function public.marketing_suppression_lifts_stamp();

-- ── 2. strażnik wypisów: zgoda z tej transakcji, na ten dokładny wiersz, tylko unsubscribe ──
create or replace function public.marketing_suppressions_no_silent_delete()
returns trigger language plpgsql as $$
begin
  if old.reason <> 'unsubscribe' or not exists (
    select 1 from public.marketing_suppression_lifts l
     where l.email = old.email
       and l.suppression = to_jsonb(old)
       and l.lifted_at = now()
  ) then
    raise exception 'suppression of % cannot be deleted without a recorded consent (marketing_lift_suppression)', old.email using errcode = 'P0001';
  end if;
  return old;
end $$;

-- ── 3. trigger niezmienności: wolno tylko wyzerować autora / publikującego (FK on delete set null) ──
create or replace function public.marketing_photo_versions_immutable()
returns trigger language plpgsql as $$
declare
  referenced boolean;
begin
  if TG_OP = 'DELETE' then
    raise exception 'marketing_photo_versions is immutable (new file = new version = new path)' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.photo_id is distinct from old.photo_id or new.version_no is distinct from old.version_no
     or new.width is distinct from old.width or new.height is distinct from old.height or new.bytes is distinct from old.bytes
     or new.mime is distinct from old.mime or new.sha256 is distinct from old.sha256
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'marketing_photo_versions is immutable (only publication fields may change)' using errcode = 'P0001';
  end if;
  -- trwały znacznik wycofania: nigdy nie znika ani się nie zmienia
  if old.unpublished_at is not null and new.unpublished_at is distinct from old.unpublished_at then
    raise exception 'unpublished_at is permanent' using errcode = 'P0001';
  end if;
  -- publikacja: pending → published (raz; NIGDY dla wersji wycofanej)
  if old.published_at is null and new.published_at is not null then
    if old.unpublished_at is not null then
      raise exception 'version was unpublished and cannot be published again (create a new version with a new path)' using errcode = 'P0001';
    end if;
    if new.unpublished_at is not null then
      raise exception 'cannot publish and mark unpublished at once' using errcode = 'P0001';
    end if;
    if new.public_url is null or new.public_url not like 'https://%' then
      raise exception 'publication requires https public_url' using errcode = 'P0001';
    end if;
    if new.unpublishing_at is not null then
      raise exception 'cannot publish a version marked for unpublishing' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- cofnięcie publikacji: WYŁĄCZNIE po zajęciu stanu (claim) i tylko wersja nieużywana; kończy stan i stawia TRWAŁY znacznik
  if old.published_at is not null and new.published_at is null then
    if old.unpublishing_at is null then
      raise exception 'unpublish requires a prior claim (marketing_photo_version_claim_unpublish)' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.marketing_campaigns c
        where c.photo_version_id = old.id or nullif(c.frozen_photo->>'version_id','')::uuid = old.id
      union all
      select 1 from public.marketing_photos p where p.approved_version_id = old.id
    ) into referenced;
    if referenced then
      raise exception 'published version is referenced by a campaign or approved photo and cannot be unpublished' using errcode = 'P0001';
    end if;
    if new.public_url is not null then
      raise exception 'unpublished version must have null public_url' using errcode = 'P0001';
    end if;
    new.unpublishing_at := null; new.unpublishing_by := null;
    new.unpublished_at := coalesce(old.unpublished_at, now());
    return new;
  end if;
  -- poza publikacją/wycofaniem: pola pliku i publikacji nietykalne (published_by wolno tylko wyzerować), znacznik nie do ustawienia ręcznie
  if new.public_url is distinct from old.public_url or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or (new.published_by is distinct from old.published_by and new.published_by is not null)
     or new.published_at is distinct from old.published_at then
    raise exception 'published marketing_photo_versions row is immutable' using errcode = 'P0001';
  end if;
  if new.unpublished_at is distinct from old.unpublished_at then
    raise exception 'unpublished_at is set only by completing an unpublish' using errcode = 'P0001';
  end if;
  -- stan wycofywania: wolno tylko ZAJĄĆ (NULL → wartość, przez RPC claim); zwolnienie bez dokończenia wycofania zabronione
  if old.unpublishing_at is not null and new.unpublishing_at is null then
    raise exception 'unpublishing state can only end by completing the unpublish (no manual release)' using errcode = 'P0001';
  end if;
  if old.unpublishing_at is not null and new.unpublishing_at is distinct from old.unpublishing_at then
    raise exception 'unpublishing_at cannot be changed once set' using errcode = 'P0001';
  end if;
  return new;
end $$;

commit;
