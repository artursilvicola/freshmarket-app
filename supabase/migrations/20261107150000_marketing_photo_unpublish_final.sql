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
