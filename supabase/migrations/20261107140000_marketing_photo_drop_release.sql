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
