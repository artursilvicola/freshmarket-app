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
