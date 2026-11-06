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
