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
