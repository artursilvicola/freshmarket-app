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
